"""Автоматизация «Автоматическая наработка» — копия скрипта Airtable (docs/airtable-inventory).

Рейс APS: «Закончен» + «Обработан» + циркуляция → каждому оборудованию рейса
«Циркуляция после ТО» += (часы − уже добавленные); правка часов досчитывает разницу;
снятие галочки/статуса откатывает добавленное. Учтённое хранится в «Добавлено в оборудование»."""
import pytest
from sqlalchemy import text

from app.db import engine

TRIPS, EQUIP, LINK = "at_tbltripstest00000", "at_tblequiptest00000", "l_fldtripseqtest000"


@pytest.fixture
def trip(user):
    """Рейс 1 с двумя приборами (после ТО 10:00 и 0:30), рейс 2 без оборудования."""
    with engine.begin() as c:
        c.execute(text(
            f"create table {EQUIP} (id serial primary key, airtable_id text not null default '', name text, "
            "after_to numeric, created_at timestamptz, created_by int, "
            "updated_at timestamptz not null default now(), updated_by int)"))
        c.execute(text(
            f"create table {TRIPS} (id serial primary key, airtable_id text not null default '', name text, "
            "status text, circ numeric, ok boolean, added numeric, note text, created_at timestamptz, created_by int, "
            "updated_at timestamptz not null default now(), updated_by int)"))
        c.execute(text(f"create table {LINK} (src int not null references {EQUIP}(id) on delete cascade, "
                       f"dst int not null references {TRIPS}(id) on delete cascade, pos int, rpos int, primary key (src, dst))"))
        c.execute(text(f"insert into {EQUIP} (name, after_to) values ('Пульсатор_№_1', 36000), ('Инклинометр_№_2', 1800)"))
        c.execute(text(f"insert into {TRIPS} (name, status) values ('Рейс 1', 'В работе'), ('Рейс 2', 'Планируется')"))
        c.execute(text(f"insert into {LINK} (src, dst) values (1, 1), (2, 1)"))
        c.execute(text(f"insert into at_link_meta values ('fldTripEq00000000', '{LINK}', 'dst')"))
        e = c.execute(text(f"insert into app_table (pg_name, title, primary_field) values ('{EQUIP}', 'Оборудование', 'name') returning id")).scalar()
        t = c.execute(text(f"insert into app_table (pg_name, title, primary_field) values ('{TRIPS}', 'Рейсы APS', 'name') returning id")).scalar()
        c.execute(text(
            "insert into app_field (table_id, column_name, title, kind, editable, sort_order, options, airtable_id) values "
            "(:e, 'name', 'ID_Оборудования', 'text', false, 1, '{}', null), "
            "(:e, 'after_to', 'Циркуляция после ТО', 'duration', true, 2, '{}', null), "
            "(:t, 'name', 'Рейс', 'text', true, 1, '{}', null), "
            "(:t, 'status', 'Статус', 'singleSelect', true, 2, '{}', null), "
            "(:t, 'circ', 'Циркуляция, час', 'number', true, 3, '{}', null), "
            "(:t, 'ok', 'Обработан', 'checkbox', true, 4, '{}', null), "
            "(:t, 'added', 'Добавлено в оборудование', 'number', true, 5, '{}', null), "
            "(:t, 'note', 'Примечание', 'text', true, 6, '{}', null), "
            "(:t, 'f_fldtripeq00000000', 'ID_Оборудования', 'multipleRecordLinks', false, 7, "
            "'{\"virtual\": true, \"linkedTableId\": \"tblE\"}', 'fldTripEq00000000')"), {"e": e, "t": t})
    yield t, e
    with engine.begin() as c:
        c.execute(text(f"drop table if exists {LINK}, {TRIPS}, {EQUIP} cascade"))


def _patch(client, t, rid, **values):
    with engine.connect() as c:
        v = c.execute(text(f"select updated_at from {TRIPS} where id = :i"), {"i": rid}).scalar()
    return client.patch(f"/api/tables/{t}/records/{rid}", json={"updated_at": v.isoformat(), "values": values})


def _state():
    with engine.connect() as c:
        eq = [float(x) for x in c.execute(text(f"select after_to from {EQUIP} order by id")).scalars()]
        added = c.execute(text(f"select added from {TRIPS} where id = 1")).scalar()
    return eq, None if added is None else float(added)


def test_processed_trip_adds_hours_to_each_equipment(logged, trip):
    t, _ = trip
    assert _patch(logged, t, 1, status="Закончен", circ=12.5).status_code == 200
    assert _state() == ([36000, 1800], None)                        # без «Обработан» — ничего
    assert _patch(logged, t, 1, ok=True).status_code == 200
    assert _state() == ([36000 + 45000, 1800 + 45000], 12.5)        # 12:30 = 45000 с


def test_hours_edit_adds_only_difference_and_uncheck_rolls_back(logged, trip):
    t, _ = trip
    _patch(logged, t, 1, status="Закончен", circ=10, ok=True)
    assert _state() == ([72000, 37800], 10)
    _patch(logged, t, 1, circ=4)                                     # исправили часы: −6 ч
    assert _state() == ([50400, 16200], 4)
    _patch(logged, t, 1, ok=False)                                   # сняли галочку: откат
    assert _state() == ([36000, 1800], 0)
    _patch(logged, t, 1, ok=True)
    _patch(logged, t, 1, status="В работе")                          # сменили статус: тоже откат
    assert _state() == ([36000, 1800], 0)


def test_rollback_never_goes_below_zero(logged, trip):
    t, _ = trip
    _patch(logged, t, 1, status="Закончен", circ=2, ok=True)
    with engine.begin() as c:
        c.execute(text(f"update {EQUIP} set after_to = 0 where id = 2"))   # обнулили при ТО вручную
    _patch(logged, t, 1, ok=False)
    assert _state() == ([36000, 0], 0)


def test_other_fields_and_empty_trip_do_nothing(logged, trip):
    t, _ = trip
    _patch(logged, t, 1, status="Закончен", circ=3, ok=True)
    before = _state()
    assert _patch(logged, t, 1, note="коммент").status_code == 200   # не отслеживаемое поле
    assert _state() == before
    # рейс без оборудования: в Airtable скрипт падает, у нас просто ничего не делаем, правка сохраняется
    assert _patch(logged, t, 2, status="Закончен", circ=5, ok=True).status_code == 200


def test_history_written_as_automation(logged, trip):
    t, e = trip
    _patch(logged, t, 1, status="Закончен", circ=1, ok=True)
    h = logged.get(f"/api/tables/{e}/records/1/history").json()
    assert h[0]["field"] == "Циркуляция после ТО" and h[0]["user"] == "Автоматизация"
    assert float(h[0]["old"]) == 36000 and float(h[0]["new"]) == 39600
    trip_h = {x["field"]: x for x in logged.get(f"/api/tables/{t}/records/1/history").json()}
    assert trip_h["Добавлено в оборудование"]["user"] == "Автоматизация"

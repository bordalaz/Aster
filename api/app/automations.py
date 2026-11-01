"""Автоматизации Airtable, перенесённые 1:1 (docs/airtable-inventory/automations).

«Автоматическая наработка»: триггер — правка рейса APS в полях Статус / ID_Оборудования /
Циркуляция, час / Обработан. Скрипт дословно:
  A) «Закончен» и «Обработан» и циркуляция заполнена → каждому оборудованию рейса
     «Циркуляция после ТО» += часы − ранее добавленные (не ниже 0); рейсу «Добавлено» = часы;
  B) было добавлено, а статус ≠ «Закончен» или галочку сняли → откат, «Добавлено» = 0;
  C) иначе ничего.
Отличия от Airtable: выполняется в той же транзакции, что и правка рейса (нет «потерянных» часов);
рейс без оборудования — не ошибка, а «ничего» (в Airtable скрипт падал молча)."""
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

TRIPS, EQUIP = "Рейсы APS", "Оборудование"
WATCH = ("Статус", "ID_Оборудования", "Циркуляция, час", "Обработан")
DONE = "Закончен"


def _cols(c, table_id: int) -> dict:
    return dict(c.execute(text("select title, column_name from app_field where table_id = :t"), {"t": table_id}).all())


def _log(c, rows: list):
    """История с автором NULL — показывается как «Автоматизация»."""
    if rows:
        c.execute(text("insert into app_change (table_id, record_id, column_name, old, new, user_id) "
                       "values (:t, :r, :c, :o, :n, null)")
                  .bindparams(bindparam("o", type_=JSONB), bindparam("n", type_=JSONB)), rows)


def after_update(c, table_id: int, record_id: int, changed: set):
    """Вызывается из правки записи внутри её транзакции; changed — реально изменённые колонки."""
    tables = dict(c.execute(text("select title, id from app_table where title in (:a, :b)"), {"a": TRIPS, "b": EQUIP}).all())
    if tables.get(TRIPS) != table_id or EQUIP not in tables:
        return
    tc = _cols(c, table_id)
    if not changed & {tc.get(n) for n in WATCH}:
        return
    _narabotka(c, table_id, tables[EQUIP], record_id, tc)


def _narabotka(c, trip_table: int, equip_table: int, rid: int, tc: dict):
    t_pg = c.execute(text("select pg_name from app_table where id = :t"), {"t": trip_table}).scalar()
    e_pg = c.execute(text("select pg_name from app_table where id = :t"), {"t": equip_table}).scalar()
    st, circ, ok, added = (tc["Статус"], tc["Циркуляция, час"], tc["Обработан"], tc["Добавлено в оборудование"])
    trip = c.execute(text(f'select "{st}" st, "{circ}" circ, "{ok}" ok, "{added}" added from {t_pg} where id = :i'),
                     {"i": rid}).first()
    link = c.execute(text("select m.link_table, m.side from at_link_meta m join app_field f on f.airtable_id = m.field_id "
                          "where f.table_id = :t and f.title = 'ID_Оборудования'"), {"t": trip_table}).first()
    if not link:
        return
    mine, other = ("src", "dst") if link.side == "src" else ("dst", "src")
    equip = c.execute(text(f"select {other} from {link.link_table} where {mine} = :i order by {other}"), {"i": rid}).scalars().all()
    if not equip:
        return

    prev_min = round(float(trip.added or 0) * 60)
    was_booked = prev_min > 0
    if trip.st == DONE and trip.ok and trip.circ is not None:          # A) учёт / пересчёт
        delta, new_added = round(float(trip.circ) * 60) - (prev_min if was_booked else 0), trip.circ
    elif was_booked and (trip.st != DONE or not trip.ok):             # B) откат
        delta, new_added = -prev_min, 0
    else:                                                              # C) условий недостаточно
        return

    after = _cols(c, equip_table)["Циркуляция после ТО"]
    log = []
    for eid in equip:
        cur = c.execute(text(f'select "{after}" from {e_pg} where id = :i for update'), {"i": eid}).scalar()
        cur_min = round(float(cur or 0) / 60)                          # длительность хранится в секундах
        new = max(0, cur_min + delta) * 60
        c.execute(text(f'update {e_pg} set "{after}" = :v, updated_at = now(), updated_by = null where id = :i'),
                  {"v": new, "i": eid})
        log.append({"t": equip_table, "r": eid, "c": after, "o": None if cur is None else float(cur), "n": new})
    c.execute(text(f'update {t_pg} set "{added}" = :v where id = :i'), {"v": new_added, "i": rid})
    if (float(trip.added) if trip.added is not None else None) != float(new_added):
        log.append({"t": trip_table, "r": rid, "c": added,
                    "o": None if trip.added is None else float(trip.added), "n": float(new_added)})
    _log(c, log)

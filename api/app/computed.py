"""Вычисляемые поля (formula/rollup/lookup/count) для API.
Считаются движком migrate.compute по всей базе от сырых данных и держатся в памяти процесса.
После записи — пересчёт в фоне; пока он идёт, отдаём прежние значения."""
import threading
import time
from datetime import datetime, timezone

from migrate.compute import compute_all

from sqlalchemy import text

from .db import engine

# ponytail: память одного процесса. Правка поля, связи, новая запись — пересчёт только задетых записей
# (что изменилось — из журнала app_change); первый расчёт и удаление — полный (~35 с на ноутбуке-сервере).
# Несколько воркеров uvicorn — хранить значения в таблице.
_lock = threading.Lock()
_values: dict | None = None
_done_gen = 0      # поколение, чьи значения сейчас в _values
_next_gen = 0
_running = False   # идёт фоновый цикл пересчёта
_seen = None       # последний app_change.id, учтённый в _values (None — следующий расчёт полный)
_full = False      # запрошен полный пересчёт
_tables: set = set()   # таблицы с новыми записями с прошлого расчёта
_day = None         # день (UTC), на который посчитаны _values: сменился — TODAY() считается заново
_busy_full = False  # идёт полный пересчёт (~35 с): обычное чтение его не ждёт
_threads: list[threading.Thread] = []


def _compute(full: bool = True, tables: frozenset = frozenset()) -> tuple[dict, int, object]:
    """→ (значения, учтённый app_change.id, день расчёта). Не full и есть прошлый расчёт — только задетые правками
    записи (журнал app_change); не вышло разобрать журнал — только зависящие от правок поля.
    tables — таблицы, где появились новые записи."""
    today = datetime.now(timezone.utc).date()   # TODAY() — по UTC, как в Airtable
    with engine.connect() as c:
        hi = c.execute(text("select coalesce(max(id), 0) from app_change")).scalar()
        if full or _values is None or _seen is None:
            return compute_all(c, today), hi, today
        rows = c.execute(text(
            "select ch.table_id, ch.record_id, ch.column_name, ch.old, f.airtable_id, f.kind, t.pg_name, t.airtable_id as t_at "
            "from app_change ch join app_table t on t.id = ch.table_id left join app_field f "
            "on f.table_id = ch.table_id and f.column_name = ch.column_name "
            "where ch.id > :lo and ch.id <= :hi"), {"lo": _seen, "hi": hi}).all()
        got = _touched(c, rows, tables)
        if got is not None:
            return compute_all(c, today, prev=_values, touched=got[0], new=got[1], prev_today=_day), hi, today
        changed = None
        new_in = set(tables) | {r.table_id for r in rows if r.column_name == "id"}
        if all(r.airtable_id or r.column_name == "id" for r in rows):   # неизвестные колонки — полный расчёт
            changed = {r.airtable_id for r in rows if r.airtable_id}
            # связь правится с обеих сторон: итоги в связанной таблице считаются по её полю-связи
            changed |= set(c.execute(text(
                "select o.field_id from at_link_meta m join at_link_meta o "
                "on o.link_table = m.link_table where m.field_id = any(:f)"), {"f": list(changed)}).scalars())
            # новая запись — все вычисляемые поля её таблицы (у неё ещё нет значений)
            changed |= set(c.execute(text("select airtable_id from app_field where table_id = any(:t) "
                                          "and airtable_id is not null"), {"t": list(new_in)}).scalars())
        return compute_all(c, today, prev=_values, changed=changed), hi, today


def _touched(c, rows, tables) -> tuple[dict, dict] | None:
    """Журнал правок → ({поле: {airtable_id записей}}, {таблица: {новые записи}}).
    Связь задевает обе стороны: запись и её связанные — прежние (из журнала) и нынешние.
    None — не разобрать (неизвестная колонка, таблица без airtable_id): тогда пересчёт по полям."""
    if any(r.t_at is None or (r.airtable_id is None and r.column_name != "id") for r in rows):
        return None
    if set(tables) - {r.table_id for r in rows if r.column_name == "id"}:
        return None
    ids: dict = {}   # pg_name → {id: airtable_id}
    for r in rows:
        ids.setdefault(r.pg_name, {})[r.record_id] = None
    for pg, m in ids.items():
        m.update(c.execute(text(f"select id, airtable_id from {pg} where id = any(:i)"), {"i": list(m)}).all())
    touched: dict = {}
    new: dict = {}
    # поля-связи таблицы: field_id → (таблица пар, своя сторона, обратное поле, pg связанной таблицы)
    links: dict = {}

    def link_of(tid, fid=None):
        key = (tid, fid)
        if key not in links:
            links[key] = c.execute(text(
                "select m.field_id, m.link_table, m.side, o.field_id as inv, lt.pg_name as other_pg "
                "from at_link_meta m join app_field f on f.airtable_id = m.field_id "
                "join at_link_meta o on o.link_table = m.link_table and o.field_id <> m.field_id "
                "join app_field of on of.airtable_id = o.field_id join app_table lt on lt.id = of.table_id "
                "where f.table_id = :t" + (" and m.field_id = :f" if fid else "")), {"t": tid, "f": fid}).all()
        return links[key]

    def partners(lk, rid, old) -> set:
        me, other = ("src", "dst") if lk.side == "src" else ("dst", "src")
        pg = set(c.execute(text(f"select {other} from {lk.link_table} where {me} = :r"), {"r": rid}).scalars())
        if old is not None:
            if not isinstance(old, list) or not all(isinstance(x, dict) and "id" in x for x in old):
                raise ValueError("связь в журнале не в виде [{id}]")
            pg |= {x["id"] for x in old}
        return set(c.execute(text(f"select airtable_id from {lk.other_pg} where id = any(:i)"), {"i": list(pg)}).scalars())

    try:
        for r in rows:
            rec = ids[r.pg_name].get(r.record_id)
            if rec is None:
                continue   # запись уже удалена — удаление само считает всё заново
            if r.column_name == "id":
                new.setdefault(r.t_at, set()).add(rec)
                for lk in link_of(r.table_id):
                    touched.setdefault(lk.field_id, set()).add(rec)
                    touched.setdefault(lk.inv, set()).update(partners(lk, r.record_id, None))
                continue
            touched.setdefault(r.airtable_id, set()).add(rec)
            if r.kind == "multipleRecordLinks":
                for lk in link_of(r.table_id, r.airtable_id):
                    touched.setdefault(lk.inv, set()).update(partners(lk, r.record_id, r.old))
    except ValueError:
        return None
    return touched, new


def values() -> dict:
    """{field_id: {airtable_id записи: значение}}; первый вызов считает синхронно."""
    global _values, _seen, _day
    if _values is None:
        with _lock:
            if _values is None:
                _values, _seen, _day = _compute()
    return _values


def invalidate(full: bool = False, table: int | None = None) -> None:
    """Данные изменились — пересчитать в фоне. Правки во время расчёта склеиваются в один следующий
    (вставка 100 ячеек — не 100 полных пересчётов). Устаревший расчёт не перетирает более свежий.
    table — в ней появилась новая запись."""
    global _next_gen, _running, _full
    with _lock:
        _next_gen += 1
        _full = _full or full
        if table is not None:
            _tables.add(table)
        if _running:
            return          # идущий цикл увидит новое поколение и посчитает ещё раз
        _running = True
    t = threading.Thread(target=_refresh, daemon=True)
    _threads.append(t)
    t.start()


def _refresh() -> None:
    global _values, _done_gen, _running, _seen, _full, _day, _busy_full
    while True:
        with _lock:
            gen, full, _full = _next_gen, _full, False
            tables = frozenset(_tables)
            _tables.clear()
            _busy_full = full or _values is None
        try:
            new, hi, day = _compute(full, tables)
        except Exception:
            with _lock:
                _running = _busy_full = False
            raise
        with _lock:
            _busy_full = False
            if gen > _done_gen:
                _values, _done_gen, _seen, _day = new, gen, hi, day
            if _next_gen == gen:
                _running = False
                return


def settle(timeout: float, light: bool = False) -> None:
    """Подождать, пока идёт фоновый пересчёт (запрос строк сразу после правки).
    light — обычное чтение: короткий пересчёт по записям ждём, полный (~35 с) — нет."""
    # ponytail: опрос раз в 50 мс; Condition — если ждущих станет много
    end = time.monotonic() + timeout
    while _running and not (light and _busy_full) and time.monotonic() < end:
        time.sleep(0.05)


def wait() -> None:
    """Дождаться фоновых пересчётов (для тестов)."""
    while _threads:
        _threads.pop().join()


def reset() -> None:
    global _values, _seen, _full, _day
    wait()
    _values, _seen, _full, _day = None, None, False, None
    _tables.clear()

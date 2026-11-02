"""Вычисляемые поля (formula/rollup/lookup/count) для API.
Считаются движком migrate.compute по всей базе от сырых данных и держатся в памяти процесса.
После записи — пересчёт в фоне; пока он идёт, отдаём прежние значения."""
import threading
import time
from datetime import datetime, timezone

from migrate.compute import compute_all

from sqlalchemy import text

from .db import engine

# ponytail: память одного процесса. Правка поля — пересчёт только зависящих от него полей (что изменилось —
# из журнала app_change); новая запись, форма, первый расчёт — полный (~6 с на 40 тыс. записей).
# Несколько воркеров uvicorn — хранить значения в таблице.
_lock = threading.Lock()
_values: dict | None = None
_done_gen = 0      # поколение, чьи значения сейчас в _values
_next_gen = 0
_running = False   # идёт фоновый цикл пересчёта
_seen = None       # последний app_change.id, учтённый в _values (None — следующий расчёт полный)
_full = False      # запрошен полный пересчёт
_threads: list[threading.Thread] = []


def _compute(full: bool = True) -> tuple[dict, int]:
    """→ (значения, учтённый app_change.id). Не full и есть прошлый расчёт — только зависящие от правок поля."""
    with engine.connect() as c:
        hi = c.execute(text("select coalesce(max(id), 0) from app_change")).scalar()
        changed = None
        if not full and _values is not None and _seen is not None:
            rows = c.execute(text(
                "select ch.column_name, f.airtable_id from app_change ch left join app_field f "
                "on f.table_id = ch.table_id and f.column_name = ch.column_name "
                "where ch.id > :lo and ch.id <= :hi"), {"lo": _seen, "hi": hi}).all()
            if all(r.airtable_id for r in rows):   # 'id' (новая запись) и неизвестные колонки — полный расчёт
                changed = {r.airtable_id for r in rows}
        # TODAY() — по UTC, как в Airtable; ponytail: значения с TODAY() обновятся при следующей записи
        return compute_all(c, datetime.now(timezone.utc).date(), prev=_values, changed=changed), hi


def values() -> dict:
    """{field_id: {airtable_id записи: значение}}; первый вызов считает синхронно."""
    global _values, _seen
    if _values is None:
        with _lock:
            if _values is None:
                _values, _seen = _compute()
    return _values


def invalidate(full: bool = False) -> None:
    """Данные изменились — пересчитать в фоне. Правки во время расчёта склеиваются в один следующий
    (вставка 100 ячеек — не 100 полных пересчётов). Устаревший расчёт не перетирает более свежий."""
    global _next_gen, _running, _full
    with _lock:
        _next_gen += 1
        _full = _full or full
        if _running:
            return          # идущий цикл увидит новое поколение и посчитает ещё раз
        _running = True
    t = threading.Thread(target=_refresh, daemon=True)
    _threads.append(t)
    t.start()


def _refresh() -> None:
    global _values, _done_gen, _running, _seen, _full
    while True:
        with _lock:
            gen, full, _full = _next_gen, _full, False
        try:
            new, hi = _compute(full)
        except Exception:
            with _lock:
                _running = False
            raise
        with _lock:
            if gen > _done_gen:
                _values, _done_gen, _seen = new, gen, hi
            if _next_gen == gen:
                _running = False
                return


def settle(timeout: float) -> None:
    """Подождать, пока идёт фоновый пересчёт (запрос строк сразу после правки)."""
    # ponytail: опрос раз в 50 мс; Condition — если ждущих станет много
    end = time.monotonic() + timeout
    while _running and time.monotonic() < end:
        time.sleep(0.05)


def wait() -> None:
    """Дождаться фоновых пересчётов (для тестов)."""
    while _threads:
        _threads.pop().join()


def reset() -> None:
    global _values, _seen, _full
    wait()
    _values, _seen, _full = None, None, False

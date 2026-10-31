"""Вычисляемые поля (formula/rollup/lookup/count) для API.
Считаются движком migrate.compute по всей базе от сырых данных и держатся в памяти процесса.
После записи — пересчёт в фоне; пока он идёт, отдаём прежние значения."""
import threading
from datetime import datetime, timezone

from migrate.compute import compute_all

from .db import engine

# ponytail: память одного процесса, полный пересчёт базы (~6 с на 40 тыс. записей).
# Несколько воркеров uvicorn или запись чаще раза в несколько секунд — хранить в таблице
# и пересчитывать только зависящие от правки поля.
_lock = threading.Lock()
_values: dict | None = None
_done_gen = 0      # поколение, чьи значения сейчас в _values
_next_gen = 0
_running = False   # идёт фоновый цикл пересчёта
_threads: list[threading.Thread] = []


def _compute() -> dict:
    with engine.connect() as c:
        # TODAY() — по UTC, как в Airtable; ponytail: значения с TODAY() обновятся при следующей записи
        return compute_all(c, datetime.now(timezone.utc).date())


def values() -> dict:
    """{field_id: {airtable_id записи: значение}}; первый вызов считает синхронно."""
    global _values
    if _values is None:
        with _lock:
            if _values is None:
                _values = _compute()
    return _values


def invalidate() -> None:
    """Данные изменились — пересчитать в фоне. Правки во время расчёта склеиваются в один следующий
    (вставка 100 ячеек — не 100 полных пересчётов). Устаревший расчёт не перетирает более свежий."""
    global _next_gen, _running
    with _lock:
        _next_gen += 1
        if _running:
            return          # идущий цикл увидит новое поколение и посчитает ещё раз
        _running = True
    t = threading.Thread(target=_refresh, daemon=True)
    _threads.append(t)
    t.start()


def _refresh() -> None:
    global _values, _done_gen, _running
    while True:
        with _lock:
            gen = _next_gen
        try:
            new = _compute()
        except Exception:
            with _lock:
                _running = False
            raise
        with _lock:
            if gen > _done_gen:
                _values, _done_gen = new, gen
            if _next_gen == gen:
                _running = False
                return


def wait() -> None:
    """Дождаться фоновых пересчётов (для тестов)."""
    while _threads:
        _threads.pop().join()


def reset() -> None:
    global _values
    wait()
    _values = None

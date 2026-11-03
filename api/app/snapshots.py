"""Снимки базы, как в Airtable (docs/backups.md): список, ручной снимок, «Открыть снимок» (только чтение,
отдельный экземпляр snapshot-api), «Вернуть базу к снимку» (суперадмин). Делает их контейнер backup
по заданиям из служебной базы bd_ops; здесь — только постановка заданий и показ."""
import logging
import os
import threading
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, ProgrammingError

from .auth import active_user, admin_user
from .db import SNAPSHOT, ops

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api")
COOLDOWN_MIN = 60   # ручной снимок — не чаще раза в час (в Airtable — раз в несколько часов)


def _ops():
    try:
        return ops.begin()
    except (OperationalError, ProgrammingError):
        raise HTTPException(503, "Снимки недоступны: не запущен сервис backup")


def _q(c, sql, **p):
    try:
        return c.execute(text(sql), p)
    except (OperationalError, ProgrammingError):
        raise HTTPException(503, "Снимки недоступны: не запущен сервис backup")


@router.get("/snapshots")
def list_snapshots(user: dict = Depends(admin_user)):
    with _ops() as c:
        snaps = [dict(r) for r in _q(c, "select id, created_at, kind, size, rows, by_user from snapshot order by created_at desc").mappings()]
        jobs = [dict(r) for r in _q(c, "select id, kind, snapshot_id, by_user, status, message, created_at, done_at from job "
                                       "order by id desc limit 10").mappings()]
        state = dict(_q(c, "select key, value from state").all())
    return {"snapshots": snaps, "jobs": jobs, "open": int(state["open"]) if state.get("open") else None,
            "can_restore": user["role"] == "superadmin", "snapshot_url": os.environ.get("SNAPSHOT_URL")}


def _enqueue(c, kind: str, snapshot_id: int | None, user: dict) -> int:
    if _q(c, "select 1 from job where status in ('pending', 'running')").first():
        raise HTTPException(409, "Уже выполняется другое действие со снимками — дождитесь его")
    return _q(c, "insert into job (kind, snapshot_id, by_user) values (:k, :s, :u) returning id",
              k=kind, s=snapshot_id, u=user.get("name") or user["login"]).scalar()


@router.post("/snapshots")
def take_snapshot(user: dict = Depends(admin_user)):
    with _ops() as c:
        last = _q(c, "select max(created_at) from snapshot where kind = 'manual' and created_at > now() - make_interval(mins => :m)",
                  m=COOLDOWN_MIN).scalar()
        if last:
            raise HTTPException(429, f"Ручной снимок — не чаще раза в {COOLDOWN_MIN} мин.")
        return {"job": _enqueue(c, "snapshot", None, user)}


def _snapshot(c, sid: int):
    if not _q(c, "select 1 from snapshot where id = :i", i=sid).first():
        raise HTTPException(404, "Нет такого снимка")


@router.post("/snapshots/{sid}/open")
def open_snapshot(sid: int, user: dict = Depends(admin_user)):
    with _ops() as c:
        _snapshot(c, sid)
        return {"job": _enqueue(c, "open", sid, user)}


class RestoreBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm: bool


@router.post("/snapshots/{sid}/restore")
def restore_snapshot(sid: int, body: RestoreBody, user: dict = Depends(active_user)):
    """Рабочая база целиком — как в момент снимка; перед этим backup снимает текущее состояние."""
    if user["role"] != "superadmin":
        raise HTTPException(403, "Вернуть базу к снимку может только суперадмин")
    if not body.confirm:
        raise HTTPException(422, "Нужно подтверждение")
    with _ops() as c:
        _snapshot(c, sid)
        log.warning("откат базы к снимку %s: %s", sid, user["login"])
        return {"job": _enqueue(c, "restore", sid, user)}


@router.get("/snapshot-info")
def snapshot_info(user: dict = Depends(active_user)):
    """Для плашки «Снимок … — только просмотр» на экземпляре snapshot-api."""
    if not SNAPSHOT:
        return {"snapshot": None}
    with _ops() as c:
        sid = _q(c, "select value from state where key = 'open'").scalar()
        row = _q(c, "select id, created_at, kind from snapshot where id = :i", i=int(sid)).mappings().first() if sid else None
    return {"snapshot": dict(row) if row else {"id": None}}


def watch(stop: threading.Event, every: float = 3):
    """База подменена (откат — state.generation; новый открытый снимок — state.open у snapshot-api) —
    выйти: контейнер перезапустится, миграции и вычисляемые поля поднимутся на новой базе."""
    key, start = ("open" if SNAPSHOT else "generation"), None
    while not stop.wait(every):
        try:
            with ops.connect() as c:
                v = c.execute(text("select value from state where key = :k"), {"k": key}).scalar() or ""
        except Exception:   # noqa: BLE001 — нет bd_ops (backup не запущен) — просто ждём
            continue
        if start is None:
            start = v
        elif v != start:
            log.warning("база подменена (%s: %s → %s) — перезапуск", key, start, v)
            time.sleep(0.5)
            os._exit(0)

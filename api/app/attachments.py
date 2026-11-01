"""Вложения (spec R27, R28, R37). Файлы — на диске под внутренним именем (ROOT/path), люди видят исходное.
Загрузка — сырым телом (`Content-Type: application/octet-stream`: с чужого сайта без preflight не отправить),
до привязки к записи файл видит только загрузивший. Предпросмотр (inline) — только картинки и PDF,
и только если это они по содержимому; всё остальное отдаётся как вложение и не исполняется."""
import logging
import mimetypes
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from .access import can_edit, can_read, hidden_columns, table_title
from .auth import active_user
from .db import engine

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

ROOT = Path(os.environ.get("ATTACH_ROOT", "/data/snapshot"))   # перенесённые из Airtable лежат в ROOT/files
MAX = 50 * 1024 * 1024   # R27
ATTACH = "multipleAttachments"
_MAGIC = [(b"\x89PNG\r\n\x1a\n", "image/png"), (b"\xff\xd8\xff", "image/jpeg"), (b"GIF8", "image/gif"),
          (b"%PDF-", "application/pdf")]


def sniff(head: bytes) -> str | None:
    """Безопасный для показа тип по содержимому файла, иначе None."""
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return next((m for sig, m in _MAGIC if head.startswith(sig)), None)


def _mime(name: str, path: Path) -> str:
    with open(path, "rb") as f:
        return sniff(f.read(16)) or mimetypes.guess_type(name)[0] or "application/octet-stream"


@router.post("/uploads")
async def upload(request: Request, name: str = "", user: dict = Depends(active_user)):
    if request.headers.get("content-type", "").split(";")[0].strip() != "application/octet-stream":
        raise HTTPException(415, "Файл отправляется как application/octet-stream")
    name = Path(name.replace("\\", "/")).name.strip()[:200] or "файл"   # только имя, без путей
    rel = f"uploads/{uuid.uuid4().hex}"
    dest = ROOT / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    try:
        with open(dest, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX:
                    raise HTTPException(413, "Файл больше 50 МБ")
                f.write(chunk)
    except BaseException:
        dest.unlink(missing_ok=True)   # обрывок не оставляем
        raise
    with engine.begin() as c:
        aid = c.execute(text(
            "insert into attachment (filename, mime, size, path, uploaded_by) values (:n, :m, :s, :p, :u) returning id"),
            {"n": name, "m": _mime(name, dest), "s": size, "p": rel, "u": user["id"]}).scalar()
    return {"id": aid, "name": name, "size": size}


def _visible(c, row, user) -> bool:
    """Привязанное — тем, кто видит таблицу и поле; непривязанное — только загрузившему."""
    if row.table_id is None:
        return row.uploaded_by == user["id"]
    if row.table_id == "app_calibration":   # файлы калибровок — всем, кто видит Оборудование
        return can_read(user, "Оборудование")
    t = c.execute(text("select id, title from app_table where airtable_id = :a"), {"a": row.table_id}).first()
    if t is None or not can_read(user, t.title):
        return False
    col = c.execute(text("select column_name from app_field where airtable_id = :f"), {"f": row.field_id}).scalar()
    return col not in hidden_columns(c, user, t.id)


@router.get("/attachments/{att_id}")
def download(att_id: int, inline: bool = False, user: dict = Depends(active_user)):
    with engine.connect() as c:
        row = c.execute(text("select * from attachment where id = :i"), {"i": att_id}).first()
        if row is None or not _visible(c, row, user):
            raise HTTPException(404, "Нет такого файла")
    path = ROOT / row.path
    if not path.is_file():
        raise HTTPException(404, "Файл не найден на диске")
    with open(path, "rb") as f:
        safe = sniff(f.read(16))
    show = inline and safe is not None
    return FileResponse(path, media_type=safe if show else "application/octet-stream",
                        filename=row.filename or "файл", content_disposition_type="inline" if show else "attachment",
                        headers={"X-Content-Type-Options": "nosniff",
                                 "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; object-src 'self'"})


def values_for(c, table_at: str) -> dict:
    """{(airtable id записи, поля): [{id, name, size, mime}]} — вложения таблицы для /records."""
    out: dict = {}
    for r in c.execute(text("select id, record_airtable_id, field_id, filename, size, mime from attachment "
                            "where table_id = :t order by pos, id"), {"t": table_at}):
        out.setdefault((r.record_airtable_id, r.field_id), []).append(
            {"id": r.id, "name": r.filename or "файл", "size": r.size, "mime": r.mime})
    return out


def bind(c, table_at: str, rec_at: str, field_at: str, ids, user: dict) -> list[str]:
    """Привязать свои непривязанные загрузки к записи (в конец поля); вернуть их имена."""
    if not isinstance(ids, list) or not all(isinstance(i, int) and not isinstance(i, bool) for i in ids):
        raise HTTPException(422, "Неверный список файлов")
    start = c.execute(text("select coalesce(max(pos), -1) + 1 from attachment where table_id = :t "
                           "and record_airtable_id = :r and field_id = :f"),
                      {"t": table_at, "r": rec_at, "f": field_at}).scalar()
    names = []
    for i, aid in enumerate(dict.fromkeys(ids)):
        n = c.execute(text(
            "update attachment set table_id = :t, record_airtable_id = :r, field_id = :f, pos = :p "
            "where id = :i and table_id is null and uploaded_by = :u returning filename"),
            {"t": table_at, "r": rec_at, "f": field_at, "p": start + i, "i": aid, "u": user["id"]}).scalar()
        if n is None:
            raise HTTPException(422, "Файл не найден среди ваших загрузок")
        names.append(n)
    return names


def _history(c, table_id, record_id, col, old, new, user):
    # смена вложений — правка записи: двигаем её версию (карточка перечитает историю, параллельная правка → 409)
    pg = c.execute(text("select pg_name from app_table where id = :t"), {"t": table_id}).scalar()
    c.execute(text(f"update {pg} set updated_at = now(), updated_by = :u where id = :r"), {"u": user["id"], "r": record_id})
    c.execute(text("insert into app_change (table_id, record_id, column_name, old, new, user_id) "
                   "values (:t, :r, :c, :o, :n, :u)").bindparams(bindparam("o", type_=JSONB), bindparam("n", type_=JSONB)),
              {"t": table_id, "r": record_id, "c": col, "o": old, "n": new, "u": user["id"]})


def _record(c, table_id: int, record_id: int, column: str, user: dict):
    title = table_title(c, table_id, user)
    if not can_edit(user, title):
        log.warning("правка вложений запрещена: %s → таблица %s", user["login"], table_id)   # E4
        raise HTTPException(403, "Нет прав на правку этой таблицы")
    t = c.execute(text("select pg_name, airtable_id from app_table where id = :t"), {"t": table_id}).first()
    f = c.execute(text("select airtable_id from app_field where table_id = :t and column_name = :c and kind = :k"),
                  {"t": table_id, "c": column, "k": ATTACH}).scalar()
    rec = c.execute(text(f"select airtable_id from {t.pg_name} where id = :r"), {"r": record_id}).scalar()
    if f is None or rec is None:
        raise HTTPException(404, "Нет такого поля или записи")
    return t.airtable_id, rec, f


def _names(c, tbl, rec, fld):
    return c.execute(text("select filename from attachment where table_id = :t and record_airtable_id = :r "
                          "and field_id = :f order by pos, id"), {"t": tbl, "r": rec, "f": fld}).scalars().all()


class AttachBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    column: str = Field(min_length=1, max_length=100)
    ids: list[int] = Field(min_length=1, max_length=50)


@router.post("/tables/{table_id}/records/{record_id}/attachments")
def attach(table_id: int, record_id: int, body: AttachBody, user: dict = Depends(active_user)):
    with engine.begin() as c:
        tbl, rec, fld = _record(c, table_id, record_id, body.column, user)
        old = _names(c, tbl, rec, fld)
        bind(c, tbl, rec, fld, body.ids, user)
        _history(c, table_id, record_id, body.column, old, _names(c, tbl, rec, fld), user)
    return {"ok": True}


@router.delete("/tables/{table_id}/records/{record_id}/attachments/{att_id}")
def detach(table_id: int, record_id: int, att_id: int, user: dict = Depends(active_user)):
    with engine.begin() as c:
        col = c.execute(text("select f.column_name from attachment a join app_field f on f.airtable_id = a.field_id "
                             "where a.id = :i and f.table_id = :t"), {"i": att_id, "t": table_id}).scalar()
        if col is None:
            raise HTTPException(404, "Нет такого файла")
        tbl, rec, fld = _record(c, table_id, record_id, col, user)
        old = _names(c, tbl, rec, fld)
        # ponytail: файл на диске остаётся (история, восстановление); чистить сирот — отдельной задачей
        n = c.execute(text("delete from attachment where id = :i and table_id = :t and record_airtable_id = :r"),
                      {"i": att_id, "t": tbl, "r": rec}).rowcount
        if not n:
            raise HTTPException(404, "Нет такого файла")
        _history(c, table_id, record_id, col, old, _names(c, tbl, rec, fld), user)
    return {"ok": True}

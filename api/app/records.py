import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, MetaData, Table, bindparam, func, select, text, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import DBAPIError

from . import attachments, computed, links
from .access import can_edit, hidden_columns, table_title
from .auth import active_user
from .db import engine
from migrate.compute import COMPUTED_KINDS

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tables")


def load_table(c, table_id: int):
    """Таблица данных (отражением) и её поля из app_field."""
    row = c.execute(text("select pg_name from app_table where id = :t"), {"t": table_id}).first()
    if not row:
        raise HTTPException(404, "Нет такой таблицы")
    fields = c.execute(
        text("select column_name, editable, options, kind, airtable_id from app_field "
             "where table_id = :t order by sort_order, id"),
        {"t": table_id},
    ).all()
    # ponytail: отражение на каждый запрос (~мс); кешировать, если станет заметно
    return Table(row.pg_name, MetaData(), autoload_with=c), fields


# ponytail: отдаём все строки сразу (13,6 тыс. ≈ 3 МБ JSON) — сетке нужен весь набор; постранично — если упрёмся
@router.get("/{table_id}/records")
def list_records(table_id: int, user: dict = Depends(active_user)):
    with engine.connect() as c:
        table_title(c, table_id, user)
        t, fields = load_table(c, table_id)
        hidden = hidden_columns(c, user, table_id)   # данные из финансов — только тем, кто их видит
        fields = [f for f in fields if f.column_name not in hidden]
        cols = [t.c.id, t.c.updated_at] + [t.c[f.column_name] for f in fields if f.column_name in t.c and not f.options.get("virtual")]
        if "airtable_id" not in t.c:
            return [dict(r) for r in c.execute(select(*cols).order_by(t.c.id)).mappings()]
        # вычисляемые поля — из движка (ключ — airtable_id записи, наружу его не отдаём)
        comp = computed.values()
        virt = [(f.column_name, comp.get(f.airtable_id, {})) for f in fields if f.kind in COMPUTED_KINDS]
        # связи — названиями связанных записей (R11); lookup ссылок — тоже
        opts = dict(c.execute(text("select airtable_id, options from app_field where kind = :k"), {"k": links.LINK}).all())
        mappers = links.lookup_mappers(c, fields, user, opts)
        linked = links.link_values(c, fields, user)
        files = [(f.column_name, f.airtable_id) for f in fields if f.kind == attachments.ATTACH]
        att = attachments.values_for(c, c.execute(text("select airtable_id from app_table where id = :t"), {"t": table_id}).scalar()) if files else {}
        out = []
        for r in c.execute(select(*cols, t.c.airtable_id).order_by(t.c.id)).mappings():
            d = dict(r)
            at = d.pop("airtable_id")
            d.update((col, mappers[col](vals.get(at)) if col in mappers else vals.get(at)) for col, vals in virt)
            d.update((col, None if vals is None else vals.get(d["id"], [])) for col, vals in linked)
            d.update((col, att.get((at, fid), [])) for col, fid in files)
            out.append(d)
        return out


class PatchBody(BaseModel):
    updated_at: datetime  # какое значение видел клиент
    values: dict[str, Any]


def _editable_table(c, table_id: int, user: dict, what: str):
    if not can_edit(user, table_title(c, table_id, user)):
        log.warning("правка запрещена: %s (%s) → таблица %s, %s", user["login"], user["role"], table_id, what)   # E4
        raise HTTPException(403, "Нет прав на правку этой таблицы")
    return load_table(c, table_id)


def _update(c, t, fields, table_id: int, record_id: int, body: PatchBody, user: dict, many: bool = False) -> dict:
    """Правка одной записи с проверкой версии и записью истории; вызывается внутри транзакции."""
    bad = set(body.values) - {f.column_name for f in fields if f.editable}
    if bad:
        raise HTTPException(422, "Нельзя менять поля: " + ", ".join(sorted(bad)))
    # Postgres молча кладёт true в int как 1 — отсекаем сами
    bad = {k for k, v in body.values.items() if isinstance(v, bool) and not isinstance(t.c[k].type, Boolean)}
    if bad:
        raise HTTPException(422, "Неверное значение: " + ", ".join(sorted(bad)))
    cols = sorted(body.values)
    as_json = [func.to_jsonb(t.c[k]).label(k) for k in cols]   # значения в JSON — как их хранит история
    mine = (t.c.id == record_id, t.c.updated_at == body.updated_at)
    old = c.execute(select(t.c.id, *as_json).where(*mine).with_for_update()).first()
    if not old:
        where = f" (запись {record_id})" if many else ""
        if c.execute(select(t.c.id).where(t.c.id == record_id)).first():
            raise HTTPException(409, "Запись уже изменили — обновите и повторите" + where)
        raise HTTPException(404, "Нет такой записи" + where)
    row = c.execute(
        update(t).where(*mine)
        .values(**body.values, updated_at=func.now(), updated_by=user["id"])
        .returning(t.c.id, t.c.updated_at, *as_json)
    ).first()
    changes = [{"t": table_id, "r": record_id, "c": k, "o": old._mapping[k], "n": row._mapping[k], "u": user["id"]}
               for k in cols if old._mapping[k] != row._mapping[k]]
    if changes:   # R11: только реально изменённые поля
        c.execute(text(
            "insert into app_change (table_id, record_id, column_name, old, new, user_id) "
            "values (:t, :r, :c, :o, :n, :u)"
        ).bindparams(bindparam("o", type_=JSONB), bindparam("n", type_=JSONB)), changes)
    return {"id": row.id, "updated_at": row.updated_at}


@router.patch("/{table_id}/records/{record_id}")
def patch_record(table_id: int, record_id: int, body: PatchBody, user: dict = Depends(active_user)):
    try:
        with engine.begin() as c:
            t, fields = _editable_table(c, table_id, user, f"запись {record_id}")
            res = _update(c, t, fields, table_id, record_id, body, user)
        computed.invalidate()   # после commit: зависящие от правки формулы и итоги пересчитаются
        return res
    except DBAPIError:
        # не отдаём текст ошибки БД наружу (раскрывает структуру) — деталь уходит в лог
        log.warning("patch_record %s/%s отклонён БД", table_id, record_id, exc_info=True)
        raise HTTPException(422, "Неверное значение поля")


class BatchItem(PatchBody):
    id: int


class BatchBody(BaseModel):
    items: list[BatchItem] = Field(min_length=1, max_length=1000)


@router.patch("/{table_id}/records")
def patch_records(table_id: int, body: BatchBody, user: dict = Depends(active_user)):
    """Пакетная правка (вставка из Excel, R9): всё или ничего, один пересчёт формул на пакет."""
    try:
        with engine.begin() as c:
            t, fields = _editable_table(c, table_id, user, f"пакет из {len(body.items)}")
            res = [_update(c, t, fields, table_id, it.id, it, user, many=True) for it in body.items]
        computed.invalidate()
        return res
    except DBAPIError:
        log.warning("patch_records %s отклонён БД", table_id, exc_info=True)
        raise HTTPException(422, "Неверное значение поля")


@router.get("/{table_id}/records/{record_id}/history")
def history(table_id: int, record_id: int, user: dict = Depends(active_user)):
    """R11: кто, когда, какое поле, было → стало; новые сверху."""
    with engine.connect() as c:
        table_title(c, table_id, user)
        rows = c.execute(text(
            "select ch.at, ch.column_name, coalesce(f.title, ch.column_name) as field, ch.old, ch.new, "
            "coalesce(u.name, 'система') as user "
            "from app_change ch "
            "left join app_field f on f.table_id = ch.table_id and f.column_name = ch.column_name "
            "left join app_user u on u.id = ch.user_id "
            "where ch.table_id = :t and ch.record_id = :r order by ch.at desc, ch.id desc"
        ), {"t": table_id, "r": record_id})
        return [r._asdict() for r in rows]

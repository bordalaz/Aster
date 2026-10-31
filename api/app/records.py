import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import Boolean, MetaData, Table, func, select, text, update
from sqlalchemy.exc import DBAPIError

from . import computed
from .auth import current_user
from .db import engine
from migrate.compute import COMPUTED_KINDS

router = APIRouter(prefix="/api/tables", dependencies=[Depends(current_user)])


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
def list_records(table_id: int):
    with engine.connect() as c:
        t, fields = load_table(c, table_id)
        cols = [t.c.id, t.c.updated_at] + [t.c[f.column_name] for f in fields if f.column_name in t.c and not f.options.get("virtual")]
        if "airtable_id" not in t.c:
            return [dict(r) for r in c.execute(select(*cols).order_by(t.c.id)).mappings()]
        # вычисляемые поля — из движка (ключ — airtable_id записи, наружу его не отдаём)
        comp = computed.values()
        virt = [(f.column_name, comp.get(f.airtable_id, {})) for f in fields if f.kind in COMPUTED_KINDS]
        out = []
        for r in c.execute(select(*cols, t.c.airtable_id).order_by(t.c.id)).mappings():
            d = dict(r)
            at = d.pop("airtable_id")
            d.update((col, vals.get(at)) for col, vals in virt)
            out.append(d)
        return out


class PatchBody(BaseModel):
    updated_at: datetime  # какое значение видел клиент
    values: dict[str, Any]


@router.patch("/{table_id}/records/{record_id}")
def patch_record(table_id: int, record_id: int, body: PatchBody, user: dict = Depends(current_user)):
    try:
        with engine.begin() as c:
            t, fields = load_table(c, table_id)
            bad = set(body.values) - {f.column_name for f in fields if f.editable}
            if bad:
                raise HTTPException(422, "Нельзя менять поля: " + ", ".join(sorted(bad)))
            # Postgres молча кладёт true в int как 1 — отсекаем сами
            bad = {k for k, v in body.values.items() if isinstance(v, bool) and not isinstance(t.c[k].type, Boolean)}
            if bad:
                raise HTTPException(422, "Неверное значение: " + ", ".join(sorted(bad)))
            row = c.execute(
                update(t)
                .where(t.c.id == record_id, t.c.updated_at == body.updated_at)
                .values(**body.values, updated_at=func.now(), updated_by=user["id"])
                .returning(t.c.id, t.c.updated_at)
            ).first()
            if not row:
                if c.execute(select(t.c.id).where(t.c.id == record_id)).first():
                    raise HTTPException(409, "Запись уже изменили — обновите и повторите")
                raise HTTPException(404, "Нет такой записи")
            res = dict(row._mapping)
        computed.invalidate()   # после commit: зависящие от правки формулы и итоги пересчитаются
        return res
    except DBAPIError:
        # не отдаём текст ошибки БД наружу (раскрывает структуру) — деталь уходит в лог
        logging.getLogger(__name__).warning("patch_record %s/%s отклонён БД", table_id, record_id, exc_info=True)
        raise HTTPException(422, "Неверное значение поля")

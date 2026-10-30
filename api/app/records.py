from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import MetaData, Table, select, text

from .auth import current_user
from .db import engine

router = APIRouter(prefix="/api/tables", dependencies=[Depends(current_user)])


def load_table(c, table_id: int):
    """Таблица данных (отражением) и её поля из app_field."""
    row = c.execute(text("select pg_name from app_table where id = :t"), {"t": table_id}).first()
    if not row:
        raise HTTPException(404, "Нет такой таблицы")
    fields = c.execute(
        text("select column_name, editable from app_field where table_id = :t order by sort_order, id"),
        {"t": table_id},
    ).all()
    # ponytail: отражение на каждый запрос (~мс); кешировать, если станет заметно
    return Table(row.pg_name, MetaData(), autoload_with=c), fields


# ponytail: отдаём все строки сразу (13,6 тыс. ≈ 3 МБ JSON) — сетке нужен весь набор; постранично — если упрёмся
@router.get("/{table_id}/records")
def list_records(table_id: int):
    with engine.connect() as c:
        t, fields = load_table(c, table_id)
        cols = [t.c.id, t.c.updated_at] + [t.c[f.column_name] for f in fields]
        return [dict(r) for r in c.execute(select(*cols).order_by(t.c.id)).mappings()]

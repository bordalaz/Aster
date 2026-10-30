from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from .auth import current_user
from .db import engine

router = APIRouter(prefix="/api", dependencies=[Depends(current_user)])


@router.get("/tables")
def tables():
    with engine.connect() as c:
        rows = c.execute(text("select id, title, primary_field from app_table order by sort_order, id"))
        return [r._asdict() for r in rows]


@router.get("/tables/{table_id}/fields")
def fields(table_id: int):
    with engine.connect() as c:
        if not c.execute(text("select 1 from app_table where id = :t"), {"t": table_id}).first():
            raise HTTPException(404, "Нет такой таблицы")
        rows = c.execute(
            text(
                "select id, column_name, title, kind, editable, options from app_field "
                "where table_id = :t order by sort_order, id"
            ),
            {"t": table_id},
        )
        return [r._asdict() for r in rows]

from fastapi import APIRouter, Depends
from sqlalchemy import text

from .access import can_edit, can_read, table_title
from .auth import active_user
from .db import engine

router = APIRouter(prefix="/api")


@router.get("/tables")
def tables(user: dict = Depends(active_user)):
    with engine.connect() as c:
        rows = c.execute(text("select id, title, primary_field from app_table order by sort_order, id"))
        return [r._asdict() for r in rows if can_read(user, r.title)]


@router.get("/tables/{table_id}/fields")
def fields(table_id: int, user: dict = Depends(active_user)):
    with engine.connect() as c:
        edit = can_edit(user, table_title(c, table_id, user))
        rows = c.execute(
            text(
                "select id, column_name, title, kind, editable, options from app_field "
                "where table_id = :t order by sort_order, id"
            ),
            {"t": table_id},
        )
        # editable — с учётом роли: интерфейс по нему решает, давать ли правку
        return [{**r._asdict(), "editable": r.editable and edit} for r in rows]

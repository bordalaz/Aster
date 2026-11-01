from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from . import links
from .access import can_edit, can_read, hidden_columns, table_title
from .auth import active_user
from .db import engine

router = APIRouter(prefix="/api")


@router.get("/tables")
def tables(user: dict = Depends(active_user)):
    with engine.connect() as c:
        rows = c.execute(text("select id, title, primary_field, hidden, description from app_table order by sort_order, id"))
        return [r._asdict() for r in rows if can_read(user, r.title)]


class TablePatch(BaseModel):
    hidden: bool


@router.patch("/tables/{table_id}")
def patch_table(table_id: int, body: TablePatch, user: dict = Depends(active_user)):
    """Скрыть/показать таблицу во вкладках — общий признак базы, как в Airtable; меняют админы."""
    if user["role"] not in ("superadmin", "admin"):
        raise HTTPException(403, "Скрывать таблицы могут только администраторы")
    with engine.begin() as c:
        table_title(c, table_id, user)
        c.execute(text("update app_table set hidden = :h where id = :t"), {"h": body.hidden, "t": table_id})
    return {"ok": True}


@router.get("/tables/{table_id}/fields")
def fields(table_id: int, user: dict = Depends(active_user)):
    with engine.connect() as c:
        edit = can_edit(user, table_title(c, table_id, user))
        rows = c.execute(
            text(
                "select id, column_name, title, kind, editable, options, description from app_field "
                "where table_id = :t order by sort_order, id"
            ),
            {"t": table_id},
        ).all()
        hidden = hidden_columns(c, user, table_id)   # данные из финансов — только тем, кто их видит
        rows = [r for r in rows if r.column_name not in hidden]
        targets = links.link_tables(c, rows, user)
        # editable — с учётом роли: интерфейс по нему решает, давать ли правку;
        # link_table — куда ведёт ссылка (None — таблица скрыта от роли)
        return [{**r._asdict(), "editable": r.editable and edit,
                 **({"link_table": targets[r.column_name]} if r.column_name in targets else {})} for r in rows]

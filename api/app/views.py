"""Виды сетки (spec R10): общие (owner_id = null, правят админы) и личные (правит владелец)."""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from .access import table_title
from .auth import ADMINS, active_user
from .db import engine

router = APIRouter(prefix="/api")

Op = Literal["eq", "neq", "contains", "not_contains", "empty", "not_empty", "gt", "gte", "lt", "lte",
             "any_of", "none_of", "contains_any"]
LIST_OPS = {"any_of", "none_of", "contains_any"}   # значение — список (из Airtable «любое из» и ИЛИ по одной колонке)
Col = Field(min_length=1, max_length=100)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SortItem(Strict):
    col: str = Col
    desc: bool = False


class FilterItem(Strict):
    col: str = Col
    op: Op
    value: (bool | float | Annotated[str, Field(max_length=500)]
            | Annotated[list[Annotated[str, Field(max_length=500)]], Field(max_length=50)] | None) = None

    @model_validator(mode="after")
    def _list_only_for_list_ops(self):
        if self.value is not None and isinstance(self.value, list) != (self.op in LIST_OPS):
            raise ValueError("список значений — только у условий «любое из»")
        return self


class ViewConfig(Strict):
    columns: list[str] | None = Field(None, max_length=500)    # видимые колонки по порядку; null — все
    widths: dict[str, int] | None = None
    sort: list[SortItem] | None = Field(None, max_length=10)
    filters: list[FilterItem] | None = Field(None, max_length=30)
    # группировка: до 3 уровней; строка — старый формат (один уровень)
    group: Annotated[str, Col] | Annotated[list[Annotated[str, Col]], Field(min_length=1, max_length=3)] | None = None
    source: Literal["airtable"] | None = None

    def used_columns(self) -> set[str]:
        return (set(self.columns or ()) | set(self.widths or ()) | {s.col for s in self.sort or ()}
                | {f.col for f in self.filters or ()} | set([self.group] if isinstance(self.group, str) else self.group or ()))


def check_config(c, table_id: int, cfg: ViewConfig) -> dict:
    """Колонки — только из полей таблицы (R37: имена — из метаданных); ширины — в разумных пределах."""
    known = set(c.execute(text("select column_name from app_field where table_id = :t"), {"t": table_id}).scalars())
    unknown = cfg.used_columns() - known
    if unknown:
        raise HTTPException(422, "Нет таких колонок: " + ", ".join(sorted(unknown)))
    if any(not 40 <= w <= 2000 for w in (cfg.widths or {}).values()):
        raise HTTPException(422, "Ширина колонки — от 40 до 2000")
    return cfg.model_dump(exclude_none=True)


def _out(r, user) -> dict:
    return {"id": r.id, "title": r.title, "config": r.config,
            "shared": r.owner_id is None, "mine": r.owner_id == user["id"]}


@router.get("/tables/{table_id}/views")
def list_views(table_id: int, user: dict = Depends(active_user)):
    with engine.connect() as c:
        table_title(c, table_id, user)
        rows = c.execute(text(
            "select id, title, owner_id, config from app_view "
            "where table_id = :t and kind = 'grid' and (owner_id is null or owner_id = :u) "
            "order by owner_id nulls first, sort_order, id"
        ), {"t": table_id, "u": user["id"]})
        return [_out(r, user) for r in rows]


class NewView(Strict):
    title: str = Field(min_length=1, max_length=200)
    shared: bool = False
    config: ViewConfig = ViewConfig()


@router.post("/tables/{table_id}/views")
def create_view(table_id: int, body: NewView, user: dict = Depends(active_user)):
    with engine.begin() as c:
        table_title(c, table_id, user)
        if body.shared and user["role"] not in ADMINS:
            raise HTTPException(403, "Общие виды создают администраторы")
        cfg = check_config(c, table_id, body.config)
        vid = c.execute(text(
            "insert into app_view (table_id, title, owner_id, config) values (:t, :n, :o, :c) returning id"
        ).bindparams(bindparam("c", type_=JSONB)),
            {"t": table_id, "n": body.title, "o": None if body.shared else user["id"], "c": cfg}).scalar()
    return {"id": vid}


def _own(c, view_id: int, user: dict):
    """Вид, который пользователь может менять. Чужой личный — 404 (не раскрываем), общий не-админу — 403."""
    v = c.execute(text("select id, table_id, owner_id from app_view where id = :i"), {"i": view_id}).first()
    if v is None or (v.owner_id is not None and v.owner_id != user["id"]):
        raise HTTPException(404, "Нет такого вида")
    table_title(c, v.table_id, user)
    if v.owner_id is None and user["role"] not in ADMINS:
        raise HTTPException(403, "Общие виды меняют администраторы")
    return v


class ViewPatch(Strict):
    title: str | None = Field(None, min_length=1, max_length=200)
    config: ViewConfig | None = None


@router.patch("/views/{view_id}")
def patch_view(view_id: int, body: ViewPatch, user: dict = Depends(active_user)):
    with engine.begin() as c:
        v = _own(c, view_id, user)
        if body.title is not None:
            c.execute(text("update app_view set title = :n where id = :i"), {"n": body.title, "i": view_id})
        if body.config is not None:
            c.execute(text("update app_view set config = :c where id = :i").bindparams(bindparam("c", type_=JSONB)),
                      {"c": check_config(c, v.table_id, body.config), "i": view_id})
    return {"ok": True}


@router.delete("/views/{view_id}")
def delete_view(view_id: int, user: dict = Depends(active_user)):
    with engine.begin() as c:
        _own(c, view_id, user)
        c.execute(text("delete from app_view where id = :i"), {"i": view_id})
    return {"ok": True}

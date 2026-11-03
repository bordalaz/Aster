"""Виды сетки (spec R10): общие (owner_id = null, правят админы) и личные (правит владелец)."""
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from .access import can_read, table_title
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
    # настройки, перенесённые из Airtable (migrate/view_meta.py): без них сохранить такой вид было нельзя (422)
    frozen: int | None = Field(None, ge=0, le=50)
    rowHeight: Literal["small", "medium", "large", "xlarge"] | None = None
    summary: dict[Annotated[str, Col], Annotated[str, Field(max_length=30)]] | None = Field(None, max_length=500)
    color: dict[str, Any] | None = None
    locked: bool | None = None
    rowOrder: list[int] | None = Field(None, max_length=200_000)   # ручной порядок — перетаскивание строк
    cover: Annotated[str, Col] | None = None   # галерея, канбан: поле вложений — обложка карточки
    stack: Annotated[str, Col] | None = None   # канбан: поле выбора — колонки
    hideEmpty: bool | None = None              # канбан: пустые колонки не показывать
    start: Annotated[str, Col] | None = None   # календарь: поле начала
    end: Annotated[str, Col] | None = None     # календарь: поле конца (необязательно)
    # таймлайн: stacked — записи плотно по дорожкам (иначе строка на запись); totals — нижняя строка «Всего»
    layout: Literal["stacked"] | None = None
    groupDesc: bool | None = None
    labelStyle: dict[Annotated[str, Col], dict[str, bool]] | None = Field(None, max_length=50)
    totals: dict[str, Any] | None = None

    def used_columns(self) -> set[str]:
        return (set(self.columns or ()) | set(self.widths or ()) | {x for x in (self.cover, self.stack, self.start, self.end) if x} | set(self.labelStyle or ()) | set(self.summary or ()) | {s.col for s in self.sort or ()}
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
    out = {"id": r.id, "title": r.title, "kind": r.kind, "config": r.config,
           "shared": r.owner_id is None and r.at_owner is None, "mine": r.owner_id == user["id"]}
    if r.owner_id is None and r.at_owner:
        out["airtable_owner"] = r.at_owner["name"]   # личный вид Airtable, ещё ничей — видят админы
    return out


@router.get("/tables/{table_id}/views")
def list_views(table_id: int, user: dict = Depends(active_user)):
    with engine.connect() as c:
        table_title(c, table_id, user)
        rows = c.execute(text(
            "select id, title, kind, owner_id, config, at_owner from app_view "
            "where table_id = :t and kind in ('grid', 'gallery', 'kanban', 'calendar', 'timeline') "
            "and ((owner_id is null and (at_owner is null or :adm)) or owner_id = :u) "
            "order by owner_id nulls first, sort_order, id"
        ), {"t": table_id, "u": user["id"], "adm": user["role"] in ADMINS})
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


class RowOrder(Strict):
    order: list[int] = Field(max_length=200_000)


@router.put("/views/{view_id}/row-order")
def put_row_order(view_id: int, body: RowOrder, user: dict = Depends(active_user)):
    """Ручной порядок записей вида — перетаскивание строк, как в Airtable (у всех, кто смотрит вид).
    Общий вид меняют администраторы (_own), личный — владелец."""
    with engine.begin() as c:
        _own(c, view_id, user)
        c.execute(text("update app_view set config = jsonb_set(config, '{rowOrder}', :o) where id = :i")
                  .bindparams(bindparam("o", type_=JSONB)), {"o": body.order, "i": view_id})
    return {"ok": True}


@router.delete("/views/{view_id}")
def delete_view(view_id: int, user: dict = Depends(active_user)):
    with engine.begin() as c:
        _own(c, view_id, user)
        c.execute(text("delete from app_view where id = :i"), {"i": view_id})
    return {"ok": True}


# --- личные виды Airtable: автору — на выбор (решение владельца) ---

def is_author(user: dict, owner: dict | None) -> bool:
    """Автор вида Airtable — наш пользователь, если в его ФИО есть все слова имени автора («Юрий Чернов»
    ↔ «Чернов Юрий Петрович»). ponytail: по имени, привязка по почте — когда у пользователей будет почта."""
    words = (owner or {}).get("name", "").casefold().split()
    have = set((user.get("name") or "").casefold().replace("ё", "е").split())
    return len(words) >= 2 and all(w.replace("ё", "е") in have for w in words)


def _offer(c, user: dict) -> list:
    rows = c.execute(text(
        "select v.id, v.title, v.kind, v.table_id, v.at_owner, t.title as table from app_view v "
        "join app_table t on t.id = v.table_id where v.owner_id is null and v.at_owner is not null "
        "order by t.sort_order, t.id, v.sort_order, v.id")).all()
    return [r for r in rows if is_author(user, r.at_owner) and can_read(user, r.table)]


@router.get("/views/airtable/offer")
def airtable_offer(user: dict = Depends(active_user)):
    """Личные виды Airtable этого пользователя — один раз, пока он не выбрал."""
    with engine.connect() as c:
        if c.execute(text("select at_views_offered from app_user where id = :u"), {"u": user["id"]}).scalar():
            return []
        return [{"id": r.id, "title": r.title, "kind": r.kind, "table_id": r.table_id, "table": r.table} for r in _offer(c, user)]


class Claim(Strict):
    ids: list[int] = Field(max_length=500)


@router.post("/views/airtable/offer")
def airtable_claim(body: Claim, user: dict = Depends(active_user)):
    """Выбранные — копии в личные виды пользователя; пустой список — «не нужно». Больше не предлагаем."""
    with engine.begin() as c:
        allowed = {r.id for r in _offer(c, user)}
        if set(body.ids) - allowed:
            raise HTTPException(404, "Нет такого вида")
        for i in dict.fromkeys(body.ids):
            c.execute(text("insert into app_view (table_id, title, kind, config, sort_order, owner_id) "
                           "select table_id, title, kind, config, sort_order, :u from app_view where id = :i"),
                      {"u": user["id"], "i": i})
        c.execute(text("update app_user set at_views_offered = true where id = :u"), {"u": user["id"]})
    return {"ok": True, "added": len(set(body.ids))}

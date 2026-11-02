"""Страницы интерфейсов Airtable (дашборды): плитки, графики, сетка, фильтры страницы. Считает их браузер
по /records; здесь — только состав. Страница видна, если видны все её таблицы и поля (финансы — R3)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from .access import can_read, hidden_columns
from .auth import active_user
from .db import engine

router = APIRouter(prefix="/api")


def _parts(rows):
    """(таблица, поле) всех элементов, включая вложенные ряды."""
    for r in rows:
        for col in r:
            for it in col:
                if "rows" in it:
                    yield from _parts(it["rows"])
                    continue
                y = it.get("y") or {}
                for f in (it.get("col"), it.get("x"), it.get("group"), y.get("col"), *(it.get("columns") or [])):
                    yield it["table"], f


def _visible(c, user: dict, cfg: dict) -> bool:
    used = set(_parts(cfg["rows"])) | {(f["table"], x["col"]) for f in cfg["filters"] for x in f["conds"]}
    titles = dict(c.execute(text("select id, title from app_table")).all())
    for t in {t for t, _ in used}:
        if t not in titles or not can_read(user, titles[t]):
            return False
        if {f for tt, f in used if tt == t and f} & hidden_columns(c, user, t):
            return False
    return True


@router.get("/pages")
def list_pages(user: dict = Depends(active_user)):
    with engine.connect() as c:
        rows = c.execute(text("select id, title, config from app_page order by sort_order, id")).all()
        return [{"id": r.id, "title": r.title} for r in rows if _visible(c, user, r.config)]


@router.get("/pages/{page_id}")
def get_page(page_id: int, user: dict = Depends(active_user)):
    with engine.connect() as c:
        r = c.execute(text("select id, config from app_page where id = :i"), {"i": page_id}).first()
        if r is None or not _visible(c, user, r.config):
            raise HTTPException(404, "Нет такой страницы")
        return {"id": r.id, **r.config}

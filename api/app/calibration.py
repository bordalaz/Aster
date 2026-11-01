"""Калибровка (spec R22–R26, E11, E13, E14). Одно событие на пару МИР × кожух с файлами; у инклинометра,
гамма-зонда и резистивиметра — только дата (R23). Тип прибора — по номенклатуре (Оборудование → Номенклатура).
Видит и записывает тот, кто видит Оборудование (R5: мастер записывает калибровку формой)."""
import datetime as dt
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from . import links
from .auth import ADMINS, active_user
from .access import table_title
from .db import engine

router = APIRouter(prefix="/api")

EQ, NOM = "Оборудование", "Номенклатура"
FILES = "app_calibration"            # attachment.table_id для файлов калибровок
OFF = {"Списан", "Оставлено в скважине"}   # E11: в выборе не показываем
SINGLE = ("инклинометр", "гамма-зонд", "резистивиметр")


def _kind(nom: str) -> str | None:
    n = (nom or "").strip().lower()
    if n == "мир":
        return "mir"
    if n.startswith("кожух резистивиметра"):
        return "housing"
    if any(s in n for s in SINGLE):
        return "single"
    return None


def _num(serial: str | None, name: str) -> str:
    """Номер для имени файла: серийный, иначе последние цифры названия; чистые цифры — до 3 знаков (R25)."""
    s = (serial or "").strip() or (re.findall(r"\d+", name or "") or [""])[-1]
    s = re.sub(r"[^\w-]+", "-", s.replace("/", "-")).strip("-") or "000"
    return s.zfill(3) if s.isdigit() else s


def _pattern(nom: str) -> str | None:
    m = re.search(r"\d+/\d+", nom or "")
    return m.group(0) if m else None


def _equipment(c, user) -> dict:
    """{id записи: {id, name, kind, active, num, size, pattern}} — МИРы, кожухи и одиночные приборы."""
    table_title(c, c.execute(text("select id from app_table where title = :t"), {"t": EQ}).scalar() or 0, user)
    eq = c.execute(text("select id, pg_name, airtable_id from app_table where title = :t"), {"t": EQ}).first()
    nom = c.execute(text("select id, pg_name, airtable_id from app_table where title = :t"), {"t": NOM}).first()
    cols = {r.title: r.column_name for r in c.execute(text(
        "select title, column_name from app_field where table_id = :t and (options->>'virtual') is null"), {"t": eq.id})}
    nn = c.execute(text("select column_name from app_field where table_id = :t and title = 'Наименование'"), {"t": nom.id}).scalar()
    link = c.execute(text(
        "select m.link_table, m.side from app_field f join at_link_meta m on m.field_id = f.airtable_id "
        "where f.table_id = :t and f.kind = :k and f.options->>'linkedTableId' = :n order by f.sort_order limit 1"),
        {"t": eq.id, "k": links.LINK, "n": nom.airtable_id}).first()
    if not (nn and link):
        return {}
    me, other, pos = ("src", "dst", "pos") if link.side == "src" else ("dst", "src", "rpos")
    first = {}
    for m, o in c.execute(text(f"select {me}, {other} from {link.link_table} order by {me}, {pos} nulls last, {other}")):
        first.setdefault(m, o)
    nom_names = dict(c.execute(text(f"select id, {nn} from {nom.pg_name}")).all())
    sizes = dict(c.execute(text("select pattern, size from app_housing_size")).all())
    st, sn = cols.get("Статус"), cols.get("Серийный номер")
    rows = c.execute(text(f"select id, {st or 'null'} as st, {sn or 'null'}::text as sn from {eq.pg_name}")).all()
    names, _ = links.Names(c, user).of(eq.airtable_id)
    out = {}
    for r in rows:
        nomen = nom_names.get(first.get(r.id))
        kind = _kind(nomen)
        if kind is None:
            continue
        p = _pattern(nomen) if kind == "housing" else None
        out[r.id] = {"id": r.id, "name": names.get(r.id) or f"№{r.id}", "kind": kind, "active": r.st not in OFF,
                     "num": _num(r.sn, names.get(r.id, "")), "pattern": p, "size": sizes.get(p)}
    return out


@router.get("/calibration/equipment")
def equipment(user: dict = Depends(active_user)):
    with engine.connect() as c:
        eq = [e for e in _equipment(c, user).values() if e["active"]]
    pick = lambda k: sorted(({x: e[x] for x in ("id", "name", "size")} for e in eq if e["kind"] == k), key=lambda e: e["name"])  # noqa: E731
    return {"mirs": pick("mir"), "housings": pick("housing"), "singles": pick("single"),
            "unknown_sizes": sorted({e["pattern"] for e in eq if e["kind"] == "housing" and e["pattern"] and not e["size"]})}


class SizeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pattern: str = Field(pattern=r"^\d{2,4}/\d{2,4}$")
    size: str = Field(pattern=r"^\d{1,2}(\.\d{1,2})?$")


@router.put("/calibration/sizes")
def set_size(body: SizeBody, user: dict = Depends(active_user)):
    """E14: админ добавляет габарит для номенклатуры кожуха."""
    if user["role"] not in ADMINS:
        raise HTTPException(403, "Габарит добавляют админы")
    with engine.begin() as c:
        c.execute(text("insert into app_housing_size values (:p, :s) on conflict (pattern) do update set size = excluded.size"),
                  {"p": body.pattern, "s": body.size})
    return {"ok": True}


class CalBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(min_length=8, max_length=64)
    date: dt.date
    equipment_id: int
    housing_id: int | None = None
    note: str | None = Field(None, max_length=2000)
    files: list[int] = Field(default_factory=list, max_length=20)


def _bind_files(c, cal_id: int, base: str, ids: list[int], user: dict) -> None:
    """Свои загрузки → к калибровке, с именем по шаблону R25; совпадение имени — _2, _3… (E13)."""
    taken = set(c.execute(text("select filename from attachment where table_id = :t"), {"t": FILES}).scalars())
    for i, aid in enumerate(dict.fromkeys(ids)):
        orig = c.execute(text("select filename from attachment where id = :i and table_id is null and uploaded_by = :u"),
                         {"i": aid, "u": user["id"]}).scalar()
        if orig is None:
            raise HTTPException(422, "Файл не найден среди ваших загрузок")
        ext = Path(orig).suffix.lower()
        name, n = f"{base}{ext}", 1
        while name in taken:
            n += 1
            name = f"{base}_{n}{ext}"
        taken.add(name)
        c.execute(text("update attachment set table_id = :t, record_airtable_id = :r, field_id = 'files', pos = :p, "
                       "original_name = filename, filename = :n where id = :i"),
                  {"t": FILES, "r": str(cal_id), "p": i, "n": name, "i": aid})


@router.post("/calibrations")
def create(body: CalBody, user: dict = Depends(active_user)):
    try:
        with engine.begin() as c:
            done = c.execute(text("select id from app_calibration where submit_key = :k"), {"k": body.key}).scalar()
            if done is not None:
                return {"id": done}
            eq = _equipment(c, user)
            e, h = eq.get(body.equipment_id), eq.get(body.housing_id) if body.housing_id else None
            if e is None or e["kind"] not in ("mir", "single") or not e["active"]:
                raise HTTPException(422, "Выберите действующий МИР или прибор")
            if e["kind"] == "mir" and (h is None or h["kind"] != "housing" or not h["active"]):
                raise HTTPException(422, "Выберите действующий кожух резистивиметра")
            if e["kind"] == "single" and (body.housing_id or body.files):
                raise HTTPException(422, "У этого прибора калибровка — только дата, без пары и файлов")
            cid = c.execute(text(
                "insert into app_calibration (at, equipment_id, housing_id, note, created_by, submit_key) "
                "values (:a, :e, :h, :n, :u, :k) returning id"),
                {"a": body.date, "e": e["id"], "h": h["id"] if h else None, "n": body.note, "u": user["id"], "k": body.key}).scalar()
            if body.files:
                size = f"_{h['size']}" if h["size"] else ""   # E14: неизвестный габарит — имя без него
                _bind_files(c, cid, f"МИР-{e['num']}_КОЖУХ-{h['num']}{size}_{body.date.isoformat()}", body.files, user)
    except IntegrityError:   # тот же ключ одновременно
        with engine.connect() as c:
            done = c.execute(text("select id from app_calibration where submit_key = :k"), {"k": body.key}).scalar()
        if done is None:
            raise HTTPException(409, "Повторите отправку")
        return {"id": done}
    return {"id": cid}


@router.get("/calibrations")
def for_equipment(equipment_id: int, user: dict = Depends(active_user)):
    """Калибровки прибора — и где он МИР/прибор, и где он кожух (R22: видно в карточках обоих)."""
    with engine.connect() as c:
        eq = _equipment(c, user)
        rows = c.execute(text(
            "select k.id, k.at, k.equipment_id, k.housing_id, k.note, u.name as by from app_calibration k "
            "left join app_user u on u.id = k.created_by where :e in (k.equipment_id, k.housing_id) order by k.at desc, k.id desc"),
            {"e": equipment_id}).all()
        files: dict = {}
        for f in c.execute(text("select id, record_airtable_id, filename, size, mime from attachment where table_id = :t "
                                "and record_airtable_id = any(:r) order by pos"), {"t": FILES, "r": [str(r.id) for r in rows]}):
            files.setdefault(int(f.record_airtable_id), []).append({"id": f.id, "name": f.filename, "size": f.size, "mime": f.mime})
    name = lambda i: None if i is None else {"id": i, "name": eq.get(i, {}).get("name", f"№{i}")}  # noqa: E731
    return [{"id": r.id, "date": r.at.isoformat(), "equipment": name(r.equipment_id), "housing": name(r.housing_id),
             "note": r.note, "by": r.by, "files": files.get(r.id, [])} for r in rows]


@router.get("/calibration/matrix")
def matrix(user: dict = Depends(active_user)):
    """R24: строки — МИРы, колонки — кожухи, в ячейке последняя совместная калибровка."""
    with engine.connect() as c:
        eq = _equipment(c, user)
        cells = c.execute(text(
            "select distinct on (equipment_id, housing_id) equipment_id, housing_id, at, id, "
            "count(*) over (partition by equipment_id, housing_id) as n from app_calibration "
            "where housing_id is not null order by equipment_id, housing_id, at desc, id desc")).all()
    pick = lambda k: sorted(({"id": e["id"], "name": e["name"]} for e in eq.values() if e["kind"] == k and e["active"]),  # noqa: E731
                            key=lambda e: e["name"])
    return {"mirs": pick("mir"), "housings": pick("housing"),
            "cells": [{"mir": r.equipment_id, "housing": r.housing_id, "date": r.at.isoformat(), "count": r.n, "id": r.id}
                      for r in cells]}

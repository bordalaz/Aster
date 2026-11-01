"""Формы ввода (spec R12, R5): список, состав, отправка. Отправлять может тот, кто видит таблицу формы;
повтор с тем же ключом отправки возвращает ту же запись (R36, E6)."""
import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, bindparam, func, insert, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import DBAPIError, IntegrityError

from . import computed, links
from .access import can_read, hidden_columns, table_title
from .auth import active_user
from .db import engine
from .records import load_table

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

# ponytail: вложения в формах — следующим шагом (загрузка файлов, R27); пока такие поля форма не показывает
SKIP = {"multipleAttachments"}


def _form(c, form_id: int, user: dict):
    """Форма, доступная пользователю, и её поля; недоступная — 404, как несуществующая."""
    f = c.execute(text("select f.id, f.title, f.after_message, f.fields, f.table_id, t.title as table "
                       "from app_form f join app_table t on t.id = f.table_id where f.id = :i"), {"i": form_id}).first()
    if f is None or not can_read(user, f.table):
        raise HTTPException(404, "Нет такой формы")
    meta = {r.column_name: r for r in c.execute(text(
        "select column_name, title, kind, options, editable from app_field where table_id = :t"), {"t": f.table_id})}
    if {x["col"] for x in f.fields} & hidden_columns(c, user, f.table_id):
        raise HTTPException(404, "Нет такой формы")   # поле из финансов — форма целиком не для этой роли
    fields = []
    for x in f.fields:
        m = meta.get(x["col"])
        if m is None or m.kind in SKIP or not (m.kind == links.LINK or (m.editable and not m.options.get("virtual"))):
            continue
        fields.append({"column_name": m.column_name, "title": m.title, "kind": m.kind, "options": m.options,
                       "required": x["required"], "help": x.get("help")})
    return f, fields


@router.get("/forms")
def list_forms(user: dict = Depends(active_user)):
    with engine.connect() as c:
        rows = c.execute(text("select f.id from app_form f order by f.sort_order, f.id")).scalars().all()
        out = []
        for fid in rows:
            try:
                f, _ = _form(c, fid, user)
            except HTTPException:
                continue
            out.append({"id": f.id, "title": f.title, "table_id": f.table_id, "table": f.table})
        return out


@router.get("/forms/{form_id}")
def get_form(form_id: int, user: dict = Depends(active_user)):
    with engine.connect() as c:
        f, fields = _form(c, form_id, user)
        names = links.Names(c, user)
        for x in fields:
            if x["kind"] == links.LINK:
                t = names.readable(x["options"].get("linkedTableId"))
                x["link_table"] = t.id if t else None
        return {"id": f.id, "title": f.title, "after_message": f.after_message, "table_id": f.table_id, "fields": fields}


@router.get("/tables/{table_id}/names")
def record_names(table_id: int, user: dict = Depends(active_user)):
    """Названия записей (первичное поле) — для выбора связанной записи в форме."""
    with engine.connect() as c:
        table_title(c, table_id, user)
        at = c.execute(text("select airtable_id from app_table where id = :t"), {"t": table_id}).scalar()
        names, _ = links.Names(c, user).of(at)
        return sorted(({"id": i, "name": n} for i, n in names.items()), key=lambda x: x["name"])


class SubmitBody(BaseModel):
    key: str = Field(min_length=8, max_length=64)   # ключ отправки с клиента (E6)
    values: dict[str, Any]


def _empty(v) -> bool:
    return v is None or v == "" or v == []


def _link_ids(c, names: links.Names, field: dict, v) -> list[int]:
    t = names.readable(field["options"].get("linkedTableId"))
    if t is None or not isinstance(v, list) or not all(isinstance(i, int) and not isinstance(i, bool) for i in v):
        raise HTTPException(422, f"Неверная связь: {field['title']}")
    ok = set(c.execute(text(f"select id from {t.pg_name} where id = any(:i)"), {"i": v}).scalars())
    if set(v) - ok:
        raise HTTPException(422, f"Нет таких записей: {field['title']}")
    return list(dict.fromkeys(v))


def _check(field: dict, v, col_type) -> None:
    kind, title = field["kind"], field["title"]
    choices = {ch["name"] for ch in field["options"].get("choices", [])}
    if kind == "singleSelect" and v not in choices:
        raise HTTPException(422, f"Нет такого варианта: {title}")
    if kind == "multipleSelects" and (not isinstance(v, list) or set(v) - choices):
        raise HTTPException(422, f"Нет такого варианта: {title}")
    if isinstance(v, bool) != isinstance(col_type, Boolean):   # Postgres молча кладёт true в int как 1
        raise HTTPException(422, f"Неверное значение: {title}")


@router.post("/forms/{form_id}/submit")
def submit(form_id: int, body: SubmitBody, user: dict = Depends(active_user)):
    try:
        with engine.begin() as c:
            f, fields = _form(c, form_id, user)
            done = c.execute(text("select record_id from app_form_submit where key = :k and form_id = :f"),
                             {"k": body.key, "f": form_id}).scalar()
            if done is not None:
                return {"id": done}
            by = {x["column_name"]: x for x in fields}
            bad = set(body.values) - set(by)
            if bad:
                raise HTTPException(422, "Нет таких полей в форме: " + ", ".join(sorted(bad)))
            missing = [x["title"] for x in fields if x["required"] and _empty(body.values.get(x["column_name"]))]
            if missing:
                raise HTTPException(422, "Заполните: " + ", ".join(missing))
            t, _ = load_table(c, f.table_id)
            names = links.Names(c, user)
            stored, linked = {}, {}
            for col, v in body.values.items():
                if _empty(v):
                    continue
                if by[col]["kind"] == links.LINK:
                    linked[col] = _link_ids(c, names, by[col], v)
                else:
                    _check(by[col], v, t.c[col].type)
                    stored[col] = v
            rid = c.execute(insert(t).values(
                **stored, airtable_id="aster" + uuid.uuid4().hex, created_at=func.now(), created_by=user["id"],
                updated_by=user["id"]).returning(t.c.id)).scalar()
            _write_links(c, f.table_id, rid, linked)
            new = dict(c.execute(select(*[func.to_jsonb(t.c[k]).label(k) for k in stored]).where(t.c.id == rid)).first()._mapping) if stored else {}
            new |= {k: v for k, v in linked.items()}
            c.execute(text(
                "insert into app_change (table_id, record_id, column_name, old, new, user_id) values (:t, :r, :c, null, :n, :u)"
            ).bindparams(bindparam("n", type_=JSONB)),
                [{"t": f.table_id, "r": rid, "c": k, "n": v, "u": user["id"]} for k, v in new.items()] or
                [{"t": f.table_id, "r": rid, "c": "id", "n": rid, "u": user["id"]}])
            c.execute(text("insert into app_form_submit (key, form_id, record_id, user_id) values (:k, :f, :r, :u)"),
                      {"k": body.key, "f": form_id, "r": rid, "u": user["id"]})
    except IntegrityError:
        # тот же ключ прислали одновременно — запись создала параллельная отправка
        with engine.connect() as c:
            done = c.execute(text("select record_id from app_form_submit where key = :k and form_id = :f"),
                             {"k": body.key, "f": form_id}).scalar()
        if done is None:
            raise HTTPException(409, "Повторите отправку")
        return {"id": done}
    except DBAPIError:
        log.warning("submit формы %s отклонён БД", form_id, exc_info=True)
        raise HTTPException(422, "Неверное значение поля")
    computed.invalidate()
    log.info("форма %s: %s создал запись %s", form_id, user["login"], rid)
    return {"id": rid}


def _write_links(c, table_id: int, rid: int, linked: dict) -> None:
    """Связи новой записи — в таблицы пар; у связанных записей она встаёт в конец их списка."""
    if not linked:
        return
    meta = {col: (lt, side) for col, lt, side in c.execute(text(
        "select f.column_name, m.link_table, m.side from app_field f join at_link_meta m on m.field_id = f.airtable_id "
        "where f.table_id = :t"), {"t": table_id})}
    for col, ids in linked.items():
        lt, side = meta[col]
        me, other, pos, opos = ("src", "dst", "pos", "rpos") if side == "src" else ("dst", "src", "rpos", "pos")
        for i, o in enumerate(ids):
            c.execute(text(
                f"insert into {lt} ({me}, {other}, {pos}, {opos}) values (:me, :o, :i, "
                f"(select coalesce(max({opos}), -1) + 1 from {lt} where {other} = :o))"), {"me": rid, "o": o, "i": i})

"""Корзина (решения владельца — memory trash-decisions): удалённая запись переносится сюда целиком —
строка и её связи. В таблице её больше нет, поэтому она не всплывает нигде: ни в видах, ни в связях,
итогах и формулах, ни в интерфейсах и формах. Восстановление возвращает строку с тем же id —
история, комментарии и вложения снова при ней; связи — тоже (если вторая запись на месте).

Удаляют и восстанавливают администраторы; навсегда — только суперадмин; хранится год."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from . import attachments, computed, links
from .access import can_read, hidden_columns
from .auth import ADMINS, active_user
from .db import engine
from .records import _editable_table

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api")
KEEP_DAYS = 365


class Ids(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=1000)


def _admin(user: dict):
    if user["role"] not in ADMINS:
        raise HTTPException(403, "Корзина — для администраторов")


def _purge_old(c) -> None:
    c.execute(text(f"delete from app_trash where deleted_at < now() - interval '{KEEP_DAYS} days'"))


def _link_columns(c, table_id: int) -> set[tuple[str, str]]:
    """{(таблица пар, колонка с id записи этой таблицы)} — все связи, где участвует таблица."""
    return {(r.link_table, r.side) for r in c.execute(text(
        "select m.link_table, m.side from at_link_meta m join app_field f on f.airtable_id = m.field_id "
        "where f.table_id = :t"), {"t": table_id})}


def _fk_target(c, link_table: str, col: str) -> str:
    """Таблица данных, на которую ссылается колонка пары (src/dst)."""
    return c.execute(text(
        "select confrelid::regclass::text from pg_constraint c join pg_attribute a "
        "on a.attrelid = c.conrelid and a.attnum = any(c.conkey) "
        "where c.contype = 'f' and c.conrelid = cast(:t as regclass) and a.attname = :c"),
        {"t": link_table, "c": col}).scalar()


def _title(c, table, rec_id: int, user: dict) -> str:
    """Название записи (первичное поле, в т.ч. вычисляемое) — пока она ещё в таблице."""
    if table.airtable_id:
        names, _ = links.Names(c, user).of(table.airtable_id)
        return names.get(rec_id, "")
    v = c.execute(text(f'select "{table.primary_field}"::text from {table.pg_name} where id = :i'), {"i": rec_id}).scalar()
    return v or ""


def _table(c, table_id: int):
    t = c.execute(text("select id, title, pg_name, primary_field, airtable_id from app_table where id = :t"),
                  {"t": table_id}).first()
    if t is None:
        raise HTTPException(404, "Нет такой таблицы")
    return t


@router.post("/tables/{table_id}/records/delete")
def delete_records(table_id: int, body: Ids, user: dict = Depends(active_user)):
    """В корзину. Права — как на правку таблицы (у нас правят администраторы)."""
    with engine.begin() as c:
        _editable_table(c, table_id, user, f"удаление {len(body.ids)} зап.")
        t = _table(c, table_id)
        pairs = _link_columns(c, table_id)
        out = []
        for rec_id in dict.fromkeys(body.ids):
            row = c.execute(text(f"select to_jsonb(x) from {t.pg_name} x where id = :i for update"), {"i": rec_id}).scalar()
            if row is None:
                continue
            saved = [{"table": lt, "col": col, "rows": c.execute(text(
                f"select coalesce(jsonb_agg(to_jsonb(l)), '[]') from {lt} l where {col} = :i"), {"i": rec_id}).scalar()}
                for lt, col in sorted(pairs)]
            title = _title(c, t, rec_id, user)
            out.append(c.execute(text(
                "insert into app_trash (table_id, record_id, title, data, deleted_by) values (:t, :r, :n, :d, :u) returning id"
            ).bindparams(bindparam("d", type_=JSONB)),
                {"t": table_id, "r": rec_id, "n": title, "d": {"row": row, "links": [s for s in saved if s["rows"]]},
                 "u": user["id"]}).scalar())
            c.execute(text(f"delete from {t.pg_name} where id = :i"), {"i": rec_id})   # связи уходят каскадом — их копия в корзине
            c.execute(text("insert into app_change (table_id, record_id, column_name, old, new, user_id) "
                           "values (:t, :r, 'id', to_jsonb(:r), null, :u)"), {"t": table_id, "r": rec_id, "u": user["id"]})
        _purge_old(c)
    if not out:
        raise HTTPException(404, "Нет таких записей")
    computed.invalidate(full=True)   # записи нет — во всех формулах, итогах и подстановках
    log.info("в корзину: %s, таблица %s, записи %s", user["login"], table_id, body.ids)
    return {"trash": out}


@router.post("/trash/restore")
def restore(body: Ids, user: dict = Depends(active_user)):
    """Вернуть записи из корзины (и «Отменить» сразу после удаления). Связь, вторая запись которой
    сама в корзине, переезжает к той — вернётся вместе с ней."""
    _admin(user)
    restored = []
    with engine.begin() as c:
        for tid in dict.fromkeys(body.ids):
            item = c.execute(text("select id, table_id, record_id, data from app_trash where id = :i for update"), {"i": tid}).first()
            if item is None:
                continue
            t = _table(c, item.table_id)
            if c.execute(text(f"select 1 from {t.pg_name} where id = :i"), {"i": item.record_id}).first():
                raise HTTPException(409, f"Запись №{item.record_id} уже есть в таблице «{t.title}»")
            c.execute(text(f"insert into {t.pg_name} select * from jsonb_populate_record(null::{t.pg_name}, :r)")
                      .bindparams(bindparam("r", type_=JSONB)), {"r": item.data["row"]})
            for ln in item.data.get("links", []):
                other = "dst" if ln["col"] == "src" else "src"
                target = _fk_target(c, ln["table"], other)
                for r in ln["rows"]:
                    if c.execute(text(f"select 1 from {target} where id = :i"), {"i": r[other]}).first():
                        c.execute(text(f"insert into {ln['table']} select * from jsonb_populate_record(null::{ln['table']}, :r) "
                                       "on conflict do nothing").bindparams(bindparam("r", type_=JSONB)), {"r": r})
                    else:
                        _hand_over(c, target, r[other], ln["table"], other, r)
            c.execute(text("delete from app_trash where id = :i"), {"i": tid})
            c.execute(text("insert into app_change (table_id, record_id, column_name, old, new, user_id) "
                           "values (:t, :r, 'id', null, to_jsonb(:r), :u)"), {"t": item.table_id, "r": item.record_id, "u": user["id"]})
            restored.append({"table_id": item.table_id, "record_id": item.record_id})
    if restored:
        computed.invalidate(full=True)
    log.info("из корзины: %s → %s", user["login"], restored)
    return {"restored": restored}


def _hand_over(c, target_pg: str, rec_id: int, link_table: str, col: str, row: dict) -> None:
    """Связь с записью, которая сама лежит в корзине: отдать её той записи — вернётся вместе с ней."""
    item = c.execute(text(
        "select tr.id, tr.data from app_trash tr join app_table t on t.id = tr.table_id "
        "where t.pg_name = :p and tr.record_id = :r order by tr.deleted_at desc limit 1"), {"p": target_pg, "r": rec_id}).first()
    if item is None:
        return   # вторая запись удалена навсегда — связи больше не с кем
    data = item.data
    entry = next((x for x in data.setdefault("links", []) if x["table"] == link_table and x["col"] == col), None)
    if entry is None:
        data["links"].append(entry := {"table": link_table, "col": col, "rows": []})
    entry["rows"].append(row)
    c.execute(text("update app_trash set data = :d where id = :i").bindparams(bindparam("d", type_=JSONB)),
              {"d": data, "i": item.id})


@router.get("/trash")
def list_trash(table_id: int | None = None, q: str = "", user: dict = Depends(active_user)):
    _admin(user)
    with engine.begin() as c:
        _purge_old(c)
        rows = c.execute(text(
            "select tr.id, tr.table_id, t.title as table_title, tr.record_id, tr.title, tr.deleted_at, "
            "coalesce(u.name, u.login) as deleted_by, tr.deleted_at + interval '%d days' as expires_at "
            "from app_trash tr join app_table t on t.id = tr.table_id left join app_user u on u.id = tr.deleted_by "
            "where (cast(:t as int) is null or tr.table_id = :t) and (:q = '' or tr.title ilike '%%' || :q || '%%') "
            "order by tr.deleted_at desc limit 500" % KEEP_DAYS), {"t": table_id, "q": q.strip()[:200]}).mappings().all()
    return [dict(r) for r in rows if can_read(user, r["table_title"])]


@router.get("/trash/{trash_id}")
def get_trash(trash_id: int, user: dict = Depends(active_user)):
    """Удалённая запись целиком для просмотра (только чтение): хранимые поля, связи названиями, вложения."""
    _admin(user)
    with engine.connect() as c:
        item = c.execute(text("select * from app_trash where id = :i"), {"i": trash_id}).first()
        if item is None:
            raise HTTPException(404, "Нет такой записи в корзине")
        t = _table(c, item.table_id)
        if not can_read(user, t.title):
            raise HTTPException(404, "Нет такой записи в корзине")
        hidden = hidden_columns(c, user, t.id)
        fields = [dict(r._mapping) for r in c.execute(text(
            "select column_name, title, kind, options, editable, airtable_id from app_field where table_id = :t "
            "order by sort_order, id"), {"t": t.id}) if r.column_name not in hidden]
        row = item.data["row"]
        values = {f["column_name"]: row[f["column_name"]] for f in fields if f["column_name"] in row}
        # связи — названиями из сохранённых пар
        meta = dict(c.execute(text("select field_id, link_table || ':' || side from at_link_meta")).all())
        names = links.Names(c, user)
        for f in fields:
            if f["kind"] != links.LINK or f["airtable_id"] not in meta:
                continue
            lt, side = meta[f["airtable_id"]].split(":")
            other = "dst" if side == "src" else "src"
            target = (f["options"] or {}).get("linkedTableId")
            if not names.readable(target):
                continue
            title, _ = names.of(target)
            ids = [r[other] for x in item.data.get("links", []) if x["table"] == lt and x["col"] == side for r in x["rows"]]
            values[f["column_name"]] = [{"id": i, "name": title.get(i, "")} for i in ids]
        if t.airtable_id and row.get("airtable_id"):
            att = attachments.values_for(c, t.airtable_id)
            for f in fields:
                if f["kind"] == attachments.ATTACH:
                    values[f["column_name"]] = att.get((row["airtable_id"], f["airtable_id"]), [])
        by = c.execute(text("select coalesce(name, login) from app_user where id = :u"), {"u": item.deleted_by}).scalar()
    return {"id": item.id, "table_id": t.id, "table": t.title, "record_id": item.record_id, "title": item.title,
            "deleted_at": item.deleted_at, "deleted_by": by, "primary_field": t.primary_field,
            "fields": [{k: f[k] for k in ("column_name", "title", "kind", "options")} for f in fields], "values": values}


@router.delete("/trash/{trash_id}")
def purge(trash_id: int, user: dict = Depends(active_user)):
    """Удалить навсегда — только суперадмин."""
    if user["role"] != "superadmin":
        raise HTTPException(403, "Удалить навсегда может только суперадмин")
    with engine.begin() as c:
        n = c.execute(text("delete from app_trash where id = :i"), {"i": trash_id}).rowcount
    if not n:
        raise HTTPException(404, "Нет такой записи в корзине")
    log.info("удалено навсегда: %s, корзина %s", user["login"], trash_id)
    return {"ok": True}

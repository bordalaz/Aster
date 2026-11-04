"""Связи (spec R11): значения ссылочных полей и lookup ссылок — названия связанных записей.
Ссылки хранятся в таблицах пар (at_link_*, см. migrate.schema), название — первичное поле
связанной таблицы (хранимое или вычисляемое). Таблица, скрытая от роли, — значение None."""
from fastapi import HTTPException
from sqlalchemy import text

from . import computed
from .access import can_read

LINK = "multipleRecordLinks"


class Names:
    """Названия записей по таблицам — считаются один раз на запрос."""

    def __init__(self, c, user):
        self.c, self.user = c, user
        self.tables = {r.airtable_id: r for r in c.execute(text(
            "select t.id, t.title, t.pg_name, t.primary_field, f.airtable_id as prim_at, t.airtable_id "
            "from app_table t left join app_field f on f.table_id = t.id and f.column_name = t.primary_field"))}
        self._cache = {}

    def readable(self, tbl_at: str):
        t = self.tables.get(tbl_at)
        return t if t is not None and can_read(self.user, t.title) else None

    def of(self, tbl_at: str) -> tuple[dict, dict]:
        """({наш id: название}, {airtable id записи: наш id}) таблицы."""
        if tbl_at not in self._cache:
            t = self.tables[tbl_at]
            stored = self.c.execute(text(
                "select 1 from information_schema.columns where table_name = :t and column_name = :c"),
                {"t": t.pg_name, "c": t.primary_field}).first()
            sel = f', "{t.primary_field}"::text' if stored else ", null"
            rows = self.c.execute(text(f"select id, airtable_id{sel} from {t.pg_name}")).all()
            comp = {} if stored else computed.values().get(t.prim_at, {})
            names = {i: _text(v if stored else comp.get(at)) for i, at, v in rows}
            self._cache[tbl_at] = (names, {at: i for i, at, _ in rows})
        return self._cache[tbl_at]


def _text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def link_values(c, fields, user) -> list[tuple[str, dict | None]]:
    """[(колонка, {наш id записи: [{id, name}]} или None — таблица скрыта)] для ссылочных полей."""
    names = Names(c, user)
    meta = dict(c.execute(text("select field_id, link_table || ':' || side from at_link_meta")).all())
    out = []
    for f in fields:
        if f.kind != LINK or f.airtable_id not in meta:
            continue
        target = (f.options or {}).get("linkedTableId")
        if not names.readable(target):
            out.append((f.column_name, None))
            continue
        lt, side = meta[f.airtable_id].split(":")
        mine, other, pos = ("src", "dst", "pos") if side == "src" else ("dst", "src", "rpos")
        title, _ = names.of(target)
        vals: dict = {}
        for m, o in c.execute(text(f"select {mine}, {other} from {lt} order by {mine}, {pos} nulls last, {other}")):
            vals.setdefault(m, []).append({"id": o, "name": title.get(o, "")})
        out.append((f.column_name, vals))
    return out


def lookup_mappers(c, fields, user, field_opts: dict) -> dict:
    """{колонка: функция(список rec-id) → [{id, name}] | None} для lookup ссылок.
    field_opts — {airtable id поля: options} всей базы (нужен linkedTableId просматриваемого поля)."""
    names = Names(c, user)
    out = {}
    for f in fields:
        o = f.options or {}
        if f.kind != "multipleLookupValues" or (o.get("result") or {}).get("type") != LINK:
            continue
        target = (field_opts.get(o.get("fieldIdInLinkedTable")) or {}).get("linkedTableId")
        if not names.readable(target):
            out[f.column_name] = lambda v: None
            continue
        title, by_at = names.of(target)
        out[f.column_name] = lambda v, title=title, by_at=by_at: (
            None if v is None else [{"id": by_at[r], "name": title.get(by_at[r], "")} for r in v if r in by_at])
    return out


def link_tables(c, rows, user) -> dict:
    """{колонка: наш id связанной таблицы или None (скрыта)} для ссылочных полей — переход из карточки."""
    names = Names(c, user)
    out = {}
    for r in rows:
        if r.kind == LINK:
            t = names.readable((r.options or {}).get("linkedTableId"))
            out[r.column_name] = t.id if t else None
    return out


def set_links(c, names: Names, rid: int, field, ids) -> tuple[list, list] | None:
    """Связи записи rid в поле field (строка app_field) — ровно ids в этом порядке, как правит Airtable.
    У связанных записей новая встаёт в конец их списка. (было, стало) — [{id, name}]; None — не изменилось."""
    o = field.options or {}
    target = names.readable(o.get("linkedTableId"))
    if target is None:
        raise HTTPException(403, "Нет доступа к связанной таблице")
    if not isinstance(ids, list) or not all(isinstance(i, int) and not isinstance(i, bool) for i in ids):
        raise HTTPException(422, "Неверная связь")
    ids = list(dict.fromkeys(ids))
    if o.get("prefersSingleRecordLink") and len(ids) > 1:
        raise HTTPException(422, "В этом поле — только одна запись")
    if set(ids) - set(c.execute(text(f"select id from {target.pg_name} where id = any(:i)"), {"i": ids}).scalars()):
        raise HTTPException(422, "Нет таких записей")
    lt, side = c.execute(text("select link_table, side from at_link_meta where field_id = :f"), {"f": field.airtable_id}).one()
    me, other, pos, opos = ("src", "dst", "pos", "rpos") if side == "src" else ("dst", "src", "rpos", "pos")
    old = list(c.execute(text(f"select {other} from {lt} where {me} = :r order by {pos} nulls last, {other}"), {"r": rid}).scalars())
    if old == ids:
        return None
    c.execute(text(f"delete from {lt} where {me} = :r and not ({other} = any(:i))"), {"r": rid, "i": ids})
    for i, x in enumerate(ids):
        if x in old:
            c.execute(text(f"update {lt} set {pos} = :i where {me} = :r and {other} = :o"), {"i": i, "r": rid, "o": x})
        else:
            c.execute(text(f"insert into {lt} ({me}, {other}, {pos}, {opos}) values (:r, :o, :i, "
                           f"(select coalesce(max({opos}), -1) + 1 from {lt} where {other} = :o))"), {"r": rid, "o": x, "i": i})
    title, _ = names.of(o["linkedTableId"])
    named = lambda xs: [{"id": x, "name": title.get(x, "")} for x in xs]   # noqa: E731
    return named(old), named(ids)

"""Связи (spec R11): значения ссылочных полей и lookup ссылок — названия связанных записей.
Ссылки хранятся в таблицах пар (at_link_*, см. migrate.schema), название — первичное поле
связанной таблицы (хранимое или вычисляемое). Таблица, скрытая от роли, — значение None."""
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


def pairs(c, table_id: int, title: str = None, target_at: str = None) -> list[tuple[int, int]]:
    """Пары (запись этой таблицы, связанная запись) ссылочного поля — по названию поля или по таблице-цели;
    порядок — как в Airtable. Нет такого поля — пусто."""
    q = ("select m.link_table, m.side from app_field f join at_link_meta m on m.field_id = f.airtable_id "
         "where f.table_id = :t and f.kind = :k and " + ("f.title = :x" if title else "f.options->>'linkedTableId' = :x")
         + " order by f.sort_order limit 1")
    link = c.execute(text(q), {"t": table_id, "k": LINK, "x": title or target_at}).first()
    if link is None:
        return []
    me, other, pos = ("src", "dst", "pos") if link.side == "src" else ("dst", "src", "rpos")
    return c.execute(text(f"select {me}, {other} from {link.link_table} order by {me}, {pos} nulls last, {other}")).all()

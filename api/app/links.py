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
        self._stored = None   # {pg_name} таблиц, где первичное поле — колонка (иначе вычисляемое)

    def stored(self, t) -> bool:
        if self._stored is None:   # одним запросом на все таблицы, а не по запросу на каждую
            self._stored = set(self.c.execute(text(
                "select c.table_name from information_schema.columns c join app_table t "
                "on t.pg_name = c.table_name and t.primary_field = c.column_name")).scalars())
        return t.pg_name in self._stored

    def readable(self, tbl_at: str):
        t = self.tables.get(tbl_at)
        return t if t is not None and can_read(self.user, t.title) else None

    def named(self, tbl_at: str, ids) -> dict:
        """{наш id: название} только этих записей — когда строк мало (изменившиеся, мини-карточки),
        не читать названия всей связанной таблицы."""
        if tbl_at in self._cache:
            title = self._cache[tbl_at][0]
            return {i: title.get(i, "") for i in ids}
        t = self.tables[tbl_at]
        ids = list(ids)
        if not ids:
            return {}
        stored = self.stored(t)
        sel = f', "{t.primary_field}"::text' if stored else ", null"
        rows = self.c.execute(text(f"select id, airtable_id{sel} from {t.pg_name} where id = any(:i)"), {"i": ids}).all()
        comp = {} if stored else computed.values().get(t.prim_at, {})
        return {i: _text(v if stored else comp.get(at)) for i, at, v in rows}

    def of(self, tbl_at: str) -> tuple[dict, dict]:
        """({наш id: название}, {airtable id записи: наш id}) таблицы."""
        if tbl_at not in self._cache:
            t = self.tables[tbl_at]
            stored = self.stored(t)
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


def link_values(c, fields, user, only=None) -> list[tuple[str, dict | None]]:
    """[(колонка, {наш id записи: [{id, name}]} или None — таблица скрыта)] для ссылочных полей.
    only — только эти записи (мини-карточки): не читать пары всей таблицы."""
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
        # список собирает база (array_agg): строка на запись, а не на пару — у оборудования их десятки тысяч
        where = f" where {mine} = any(:o)" if only is not None else ""
        lists = c.execute(text(
            f"select {mine}, array_agg({other} order by {pos} nulls last, {other}) from {lt}{where} group by {mine}"),
            {"o": list(only or ())}).all()
        # несколько строк — названия только связанных с ними записей; вся таблица — названия всех сразу
        title = names.named(target, {o for _, os in lists for o in os}) if only is not None else names.of(target)[0]
        vals = {m: [{"id": o, "name": title.get(o, "")} for o in os] for m, os in lists}
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
    # связанные записи — события (перемещения, рейсы, ремонты): новые встают по дате события, а не в конец;
    # уже стоящие — в порядке, который прислали (его можно менять вручную, перетаскиванием)
    far = event_date(c, target.pg_name, target.id)
    if far:
        ids = place_by_date([x for x in ids if x in old], [x for x in ids if x not in old], _dates(c, far, ids))
    if old == ids:
        return None
    c.execute(text(f"delete from {lt} where {me} = :r and not ({other} = any(:i))"), {"r": rid, "i": ids})
    own = c.execute(text("select t.id, t.pg_name from app_field f join app_table t on t.id = f.table_id where f.airtable_id = :f"),
                    {"f": field.airtable_id}).first()
    mine = event_date(c, own.pg_name, own.id) if own else None   # с той стороны эта запись — событие
    my_date = _dates(c, mine, [rid]).get(rid) if mine else None
    for i, x in enumerate(ids):
        if x in old:
            c.execute(text(f"update {lt} set {pos} = :i where {me} = :r and {other} = :o"), {"i": i, "r": rid, "o": x})
        elif mine:
            there = list(c.execute(text(f"select {me} from {lt} where {other} = :o order by {opos} nulls last, {me}"), {"o": x}).scalars())
            order = place_by_date(there, [rid], {**_dates(c, mine, there), rid: my_date})
            c.execute(text(f"insert into {lt} ({me}, {other}, {pos}, {opos}) values (:r, :o, :i, :p)"),
                      {"r": rid, "o": x, "i": i, "p": order.index(rid)})
            for k, y in enumerate(order):
                if y != rid:
                    c.execute(text(f"update {lt} set {opos} = :k where {me} = :y and {other} = :o"), {"k": k, "y": y, "o": x})
        else:
            c.execute(text(f"insert into {lt} ({me}, {other}, {pos}, {opos}) values (:r, :o, :i, "
                           f"(select coalesce(max({opos}), -1) + 1 from {lt} where {other} = :o))"), {"r": rid, "o": x, "i": i})
    title, _ = names.of(o["linkedTableId"])
    named = lambda xs: [{"id": x, "name": title.get(x, "")} for x in xs]   # noqa: E731
    return named(old), named(ids)


# ponytail: дата события — поле с таким названием (первое найденное по списку); иначе связи стоят как добавлены.
# Поля дат «Оборудования», «Договоров» сюда не входят: оборудование в перемещении по дате ввода не сортируем.
EVENT_DATES = ("Дата", "Начало", "Дефектоскопия от")


def event_date(c, pg_name: str, table_id: int) -> tuple[str, str] | None:
    """(pg-таблица, колонка даты события) или None."""
    col = c.execute(text(
        "select column_name from app_field where table_id = :t and kind in ('date', 'dateTime') and title = any(:n) "
        "and not coalesce((options->>'virtual')::boolean, false) order by array_position(:n, title) limit 1"),
        {"t": table_id, "n": list(EVENT_DATES)}).scalar()
    return (pg_name, col) if col else None


def _dates(c, where: tuple[str, str], ids) -> dict:
    pg, col = where
    return dict(c.execute(text(f'select id, "{col}" from {pg} where id = any(:i)'), {"i": list(ids)}).all())


def place_by_date(kept: list, new: list, dates: dict) -> list:
    """Новые — в список kept по дате события, как хранит Airtable: старые раньше, свежие в конце
    (формулы «последнего» — местонахождение — берут конец списка). Встаёт после последней записи не новее неё;
    без даты — в конец. Карточка показывает такие стопки свежими сверху."""
    out = list(kept)
    for n in new:
        d = dates.get(n)
        at = len(out)
        if d is not None:
            later = [i for i, y in enumerate(out) if dates.get(y) is not None and dates[y] > d]
            at = later[0] if later else len(out)
        out.insert(at, n)
    return out

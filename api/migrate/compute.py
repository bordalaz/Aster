"""Вычисление rollup-полей по загруженному снимку и сверка с at_computed.
Конфиг (связь, источник, фильтр) берём из app_field.options; функцию агрегации — из rollup_aggs.AGG."""
import json
from collections import OrderedDict
from decimal import Decimal

from sqlalchemy import text

from .names import column_name, table_name


def _as_dict(v) -> dict:
    return v if isinstance(v, dict) else json.loads(v)


def _field_config(conn, key: str) -> dict:
    """По ключу 'Таблица.Поле' вернуть {owner_tbl, owner_at, field_at, link_fld, src_fld, options}."""
    table_title, field_title = key.split(".", 1)
    row = conn.execute(text(
        "select t.airtable_id as t_at, t.pg_name, f.airtable_id as f_at, f.options "
        "from app_field f join app_table t on t.id = f.table_id "
        "where t.title = :t and f.title = :f"
    ), {"t": table_title, "f": field_title}).first()
    if not row:
        raise KeyError(f"нет поля {key!r} в метаданных")
    opts = _as_dict(row.options)
    return {"owner_tbl": row.pg_name, "owner_at": row.t_at, "field_at": row.f_at,
            "link_fld": opts.get("recordLinkFieldId"), "src_fld": opts.get("fieldIdInLinkedTable"),
            "options": opts}


def _linked_values(conn, cfg: dict) -> "OrderedDict[str, list]":
    """{airtable_id owner-записи: [значения источника у связанных записей в порядке pos]}."""
    link = conn.execute(text(
        "select link_table, side from at_link_meta where field_id = :f"
    ), {"f": cfg["link_fld"]}).first()
    if not link:
        raise KeyError(f"нет таблицы пар для связи {cfg['link_fld']!r}")
    # сторона владельца: src → его ключ src, порядок pos; dst → ключ dst, порядок rpos
    me, other, order = ("src", "dst", "pos") if link.side == "src" else ("dst", "src", "rpos")

    link_opts = _as_dict(conn.execute(text("select options from app_field where airtable_id = :f"),
                                      {"f": cfg["link_fld"]}).scalar())
    linked_tbl = table_name(link_opts["linkedTableId"])
    owner_tbl = cfg["owner_tbl"]
    src_col = column_name(cfg["src_fld"])

    # источник может быть виртуальным (lookup/rollup) — тогда значения из at_computed (см. Task 5).
    src_is_virtual = conn.execute(text(
        "select coalesce((options->>'virtual')::boolean, false) from app_field "
        "where table_id = (select id from app_table where airtable_id = :lt) and airtable_id = :s"
    ), {"lt": link_opts["linkedTableId"], "s": cfg["src_fld"]}).scalar()

    # алиасы без совпадений по регистру (Postgres приводит к нижнему): p — пара, lk — связанная запись
    pairs_sql = (
        f"select o.airtable_id as owner_at, p.{order} as pos, lk.airtable_id as linked_at"
        + ("" if src_is_virtual else f", lk.{src_col} as val")
        + f" from {link.link_table} p "
        f"join {owner_tbl} o on o.id = p.{me} "
        f"join {linked_tbl} lk on lk.id = p.{other} "
        f"order by o.airtable_id, p.{order}"
    )
    rows = conn.execute(text(pairs_sql)).all()

    out: "OrderedDict[str, list]" = OrderedDict()
    if src_is_virtual:
        comp = {r.record_airtable_id: r.value for r in conn.execute(text(
            "select record_airtable_id, value from at_computed where table_id = :lt and field_id = :s"
        ), {"lt": link_opts["linkedTableId"], "s": cfg["src_fld"]})}
        for r in rows:
            out.setdefault(r.owner_at, []).append(comp.get(r.linked_at))
    else:
        for r in rows:
            out.setdefault(r.owner_at, []).append(r.val)
    # owner-записи без связей тоже должны присутствовать (агрегат пустого списка)
    for (owner_at,) in conn.execute(text(f"select airtable_id from {owner_tbl}")):
        out.setdefault(owner_at, [])
    return out


def _aggregate(values: list, func: str):
    # None = пустое значение Airtable; многозначные источники расплющиваем здесь
    flat = []
    for v in values:
        flat.extend(v) if isinstance(v, list) else flat.append(v)
    nonnull = [v for v in flat if v is not None]
    nums = [v for v in nonnull if isinstance(v, (int, float, Decimal)) and not isinstance(v, bool)]
    if func == "SUM":
        return sum(nums) if nums else 0
    if func == "COUNTA":
        return len(nonnull)
    if func == "COUNT":
        return len(nums)
    if func == "COUNTA_UNIQUE":
        return len(list(dict.fromkeys(nonnull)))
    if func == "MIN":
        return min(nonnull) if nonnull else None
    if func == "MAX":
        return max(nonnull) if nonnull else None
    if func == "ARRAYJOIN":
        return ", ".join(str(v) for v in nonnull)
    if func == "ARRAYUNIQUE":
        return list(dict.fromkeys(nonnull))
    raise ValueError(f"неизвестная функция агрегации: {func}")


def compute_field(conn, key: str, func: str) -> dict:
    """{airtable_id: вычисленное значение} для rollup-поля key с функцией func."""
    cfg = _field_config(conn, key)
    per_owner = _linked_values(conn, cfg)
    return {owner_at: _aggregate(vals, func) for owner_at, vals in per_owner.items()}

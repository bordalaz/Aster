"""Вычисление rollup-полей по загруженному снимку и сверка с at_computed.
Конфиг (связь, источник, фильтр) берём из app_field.options; функцию агрегации — из rollup_aggs.AGG."""
import json
from collections import OrderedDict
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import text

from .names import table_name


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


class LinkCell(list):
    """Значение поля-связи: первичные имена связанных записей. В ARRAYJOIN Airtable пишет ячейку как «a, b»."""


def _field_meta(conn, field_at: str):
    return conn.execute(text(
        "select f.kind, f.column_name, f.options, t.pg_name, t.airtable_id as t_at "
        "from app_field f join app_table t on t.id = f.table_id where f.airtable_id = :f"
    ), {"f": field_at}).first()


def _pairs(conn, link_fld: str) -> tuple[list, str]:
    """[(owner_at, linked_at)] связи link_fld в порядке ячейки Airtable + airtable_id связанной таблицы."""
    link = conn.execute(text(
        "select link_table, side from at_link_meta where field_id = :f"
    ), {"f": link_fld}).first()
    if not link:
        raise KeyError(f"нет таблицы пар для связи {link_fld!r}")
    # сторона владельца: src → его ключ src, порядок pos; dst → ключ dst, порядок rpos
    me, other, order = ("src", "dst", "pos") if link.side == "src" else ("dst", "src", "rpos")
    m = _field_meta(conn, link_fld)
    linked_at = _as_dict(m.options)["linkedTableId"]
    rows = conn.execute(text(
        f"select o.airtable_id as owner_at, lk.airtable_id as linked_at from {link.link_table} p "
        f"join {m.pg_name} o on o.id = p.{me} join {table_name(linked_at)} lk on lk.id = p.{other} "
        f"order by o.airtable_id, p.{order}"
    )).all()
    return [(r.owner_at, r.linked_at) for r in rows], linked_at


def _field_values(conn, field_at: str, cache: dict) -> dict:
    """{airtable_id записи: значение поля} — откуда бы оно ни бралось:
    колонка, at_computed (formula/rollup/lookup) или связь (первичные имена связанных записей)."""
    if field_at in cache:
        return cache[field_at]
    m = _field_meta(conn, field_at)
    if m is None:
        raise KeyError(f"нет поля {field_at!r} в метаданных")
    opts = _as_dict(m.options)
    if m.kind == "multipleRecordLinks":
        cache[field_at] = {}   # ponytail: защита от цикла первичных полей; в базе их нет
        pairs, linked_at = _pairs(conn, field_at)
        prim = conn.execute(text(
            "select f.airtable_id from app_field f join app_table t on t.id = f.table_id "
            "where t.airtable_id = :t and f.column_name = t.primary_field"), {"t": linked_at}).scalar()
        names = _field_values(conn, prim, cache)
        out: dict = {}
        for owner, linked in pairs:
            out.setdefault(owner, LinkCell()).append(names.get(linked))
    elif opts.get("virtual"):
        out = {r.record_airtable_id: r.value for r in conn.execute(text(
            "select record_airtable_id, value from at_computed where table_id = :t and field_id = :f"
        ), {"t": m.t_at, "f": field_at})}
    else:
        out = dict(conn.execute(text(f"select airtable_id, {m.column_name} from {m.pg_name}")).all())
    cache[field_at] = out
    return out


def _plain(v):
    """Значение ячейки → вид API: дата → 'YYYY-MM-DD' (dateTime — по UTC), Decimal → float."""
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc).date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    return v


def _target(conn, fid: str, target):
    """Операнд фильтра Airtable → значение того же вида, что у ячейки."""
    if isinstance(target, dict) and target.get("mode") == "exactDate":
        # ponytail: дата из UTC-строки; верно, пока полночь UTC — тот же день в timeZone (Томск +7)
        return target["exactDate"][:10]
    if isinstance(target, str) and target.startswith("sel"):
        choices = _as_dict(_field_meta(conn, fid).options).get("choices", [])
        return next((c["name"] for c in choices if c["id"] == target), target)
    return target


_OPS = {"=": lambda a, b: a == b, "!=": lambda a, b: a != b, ">": lambda a, b: a > b,
        ">=": lambda a, b: a >= b, "<": lambda a, b: a < b, "<=": lambda a, b: a <= b}


def _passes(filt: dict, get) -> bool:
    """filt — options.filters Airtable: {"operator": "and"|"or", "operands": [...]} или
    условие {"operator": op, "operands": [fieldId, значение]}. get(fieldId, значение) → (ячейка, цель)."""
    op = filt["operator"]
    if op in ("and", "or"):
        res = [_passes(c, get) for c in filt["operands"]]
        return all(res) if op == "and" else any(res)
    val, target = get(*filt["operands"])
    vals = [_plain(v) for v in (val if isinstance(val, list) else [val]) if v is not None]
    if op in ("contains", "doesNotContain"):
        hit = target.casefold() in ", ".join(map(str, vals)).casefold()   # Airtable — без учёта регистра
        return hit if op == "contains" else not hit
    if op in _OPS:
        # многозначная ячейка (lookup) проходит, если проходит хоть одно значение
        return any(not isinstance(v, dict) and _OPS[op](v, target) for v in vals)
    raise ValueError(f"оператор фильтра {op!r} не поддержан")


def _condition_fields(filt: dict) -> list:
    """Все fieldId условий фильтра (включая вложенные группы), без повторов."""
    if not filt:
        return []
    if filt["operator"] in ("and", "or"):
        return list(dict.fromkeys(f for c in filt["operands"] for f in _condition_fields(c)))
    return [filt["operands"][0]]


def _linked_values(conn, cfg: dict) -> "OrderedDict[str, list]":
    """{airtable_id owner-записи: [значения источника у связанных записей в порядке ячейки]}."""
    cache: dict = {}
    pairs, _ = _pairs(conn, cfg["link_fld"])
    src = _field_values(conn, cfg["src_fld"], cache)
    filters = cfg["options"].get("filters")
    if filters:
        conds = {f: _field_values(conn, f, cache) for f in _condition_fields(filters)}
        pairs = [(o, lk) for o, lk in pairs
                 if _passes(filters, lambda fid, t, lk=lk: (conds[fid].get(lk), _target(conn, fid, t)))]
    out: "OrderedDict[str, list]" = OrderedDict()
    for owner, linked in pairs:
        out.setdefault(owner, []).append(src.get(linked))
    # owner-записи без связей тоже должны присутствовать (агрегат пустого списка)
    for (owner_at,) in conn.execute(text(f"select airtable_id from {cfg['owner_tbl']}")):
        out.setdefault(owner_at, [])
    return out


def _aggregate(values: list, func: str):
    # None = пустое значение Airtable. Элемент rollup — ячейка связанной записи:
    # ARRAYJOIN пустые ячейки оставляет («a,,b»), ячейка-связь — одна строка «x, y» и один элемент в COUNTA;
    # прочие многозначные (lookup) расплющиваем.
    if func == "ARRAYJOIN":
        return ",".join(", ".join(str(x) for x in v if x is not None) if isinstance(v, LinkCell)
                        else ",".join(str(_plain(x)) for x in v if x is not None) if isinstance(v, list)
                        else "" if v is None else str(_plain(v))
                        for v in values)
    flat = []
    for v in values:
        if isinstance(v, LinkCell) and func in ("COUNTA", "COUNT"):
            flat.append(v or None)
        elif isinstance(v, list):
            flat.extend(v)
        else:
            flat.append(v)
    nonnull = [v for v in flat if v is not None]
    errors = [v for v in nonnull if isinstance(v, dict)]   # {"specialValue": "NaN"} из formula-источника
    if errors and func in ("SUM", "MIN", "MAX"):
        return errors[0]   # Airtable: ошибка в источнике → ошибка в агрегате
    nums = [v for v in nonnull if isinstance(v, (int, float, Decimal)) and not isinstance(v, bool)]
    if func == "SUM":
        return sum(nums) if nums else 0
    if func == "COUNTA":
        return len(nonnull)
    if func == "COUNT":
        return len(nums)
    if func == "COUNTA_UNIQUE":
        return len(dict.fromkeys(_hashable(v) for v in nonnull))
    if func == "MIN":
        return min(map(_plain, nonnull)) if nonnull else None
    if func == "MAX":
        return max(map(_plain, nonnull)) if nonnull else None
    if func == "ARRAYUNIQUE":
        return list(dict.fromkeys(nonnull))
    raise ValueError(f"неизвестная функция агрегации: {func}")


def _hashable(v):
    return json.dumps(v, sort_keys=True, default=str) if isinstance(v, (dict, list)) else v


def _out(v):
    """Результат → вид, в каком его отдаёт API Airtable (так он лежит в at_computed)."""
    if isinstance(v, list):
        return [_out(x) for x in v]
    return _plain(v)


def compute_field(conn, key: str, func: str) -> dict:
    """{airtable_id: вычисленное значение} для rollup-поля key с функцией func."""
    cfg = _field_config(conn, key)
    per_owner = _linked_values(conn, cfg)
    return {owner_at: _out(_aggregate(vals, func)) for owner_at, vals in per_owner.items()}

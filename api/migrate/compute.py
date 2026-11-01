"""Вычисление rollup-полей по загруженному снимку и сверка с at_computed.
Конфиг (связь, источник, фильтр) берём из app_field.options; функцию агрегации — из rollup_aggs.AGG."""
import json
from collections import OrderedDict
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import text

from .formula import LinkCell, evaluate, parse, to_api
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


class Values(dict):
    """Кеш {поле: {запись: значение}} одного расчёта. computed — уже посчитанные нами вычисляемые поля:
    тогда они берутся отсюда, а не из at_computed (значений Airtable)."""
    def __init__(self, computed: dict | None = None):
        super().__init__()
        self.computed = computed


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
        names = _primary_names(conn, linked_at, cache)
        out: dict = {}
        for owner, linked in pairs:
            out.setdefault(owner, LinkCell()).append(names.get(linked))
    elif m.kind == "multipleAttachments":
        out = {}
        for rec, att in conn.execute(text(
                "select record_airtable_id, airtable_att_id from attachment "
                "where table_id = :t and field_id = :f order by record_airtable_id, pos"),
                {"t": m.t_at, "f": field_at}):
            out.setdefault(rec, []).append(att)
    elif opts.get("virtual"):
        computed = getattr(cache, "computed", None)
        if computed is not None:
            out = dict(computed[field_at])   # KeyError — нарушен порядок зависимостей compute_all
        else:
            out = {r.record_airtable_id: r.value for r in conn.execute(text(
                "select record_airtable_id, value from at_computed where table_id = :t and field_id = :f"
            ), {"t": m.t_at, "f": field_at})}
        if (opts.get("result") or {}).get("type") == "multipleRecordLinks":
            # lookup поля-связи: API отдаёт id записей, Airtable показывает их первичные имена
            names = _primary_names(conn, _as_dict(_field_meta(conn, opts["fieldIdInLinkedTable"]).options)
                                   ["linkedTableId"], cache)
            out = {k: LinkCell(names.get(i, i) for i in v) if isinstance(v, list) else v for k, v in out.items()}
    else:
        out = dict(conn.execute(text(f"select airtable_id, {m.column_name} from {m.pg_name}")).all())
    cache[field_at] = out
    return out


def _primary_names(conn, table_at: str, cache: dict) -> dict:
    """{airtable_id записи: значение первичного поля} таблицы table_at."""
    return _field_values(conn, _primary_of(conn, table_at), cache)


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
    if isinstance(target, list):
        return [_target(conn, fid, t) for t in target]
    if isinstance(target, str) and target.startswith("sel"):
        choices = _as_dict(_field_meta(conn, fid).options).get("choices", [])
        return next((c["name"] for c in choices if target == c["id"] or target in c.get("mergedIds", ())),
                    target)
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
    if op in ("isAnyOf", "isNoneOf"):
        hit = any(v in target for v in vals)
        return hit if op == "isAnyOf" else not hit
    if op in _OPS:
        if not vals:   # пустая ячейка: Airtable считает «≠ X» истиной, остальные сравнения — ложью
            return op == "!="
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


def _linked_values(conn, cfg: dict, src: dict | None = None, cache: dict | None = None) -> "OrderedDict[str, list]":
    """{airtable_id owner-записи: [значения источника у связанных записей в порядке ячейки]}.
    src — готовые значения источника {запись: значение} (по умолчанию — поле src_fld)."""
    cache = Values() if cache is None else cache
    pairs, _ = _pairs(conn, cfg["link_fld"])
    if src is None:
        src = _field_values(conn, cfg["src_fld"], cache)
    filters = cfg["options"].get("filters")
    if filters:
        conds = {f: _field_values(conn, f, cache) for f in _condition_fields(filters)}
        targets: dict = {}   # цель условия не зависит от записи — считаем один раз, не на каждую пару

        def target(fid, t):
            k = (fid, json.dumps(t, sort_keys=True))
            if k not in targets:
                targets[k] = _target(conn, fid, t)
            return targets[k]
        pairs = [(o, lk) for o, lk in pairs
                 if _passes(filters, lambda fid, t, lk=lk: (conds[fid].get(lk), target(fid, t)))]
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
        return _join(values, ",")
    if func == "LAST":
        # формула-rollup Airtable (сноска ¹): ARRAYJOIN(values,";"), минус одна хвостовая «;», хвост после последней «;»
        s = _join(values, ";")
        s = s[:-1] if s.endswith(";") else s
        return s.rsplit(";", 1)[-1]
    if func == "FIRST":
        return _join(values, ",").split(",", 1)[0]   # сноска ²: текст до первой запятой
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


def _join(values: list, sep: str) -> str:
    return sep.join(", ".join(str(x) for x in v if x is not None) if isinstance(v, LinkCell)
                    else sep.join(str(_plain(x)) for x in v if x is not None) if isinstance(v, list)
                    else "" if v is None else str(_plain(v))
                    for v in values)


def _hashable(v):
    return json.dumps(v, sort_keys=True, default=str) if isinstance(v, (dict, list)) else v


def _out(v):
    """Результат → вид, в каком его отдаёт API Airtable (так он лежит в at_computed)."""
    if isinstance(v, list):
        return [_out(x) for x in v]
    return _plain(v)


def compute_field(conn, key: str, func: str, cache: dict | None = None) -> dict:
    """{airtable_id: вычисленное значение} для rollup-поля key с функцией func."""
    cfg = _field_config(conn, key)
    per_owner = _linked_values(conn, cfg, cache=cache)
    return {owner_at: _out(_aggregate(vals, func)) for owner_at, vals in per_owner.items()}


def _refs(node) -> set:
    if node[0] == "ref":
        return {node[1]}
    kids = node[2] if node[0] == "call" else node[2:] if node[0] == "op" else node[1:] if node[0] == "neg" else ()
    return set().union(*(_refs(k) for k in kids)) if kids else set()


def compute_formula(conn, key: str, today, cache: dict | None = None) -> dict:
    """{airtable_id: значение} formula-поля key. Входы — как есть в базе (колонка, at_computed, связь):
    сверка каждой формулы изолирована, ошибка одной не тянется в зависящие от неё."""
    cfg = _field_config(conn, key)
    tree = parse(cfg["options"]["formula"])
    cache = Values() if cache is None else cache
    vals = {r: _field_values(conn, r, cache) for r in _refs(tree)}
    rtype = (cfg["options"].get("result") or {}).get("type")
    return {rec: to_api(evaluate(tree, lambda f, rec=rec: vals[f].get(rec), today), rtype)
            for (rec,) in conn.execute(text(f"select airtable_id from {cfg['owner_tbl']}"))}


def _api(v):
    """Элемент lookup → вид API: dateTime — ISO с миллисекундами и Z, дата — YYYY-MM-DD, Decimal — float."""
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return _plain(v)


def compute_lookup(conn, key: str, cache: dict | None = None) -> dict:
    """{airtable_id: [значения]} lookup-поля: значения источника у связанных записей, расплющенные.
    Источник-связь API отдаёт id записей — их и возвращаем."""
    cfg = _field_config(conn, key)
    src = None
    if _field_meta(conn, cfg["src_fld"]).kind == "multipleRecordLinks":
        src = {}
        for owner, linked in _pairs(conn, cfg["src_fld"])[0]:
            src.setdefault(owner, []).append(linked)
    out = {}
    for owner, vals in _linked_values(conn, cfg, src, cache).items():
        flat = [x for v in vals for x in (v if isinstance(v, list) else [v])]
        out[owner] = [_api(x) for x in flat if x is not None]
    return out


def compute_count(conn, key: str, cache: dict | None = None) -> dict:
    """{airtable_id: число связанных записей} count-поля (с фильтром, если задан)."""
    cfg = _field_config(conn, key)
    return {owner: len(vals) for owner, vals in _linked_values(conn, cfg, src={}, cache=cache).items()}


COMPUTED_KINDS = ("formula", "rollup", "multipleLookupValues", "count")


def _primary_of(conn, table_at: str) -> str:
    return conn.execute(text(
        "select f.airtable_id from app_field f join app_table t on t.id = f.table_id "
        "where t.airtable_id = :t and f.column_name = t.primary_field"), {"t": table_at}).scalar()


def _deps(conn, opts: dict, kind: str) -> set:
    """Поля, от которых зависит вычисляемое поле, включая первичные поля таблиц за связями
    (имена связанных записей — это их первичные поля, часто formula)."""
    if kind == "formula":
        refs = _refs(parse(opts["formula"]))
    else:
        refs = {opts.get("recordLinkFieldId"), opts.get("fieldIdInLinkedTable")} - {None}
        refs |= set(_condition_fields(opts.get("filters")))
    out = set(refs)
    for f in refs:
        m = _field_meta(conn, f)
        if m is None:
            continue
        o = _as_dict(m.options)
        if m.kind == "multipleRecordLinks":
            out.add(_primary_of(conn, o["linkedTableId"]))
        elif (o.get("result") or {}).get("type") == "multipleRecordLinks":
            out.add(_primary_of(conn, _as_dict(_field_meta(conn, o["fieldIdInLinkedTable"]).options)["linkedTableId"]))
    return out


def compute_all(conn, today, aggs: dict | None = None) -> dict:
    """Все вычисляемые поля базы от сырых данных, по цепочке зависимостей (at_computed не читается).
    → {field_id: {airtable_id записи: значение в виде API}}. Битые и неописанные в aggs rollup — пустые."""
    from graphlib import TopologicalSorter

    from .rollup_aggs import AGG
    aggs = AGG if aggs is None else aggs
    rows = conn.execute(text(
        "select f.airtable_id, f.kind, f.options, t.title || '.' || f.title as key "
        "from app_field f join app_table t on t.id = f.table_id where f.kind = any(:k)"),
        {"k": list(COMPUTED_KINDS)}).all()
    info = {r.airtable_id: r for r in rows}
    graph = {fid: {d for d in _deps(conn, _as_dict(r.options), r.kind) if d in info} for fid, r in info.items()}
    cache = Values(computed={})
    for fid in TopologicalSorter(graph).static_order():
        r = info[fid]
        if _as_dict(r.options).get("isValid") is False:
            out = {}
        elif r.kind == "formula":
            out = compute_formula(conn, r.key, today, cache)
        elif r.kind == "multipleLookupValues":
            out = compute_lookup(conn, r.key, cache)
        elif r.kind == "count":
            out = compute_count(conn, r.key, cache)
        else:
            func = aggs.get(r.key)
            out = {} if func in (None, "INVALID") else compute_field(conn, r.key, func, cache)
        cache.computed[fid] = out
    return cache.computed

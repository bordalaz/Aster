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
    memo = conn.info.get("aster_meta")   # compute_all грузит метаданные один раз на расчёт
    if memo is not None:
        return memo.get(field_at)
    return conn.execute(text(
        "select f.kind, f.column_name, f.options, t.pg_name, t.airtable_id as t_at "
        "from app_field f join app_table t on t.id = f.table_id where f.airtable_id = :f"
    ), {"f": field_at}).first()


def _pairs(conn, link_fld: str, owners=None, linked=None) -> tuple[list, str]:
    """[(owner_at, linked_at)] связи link_fld в порядке ячейки Airtable + airtable_id связанной таблицы.
    owners / linked — только пары этих записей (airtable_id) с той или другой стороны."""
    link = conn.execute(text(
        "select link_table, side from at_link_meta where field_id = :f"
    ), {"f": link_fld}).first()
    if not link:
        raise KeyError(f"нет таблицы пар для связи {link_fld!r}")
    # сторона владельца: src → его ключ src, порядок pos; dst → ключ dst, порядок rpos
    me, other, order = ("src", "dst", "pos") if link.side == "src" else ("dst", "src", "rpos")
    m = _field_meta(conn, link_fld)
    linked_at = _as_dict(m.options)["linkedTableId"]
    where = " and ".join(w for w, v in (("o.airtable_id = any(:o)", owners), ("lk.airtable_id = any(:l)", linked)) if v is not None)
    rows = conn.execute(text(
        f"select o.airtable_id as owner_at, lk.airtable_id as linked_at from {link.link_table} p "
        f"join {m.pg_name} o on o.id = p.{me} join {table_name(linked_at)} lk on lk.id = p.{other} "
        + (f"where {where} " if where else "") + f"order by o.airtable_id, p.{order}"
    ), {"o": list(owners or ()), "l": list(linked or ())}).all()
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


def _owners(conn, tbl: str, only) -> list:
    """airtable_id записей таблицы; only — только эти (и только существующие)."""
    if only is None:
        return list(conn.execute(text(f"select airtable_id from {tbl}")).scalars())
    return list(conn.execute(text(f"select airtable_id from {tbl} where airtable_id = any(:o)"), {"o": list(only)}).scalars())


def _linked_values(conn, cfg: dict, src: dict | None = None, cache: dict | None = None, only=None) -> "OrderedDict[str, list]":
    """{airtable_id owner-записи: [значения источника у связанных записей в порядке ячейки]}.
    src — готовые значения источника {запись: значение} (по умолчанию — поле src_fld); only — только эти записи."""
    cache = Values() if cache is None else cache
    pairs, _ = _pairs(conn, cfg["link_fld"], owners=only)
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
    for owner_at in _owners(conn, cfg["owner_tbl"], only):
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


def compute_field(conn, key: str, func: str, cache: dict | None = None, only=None) -> dict:
    """{airtable_id: вычисленное значение} для rollup-поля key с функцией func."""
    cfg = _field_config(conn, key)
    per_owner = _linked_values(conn, cfg, cache=cache, only=only)
    return {owner_at: _out(_aggregate(vals, func)) for owner_at, vals in per_owner.items()}


def _refs(node) -> set:
    if node[0] == "ref":
        return {node[1]}
    kids = node[2] if node[0] == "call" else node[2:] if node[0] == "op" else node[1:] if node[0] == "neg" else ()
    return set().union(*(_refs(k) for k in kids)) if kids else set()


def compute_formula(conn, key: str, today, cache: dict | None = None, only=None) -> dict:
    """{airtable_id: значение} formula-поля key. Входы — как есть в базе (колонка, at_computed, связь):
    сверка каждой формулы изолирована, ошибка одной не тянется в зависящие от неё."""
    cfg = _field_config(conn, key)
    tree = parse(cfg["options"]["formula"])
    cache = Values() if cache is None else cache
    vals = {r: _field_values(conn, r, cache) for r in _refs(tree)}
    rtype = (cfg["options"].get("result") or {}).get("type")
    return {rec: to_api(evaluate(tree, lambda f, rec=rec: vals[f].get(rec), today), rtype)
            for rec in _owners(conn, cfg["owner_tbl"], only)}


def _api(v):
    """Элемент lookup → вид API: dateTime — ISO с миллисекундами и Z, дата — YYYY-MM-DD, Decimal — float."""
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return _plain(v)


def compute_lookup(conn, key: str, cache: dict | None = None, only=None) -> dict:
    """{airtable_id: [значения]} lookup-поля: значения источника у связанных записей, расплющенные.
    Источник-связь API отдаёт id записей — их и возвращаем."""
    cfg = _field_config(conn, key)
    src = None
    if _field_meta(conn, cfg["src_fld"]).kind == "multipleRecordLinks":
        src = {}
        for owner, linked in _pairs(conn, cfg["src_fld"])[0]:
            src.setdefault(owner, []).append(linked)
    out = {}
    for owner, vals in _linked_values(conn, cfg, src, cache, only).items():
        flat = [x for v in vals for x in (v if isinstance(v, list) else [v])]
        out[owner] = [_api(x) for x in flat if x is not None]
    return out


def compute_count(conn, key: str, cache: dict | None = None, only=None) -> dict:
    """{airtable_id: число связанных записей} count-поля (с фильтром, если задан)."""
    cfg = _field_config(conn, key)
    return {owner: len(vals) for owner, vals in _linked_values(conn, cfg, src={}, cache=cache, only=only).items()}


COMPUTED_KINDS = ("formula", "rollup", "multipleLookupValues", "count")


def _primary_of(conn, table_at: str) -> str:
    memo = conn.info.get("aster_primary")
    if memo is not None:
        return memo.get(table_at)
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


def compute_all(conn, today, aggs: dict | None = None, prev: dict | None = None, changed: set | None = None,
                touched: dict | None = None, new: dict | None = None, prev_today=None, report: dict | None = None) -> dict:
    """Все вычисляемые поля базы от сырых данных, по цепочке зависимостей (at_computed не читается).
    → {field_id: {airtable_id записи: значение в виде API}}. Битые и неописанные в aggs rollup — пустые.
    prev + changed (airtable_id изменённых сырых полей) — пересчёт только зависящих от них полей
    (прямо или по цепочке); остальные берутся из prev. Формулы с TODAY()/NOW() считаются всегда.
    Вычисляемое поле в changed считается заново (новая запись в его таблице).
    prev + touched {поле: {записи}} (+ new {таблица: {новые записи}}) — пересчёт только задетых записей:
    дальше по цепочке идут лишь записи, чьё значение изменилось. Формулы с TODAY()/NOW() — целиком,
    только если сменился день (prev_today). report — сюда {таблица: {записи}}, чьи значения могли измениться
    (задетые правкой и пересчитанные): сетка перечитывает только их."""
    meta = {r.airtable_id: r for r in conn.execute(text(
        "select f.airtable_id, f.kind, f.column_name, f.options, t.pg_name, t.airtable_id as t_at "
        "from app_field f join app_table t on t.id = f.table_id where f.airtable_id is not null"))}
    primary = dict(conn.execute(text(
        "select t.airtable_id, f.airtable_id from app_table t join app_field f "
        "on f.table_id = t.id and f.column_name = t.primary_field where t.airtable_id is not null")).all())
    conn.info["aster_meta"], conn.info["aster_primary"] = meta, primary
    try:
        if prev is not None and touched is not None:
            return _compute_records(conn, today, aggs, prev, touched, new or {}, prev_today, report)
        return _compute_fields(conn, today, aggs, prev, changed)
    finally:
        conn.info.pop("aster_meta", None)
        conn.info.pop("aster_primary", None)


def _graph(conn):
    rows = conn.execute(text(
        "select f.airtable_id, f.kind, f.options, t.title || '.' || f.title as key "
        "from app_field f join app_table t on t.id = f.table_id where f.kind = any(:k)"),
        {"k": list(COMPUTED_KINDS)}).all()
    info = {r.airtable_id: r for r in rows}
    deps = {fid: _deps(conn, _as_dict(r.options), r.kind) for fid, r in info.items()}
    return info, deps


def _compute_one(conn, r, today, aggs, cache, only=None) -> dict:
    if _as_dict(r.options).get("isValid") is False:
        return {}
    if r.kind == "formula":
        return compute_formula(conn, r.key, today, cache, only)
    if r.kind == "multipleLookupValues":
        return compute_lookup(conn, r.key, cache, only)
    if r.kind == "count":
        return compute_count(conn, r.key, cache, only)
    func = aggs.get(r.key)
    return {} if func in (None, "INVALID") else compute_field(conn, r.key, func, cache, only)


def _is_clock(r) -> bool:
    return r.kind == "formula" and any(w in _as_dict(r.options).get("formula", "").upper() for w in ("TODAY(", "NOW("))


def _compute_fields(conn, today, aggs, prev, changed) -> dict:
    from graphlib import TopologicalSorter

    from .rollup_aggs import AGG
    aggs = AGG if aggs is None else aggs
    info, deps = _graph(conn)
    graph = {fid: {d for d in ds if d in info} for fid, ds in deps.items()}
    cache = Values(computed={})
    dirty = None if prev is None or changed is None else set(changed)
    for fid in TopologicalSorter(graph).static_order():
        r = info[fid]
        if dirty is not None:
            if fid in prev and not _is_clock(r) and fid not in changed and not deps[fid] & dirty:
                cache.computed[fid] = prev[fid]
                continue
            dirty.add(fid)
        cache.computed[fid] = _compute_one(conn, r, today, aggs, cache)
    return cache.computed


def _compute_records(conn, today, aggs, prev, touched, new, prev_today, report=None) -> dict:
    """Пересчёт по записям: у каждого вычисляемого поля — только записи, задетые правкой
    (своей или по цепочке, через связи — у связанных записей)."""
    from graphlib import TopologicalSorter

    from .rollup_aggs import AGG
    aggs = AGG if aggs is None else aggs
    info, deps = _graph(conn)
    graph = {fid: {d for d in ds if d in info} for fid, ds in deps.items()}
    cache = Values(computed={})
    dirty: dict = {}   # поле → записи, чьё значение изменилось

    def recs(f) -> set:
        if f in dirty:
            return dirty[f]
        m = _field_meta(conn, f)
        dirty[f] = set()   # защита от цикла
        if m is None:
            return dirty[f]
        out = set(touched.get(f, ())) | set(new.get(m.t_at, ()))
        if m.kind == "multipleRecordLinks":   # ячейка связи — имена: сменилось имя у связанной записи
            far = recs(_primary_of(conn, _as_dict(m.options)["linkedTableId"]))
            if far:
                out |= {o for o, _ in _pairs(conn, f, linked=far)[0]}
        dirty[f] = out
        return out

    for fid in TopologicalSorter(graph).static_order():
        r = info[fid]
        m = _field_meta(conn, fid)
        o = _as_dict(r.options)
        if fid not in prev or (_is_clock(r) and today != prev_today):
            only = None
        elif r.kind == "formula":
            only = set(new.get(m.t_at, ())).union(*(recs(x) for x in _refs(parse(o["formula"]))))
        else:
            link, src = o.get("recordLinkFieldId"), o.get("fieldIdInLinkedTable")
            only = set(new.get(m.t_at, ())) | (recs(link) if link else set())
            far = set().union(*(recs(x) for x in [src, *_condition_fields(o.get("filters"))] if x))
            if far and link:
                only |= {ow for ow, _ in _pairs(conn, link, linked=far)[0]}
        if only is not None and not only:
            cache.computed[fid] = prev[fid]
            dirty[fid] = set()
            continue
        part = _compute_one(conn, r, today, aggs, cache, only)
        if only is None:
            cache.computed[fid] = part
            old = prev.get(fid, {})
            dirty[fid] = {k for k in set(part) | set(old) if part.get(k) != old.get(k)}
        else:
            merged = dict(prev[fid])
            merged.update(part)
            cache.computed[fid] = merged
            dirty[fid] = {k for k in only if part.get(k) != prev[fid].get(k)}
    if report is not None:   # правки (обе стороны связей), новые записи и изменившиеся вычисляемые значения
        for f, recs in [*touched.items(), *((f, r) for f, r in dirty.items() if f in info)]:
            m = _field_meta(conn, f)
            if m is not None and recs:
                report.setdefault(m.t_at, set()).update(recs)
        for t, recs in new.items():
            report.setdefault(t, set()).update(recs)
    return cache.computed

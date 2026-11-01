"""Виды Airtable → app_view. Публичный API отдаёт только название, тип и видимые колонки grid-видов;
фильтры, сортировки и группировки сняты из веб-клиента Airtable (view_filters.json, см. load_views)."""
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

OPS = {"=": "eq", "!=": "neq", "contains": "contains", "doesNotContain": "not_contains",
       "isEmpty": "empty", "isNotEmpty": "not_empty", "<": "lt", ">": "gt", "<=": "lte", ">=": "gte",
       "isAnyOf": "any_of", "isNoneOf": "none_of", "|": "any_of", "hasAnyOf": "any_of"}
NO_VALUE = {"empty", "not_empty"}


def _value(v, recs):
    """Значение условия Airtable → наше: id записи → её название, дата {exactDate} → YYYY-MM-DD."""
    if isinstance(v, list):
        return [str(_value(x, recs)) for x in v]
    if isinstance(v, dict):
        return v["exactDate"][:10] if v.get("mode") == "exactDate" else None
    return recs.get(v, v) if isinstance(v, str) else v


def _or(sub: list[dict]) -> dict | None:
    """ИЛИ по одной колонке сводится к «любое из»; иначе в нашей модели (только И) не выражается."""
    if len({s["col"] for s in sub}) != 1:
        return None
    ops = {s["op"] for s in sub}
    vals = [x for s in sub for x in (s["value"] if isinstance(s["value"], list) else [s["value"]])]
    if ops <= {"eq", "any_of"}:
        return {"col": sub[0]["col"], "op": "any_of", "value": [str(x) for x in vals]}
    if ops == {"contains"}:
        return {"col": sub[0]["col"], "op": "contains_any", "value": [str(x) for x in vals]}
    return None


def _filters(fs: dict, cols: dict, recs: dict, problems: list) -> list[dict]:
    out = []
    for x in fs.get("f", []):
        if isinstance(x, dict):
            out += _filters(x, cols, recs, problems)
            continue
        fid, op, val = x
        if fid not in cols:
            problems.append(f"условие по удалённому полю {fid}")
        elif op not in OPS:
            problems.append(f"условие «{op}» не поддерживается")
        elif OPS[op] in NO_VALUE:
            out.append({"col": cols[fid], "op": OPS[op]})
        elif (v := _value(val, recs)) not in (None, "", []):   # незаполненное условие Airtable игнорирует
            out.append({"col": cols[fid], "op": OPS[op], "value": v})
    if fs.get("c") == "or" and len(out) > 1:
        one = _or(out)
        if one is None:
            problems.append("ИЛИ по разным полям или условиям")
            return []
        out = [one]
    return out


def convert_view(raw: dict, cols: dict, recs: dict) -> tuple[dict, list[str]]:
    """Фильтры/сортировка/группировка вида → наш config. Если какое-то условие не переводится,
    фильтры не ставим вовсе (частичный фильтр молча покажет не те записи) и возвращаем причины."""
    cfg, problems = {}, []
    if raw.get("f"):
        f = _filters(raw["f"], cols, recs, problems)
        if f and not problems:
            cfg["filters"] = f
    if s := [{"col": cols[c], "desc": not asc} for c, asc in raw.get("s", []) if c in cols]:
        cfg["sort"] = s
    # ponytail: порядок групп всегда по возрастанию (в Airtable «по убыванию» у 3 уровней из 134)
    if g := [cols[c] for c, _ in raw.get("g", []) if c in cols][:3]:
        cfg["group"] = g
    return cfg, problems


def _record_names(c, raw: dict) -> dict:
    """Названия записей, на которые ссылаются условия (id rec… → первичное поле)."""
    ids = {v for r in raw.values() for v in _rec_ids(r.get("f", {}))}
    names = {}
    if not ids:
        return names
    comp = None
    for pg, prim, prim_at in c.execute(text(
            "select t.pg_name, t.primary_field, f.airtable_id from app_table t "
            "join app_field f on f.table_id = t.id and f.column_name = t.primary_field")).all():
        stored = c.execute(text("select 1 from information_schema.columns where table_name = :t and column_name = :c"),
                           {"t": pg, "c": prim}).first()
        if stored:
            q = text(f'select airtable_id, "{prim}"::text from {pg} where airtable_id in :ids').bindparams(
                bindparam("ids", expanding=True))
            names.update(c.execute(q, {"ids": list(ids)}).all())
        else:   # первичное поле — формула: значение только у движка
            if comp is None:
                from datetime import date
                from .compute import compute_all
                comp = compute_all(c, date.today())
            names.update((r, str(v)) for r, v in comp.get(prim_at, {}).items() if r in ids and v is not None)
    return names


def _rec_ids(fs: dict):
    for x in fs.get("f", []):
        if isinstance(x, dict):
            yield from _rec_ids(x)
        else:
            for v in x[2] if isinstance(x[2], list) else [x[2]]:
                if isinstance(v, str) and v.startswith("rec"):
                    yield v


def load_views(c, schema: list[dict], raw: dict | None = None) -> int:
    """Общие grid-виды (личные и прочие типы — вне v1). Повторный запуск обновляет по airtable_id.
    raw — {id вида: {f, s, g}} из веб-клиента Airtable; непереводимые фильтры печатаются."""
    raw = raw or {}
    tables = dict(c.execute(text("select airtable_id, id from app_table")).all())
    cols = dict(c.execute(text("select airtable_id, column_name from app_field where airtable_id is not null")).all())
    recs = _record_names(c, raw)
    n = 0
    for t in schema:
        tid = tables.get(t["id"])
        if tid is None:
            continue
        for order, v in enumerate(t.get("views", [])):
            if v["type"] != "grid" or v.get("personalForUserId"):
                continue
            config = {"source": "airtable"}
            if "visibleFieldIds" in v:   # в старых снимках колонок нет — тогда видны все
                config["columns"] = [cols[f] for f in v["visibleFieldIds"] if f in cols]
            extra, problems = convert_view(raw.get(v["id"], {}), cols, recs)
            config |= extra
            for p in problems:
                print(f"Вид «{t.get('name', t['id'])} / {v['name']}»: фильтры не перенесены — {p}")
            c.execute(text(
                "insert into app_view (table_id, title, kind, config, sort_order, airtable_id) "
                "values (:t, :n, 'grid', :c, :o, :a) "
                "on conflict (airtable_id) do update set title = excluded.title, config = excluded.config, "
                "sort_order = excluded.sort_order"
            ).bindparams(bindparam("c", type_=JSONB)), {"t": tid, "n": v["name"], "c": config, "o": order, "a": v["id"]})
            n += 1
    return n

"""Полные настройки видов из веб-клиента Airtable (at_view_datas.jsonl, по строке на вид) → app_view.config.

Сверх load_views: ширины колонок, закреплённые колонки, высота строк, итоги внизу, цвет строк,
признак «вид закреплён», ручной порядок записей там, где сортировка в Airtable выключена
(shouldAutoSort = false — тогда Airtable показывает сохранённый порядок, а не сортирует)."""
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from .views import _filters, _record_names, load_views


def compact(fs: dict | None) -> dict:
    """Фильтры веб-клиента {conjunction, filterSet} → формат load_views {c, f}."""
    if not fs:
        return {}
    out = []
    for x in fs.get("filterSet", []):
        if x.get("type") == "nested":
            out.append(compact(x))
        else:
            out.append([x["columnId"], x["operator"], x.get("value")])
    return {"c": fs.get("conjunction", "and"), "f": out}


def _raw(vd: dict) -> dict:
    s = vd.get("lastSortsApplied") or {}
    return {
        "f": compact(vd.get("filters")),
        "s": [[x["columnId"], x["ascending"]] for x in s.get("sortSet", [])] if s.get("shouldAutoSort") else [],
        "g": [[x["columnId"], x.get("order")] for x in vd.get("groupLevels") or []],
    }


def load_view_meta(c, lines: list[dict]) -> int:
    """Общие grid-виды: базовый перенос (load_views) + дополнительные настройки. Возвращает число видов."""
    schema, raw, by_table = {}, {}, {}
    for x in lines:
        v, vd = x["view"], x["viewData"]
        t = schema.setdefault(x["tableId"], {"id": x["tableId"], "name": x.get("table"), "views": []})
        visible = [o["columnId"] for o in vd.get("columnOrder", []) if o.get("visibility")]
        t["views"].append({**v, "visibleFieldIds": visible})
        raw[v["id"]] = _raw(vd)
        by_table[v["id"]] = x["tableId"]
    n = load_views(c, list(schema.values()), raw)

    cols = dict(c.execute(text("select airtable_id, column_name from app_field where airtable_id is not null")).all())
    recs = _record_names(c, {k: r for k, r in raw.items()})
    ids_cache: dict[str, dict] = {}

    def rec_ids(table_at: str) -> dict:
        if table_at not in ids_cache:
            pg = c.execute(text("select pg_name from app_table where airtable_id = :a"), {"a": table_at}).scalar()
            ids_cache[table_at] = dict(c.execute(text(f"select airtable_id, id from {pg}")).all()) if pg else {}
        return ids_cache[table_at]

    for x in lines:
        v, vd = x["view"], x["viewData"]
        if v["type"] != "grid" or v.get("personalForUserId"):
            continue
        meta = (vd.get("metadata") or {}).get("grid", {})
        extra = {
            "widths": {cols[o["columnId"]]: o["width"] for o in vd.get("columnOrder", [])
                       if o.get("width") and o["columnId"] in cols and o.get("visibility")},
            "frozen": vd.get("frozenColumnCount", 1),
        }
        if meta.get("rowHeight"):
            extra["rowHeight"] = meta["rowHeight"]
        summary = {cols[k]: s["aggregationFunction"] for k, s in (meta.get("summaryBarConfigsByColumnId") or {}).items()
                   if k in cols and s.get("aggregationFunction") not in (None, "none")}
        if summary:
            extra["summary"] = summary
        cc = vd.get("colorConfig") or {}
        if cc.get("type") == "selectColumn" and cc.get("selectColumnId") in cols:
            extra["color"] = {"kind": "select", "col": cols[cc["selectColumnId"]]}
        elif cc.get("type") == "colorDefinitions":
            rules = []
            for d in cc.get("colorDefinitions") or []:
                problems = []
                f = _filters(compact(d), cols, recs, problems)
                if f and not problems:
                    rules.append({"color": d["color"], "filters": f})
            if rules:
                extra["color"] = {"kind": "rules", "rules": rules}
        if vd.get("lock"):
            extra["locked"] = True
        s = vd.get("lastSortsApplied") or {}
        if not s.get("shouldAutoSort") and vd.get("rowOrder"):
            ids = rec_ids(by_table[v["id"]])
            extra["rowOrder"] = [ids[r["rowId"]] for r in vd["rowOrder"] if r["rowId"] in ids]
        c.execute(text("update app_view set config = config || :e where airtable_id = :a")
                  .bindparams(bindparam("e", type_=JSONB)), {"e": extra, "a": v["id"]})
    return n

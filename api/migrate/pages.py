"""Страницы интерфейсов Airtable → app_page. Публичный API их не отдаёт: раскладка и настройки
сняты из веб-клиента (data/snapshot/at_pages.jsonl, по строке на страницу: bundle, pageMeta, page)."""
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from .view_meta import compact
from .views import NO_VALUE, OPS, _filters, _value

# дашборд и «список + карточка» (inbox — список, cellEditor — поле карточки);
# вложения в карточке, галерея, queryContainer — отдельным шагом
SUPPORTED = {"bigNumber", "chart", "filter", "grid", "inbox", "cellEditor"}
AGG = {"sum": "sum", "max": "max", "min": "min", "average": "avg", "avg": "avg",
       "countUnique": "unique", "distinct": "unique", "count": "filled", "rowCount": "count"}
BUCKET = {"yearMonth": "month", "year": "year", "date": "day", "isoWeek": "week"}


def _children(L: dict) -> dict:
    out = {}
    for kind in ("columnsRowById", "columnById", "elementRowById"):
        for n in L.get(kind, {}).values():
            out.setdefault(n["parentId"], []).append((kind, n))
    for v in out.values():
        v.sort(key=lambda p: p[1]["index"])
    return out


def _agg(y: dict, cols: dict) -> dict:
    if y.get("type") == "rowCount":
        return {"agg": "count", "col": None}
    return {"agg": AGG.get(y.get("aggregationFunction"), "count"), "col": cols.get(y.get("columnId"))}


def _element(e: dict, tables: dict, cols: dict, names: dict) -> dict:
    if e["type"] == "cellEditor":   # поле выбранной в списке записи
        src = e.get("source") or {}
        return {"type": "field", "table": tables.get(src.get("row", {}).get("tableId")), "col": cols.get(src.get("columnId")),
                "readonly": bool(e.get("isReadOnly"))}
    q = e.get("query") or {}
    base = {"table": tables.get(q.get("source", {}).get("tableId")),
            "filter": (q.get("interactiveFilters") or {}).get("outputId")}
    if e["type"] == "bigNumber":
        s = e.get("summary") or {}
        agg = "count" if s.get("type") == "rowCount" else AGG.get(s.get("summaryFunctionKey"), "sum")
        return {"type": "number", "table": base["table"], "col": cols.get(e.get("columnId")), "agg": agg,
                "label": e.get("descriptionText"), "color": e.get("colorTheme"), "filter": base["filter"]}
    if e["type"] == "chart":
        d = e["definition"]
        if d["type"] == "pie":
            x, y, group, bucket = d.get("sliceColumnId"), d.get("sliceArcLength") or {}, None, None
        else:
            x, y, group = d.get("xAxisColumnId"), d.get("yAxis") or {}, cols.get(d.get("yAxisGroupColumnId"))
            bucket = BUCKET.get(d.get("xAxisDateBucketUnit"))
        cs = d.get("colorScheme") or {}
        out = {"type": "chart", "kind": d["type"], "table": base["table"], "title": e.get("title"),
               "x": cols.get(x), "bucket": bucket, "group": group, "y": _agg(y, cols),
               "empty": bool(d.get("shouldIncludeEmpty")), "filter": base["filter"],
               # палитра графика Airtable: схема + цвет одиночной серии; fieldColors — цвета вариантов поля
               "colors": {"scheme": cs.get("colorSchemeName", "airtable"), "primary": cs.get("primaryColorIndex", 3),
                          "field": d.get("colorMode") == "fieldColors"}}
        if d["type"] == "pie":
            del out["bucket"], out["group"]
        return out
    # grid: колонки, сортировка, группы (суммы по группам), ширины, цвет строк по правилам — как вид
    rules = []
    cc = e.get("colorConfig") or {}
    for d in cc.get("colorDefinitions") or [] if cc.get("type") == "colorDefinitions" else []:
        problems: list[str] = []
        f = _filters(compact(d), cols, names, problems)
        if f and not problems:
            rules.append({"color": d["color"], "filters": f})
    return {"type": "grid", "table": base["table"], "filter": base["filter"],
            "columns": [cols[c] for c in e.get("visibleColumnIds", []) if c in cols],
            "sort": [{"col": cols[s["columnId"]], "desc": not s.get("ascending", True)}
                     for s in q.get("sorts", []) if s["columnId"] in cols],
            "groups": [{"col": cols[g["columnId"]], "desc": not g.get("ascending", True)}
                       for g in e.get("groupLevels") or [] if g["columnId"] in cols],
            "widths": {cols[c]: w for c, w in (e.get("widthByColumnId") or {}).items() if c in cols},
            "color": {"kind": "rules", "rules": rules} if rules else None}


def _conds(fs: dict, cols: dict, names: dict, problems: list) -> list[dict]:
    """Условия фильтра страницы. Без значения — заготовка, которую зритель заполняет сам: оставляем с None."""
    out = []
    for fid, op, val in compact(fs).get("f", []) if fs else []:
        if isinstance(fid, dict) or fid not in cols or op not in OPS:
            problems.append(f"условие фильтра страницы «{op}» по {fid} не переносится")
            continue
        c = {"col": cols[fid], "op": OPS[op]}
        if OPS[op] not in NO_VALUE:
            v = _value(val, names) if val is not None else None
            c["value"] = None if v in ("", []) else v
        out.append(c)
    return out


def convert_page(raw: dict, tables: dict, cols: dict, names: dict) -> tuple[dict | None, list[str]]:
    """→ ({title, subtitle, filters, rows}, проблемы). rows: ряд → колонки → элементы (вложенный ряд — {"rows": …}).
    None — страница пустая или в ней есть элементы, которые мы пока не умеем показать."""
    L = raw["page"].get("publishedLayout") or {}
    E = L.get("elementById", {})
    if not E:
        return None, []
    odd = sorted({e["type"] for e in E.values()} - SUPPORTED)
    if odd:
        return None, [f"элемент {t} пока не переносится" for t in odd]
    problems: list[str] = []
    used = {(e.get("query") or {}).get("interactiveFilters", {}).get("outputId") for e in E.values()}
    kids = _children(L)
    canvas = next(iter(L.get("rowCanvasById", {})), None)
    # фильтры — из верхней полосы и из холста (в Airtable бывают и там, и там); на холсте их не рисуем
    bar = sorted(L.get("horizontalBarElementById", {}).values(), key=lambda n: n["index"])
    in_canvas = [n for n in L.get("elementRowById", {}).values() if E[n["elementId"]]["type"] == "filter"]
    filters = []
    for n in bar + sorted(in_canvas, key=lambda n: n["index"]):
        e = E[n["elementId"]]
        if e["type"] != "filter":   # в полосе карточки — заголовок записи, не фильтр
            continue
        out = e["outputs"]["interactiveFilters"]["id"]
        if out not in used:   # такой фильтр в Airtable ни на что не влияет
            continue
        label = e.get("label") or {}
        filters.append({"id": out, "table": tables.get(e.get("tableId")),
                        "label": label.get("value") if label.get("isEnabled") else None,
                        "conds": _conds(e.get("filters"), cols, names, problems)})

    def el(it):
        return _element(E[it["elementId"]], tables, cols, names) | {
            "w": it.get("widthUnits"), "h": (it.get("height") or {}).get("heightUnits")}

    def is_filter(kind, n):
        return kind == "elementRowById" and E[n["elementId"]]["type"] == "filter"

    def row(n):   # ряд → колонки → элементы; вложенный ряд стоит среди элементов как {"rows": [ряд]}
        out = []
        for _, c in kids.get(n["id"], []):
            out.append([el(it) if ki == "elementRowById" else {"rows": [row(it)]}
                        for ki, it in kids.get(c["id"], []) if not is_filter(ki, it)])
        return out

    # элемент прямо на холсте — ряд на всю ширину из одной колонки
    body = [row(n) if k == "columnsRowById" else [[el(n)]]
            for k, n in kids.get(canvas, []) if not is_filter(k, n)]
    out = {"title": raw["bundle"]["name"], "subtitle": raw["pageMeta"].get("name"), "filters": filters, "rows": body}
    # «список + карточка»: на весь корневой холст — список (inbox); его область — карточка выбранной записи:
    # сверху полоса с заголовком (первичное поле), под ней — те же ряды, что у дашборда (body)
    area = L.get("canvasAreaById", {}).get(L.get("rootCanvasAreaId"), {})
    full = L.get("fullCanvasElementById", {}).get(area.get("canvasId"))
    if full and E[full["elementId"]]["type"] == "inbox":
        e = E[full["elementId"]]
        q = e.get("query") or {}
        header = [_element(E[n["elementId"]], tables, cols, names)["col"]
                  for n in sorted(L.get("horizontalBarElementById", {}).values(), key=lambda n: n["index"])
                  if E[n["elementId"]]["type"] == "cellEditor"]
        out["list"] = {"table": tables.get(q.get("source", {}).get("tableId")),
                       "filters": _filters(compact(q.get("filters")), cols, names, problems) if q.get("filters") else [],
                       "sort": [{"col": cols[x["columnId"]], "desc": not x.get("ascending", True)}
                                for x in q.get("sorts", []) if x["columnId"] in cols],
                       "columns": [cols[c] for c in e.get("visibleColumnIds", []) if c in cols],
                       "header": [c for c in header if c]}
    return out, problems


def load_pages(c, pages: list[dict], schema: dict) -> tuple[int, list[str]]:
    """schema — at_base_schema.json (для названий вариантов выбора). Повторно — обновление по airtable_id."""
    tables = dict(c.execute(text("select airtable_id, id from app_table")).all())
    cols = dict(c.execute(text("select airtable_id, column_name from app_field where airtable_id is not null")).all())
    names = {sid: ch["name"] for t in schema.get("tableSchemas", []) for col in t.get("columns", [])
             for sid, ch in ((col.get("typeOptions") or {}).get("choices") or {}).items()}
    n, report = 0, []
    for order, raw in enumerate(pages):
        cfg, problems = convert_page(raw, tables, cols, names)
        report += [f"«{raw['bundle']['name']}»: {p}" for p in problems]
        if cfg is None:
            continue
        c.execute(text(
            "insert into app_page (title, config, sort_order, airtable_id) values (:t, :c, :o, :a) "
            "on conflict (airtable_id) do update set title = excluded.title, config = excluded.config, "
            "sort_order = excluded.sort_order"
        ).bindparams(bindparam("c", type_=JSONB)), {"t": cfg["title"], "c": cfg, "o": order, "a": raw["page"]["id"]})
        n += 1
    return n, report

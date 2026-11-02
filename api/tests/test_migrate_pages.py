"""Страницы интерфейсов Airtable (at_pages.jsonl) → наш конфиг дашборда."""
from migrate.pages import convert_page

TABLES = {"tblR": 7}
COLS = {"fldYear": "god", "fldM": "metry", "fldS": "status", "fldC": "zakazchik", "fldD": "data"}
NAMES = {"selDone": "Закончен"}


def _q(out="peoA"):
    return {"source": {"type": "table", "tableId": "tblR"}, "interactiveFilters": {"type": "filter", "outputId": out}}


def _page(elements, rows):
    """rows — [[ [elementId, width, height], ... ] на колонку ] — дерево Airtable в упрощённом виде."""
    L = {"elementById": {e["id"]: e for e in elements}, "rowCanvasById": {"cv": {"id": "cv"}},
         "columnsRowById": {}, "columnById": {}, "elementRowById": {},
         "horizontalBarElementById": {}}
    for ri, row in enumerate(rows):
        L["columnsRowById"][f"r{ri}"] = {"id": f"r{ri}", "parentId": "cv", "index": f"a{ri}"}
        for ci, col in enumerate(row):
            L["columnById"][f"r{ri}c{ci}"] = {"id": f"r{ri}c{ci}", "parentId": f"r{ri}", "index": f"a{ci}"}
            for ei, (eid, w, h) in enumerate(col):
                L["elementRowById"][f"e{eid}"] = {"id": f"e{eid}", "parentId": f"r{ri}c{ci}", "index": f"a{ei}",
                                                   "elementId": eid, "widthUnits": w, "height": {"heightUnits": h}}
    flt = [e for e in elements if e["type"] == "filter"]
    for i, e in enumerate(flt):
        L["horizontalBarElementById"][f"h{i}"] = {"id": f"h{i}", "index": f"a{i}", "elementId": e["id"]}
    return {"bundle": {"name": "Рейсы APS"}, "pageMeta": {"name": "Работы"}, "page": {"id": "pagX", "publishedLayout": L}}


def test_dashboard_converted():
    els = [
        {"id": "n1", "type": "bigNumber", "columnId": "fldM", "query": _q(), "descriptionText": "Пробурено",
         "summary": {"type": "columnSummary", "summaryFunctionKey": "sum"}, "colorTheme": "lightBlue"},
        {"id": "n2", "type": "bigNumber", "columnId": None, "query": _q(), "descriptionText": "Всего",
         "summary": {"type": "rowCount"}, "colorTheme": "lightGreen"},
        {"id": "c1", "type": "chart", "query": _q(), "title": "По годам",
         "definition": {"type": "bar", "xAxisColumnId": "fldD", "xAxisDateBucketUnit": "yearMonth",
                        "yAxis": {"type": "column", "columnId": "fldM", "aggregationFunction": "sum"},
                        "yAxisGroupColumnId": "fldC", "shouldIncludeEmpty": False}},
        {"id": "c2", "type": "chart", "query": _q(), "definition": {
            "type": "pie", "sliceColumnId": "fldC", "sliceArcLength": {"type": "rowCount"}}},
        {"id": "f1", "type": "filter", "tableId": "tblR", "label": {"isEnabled": True, "value": "Год"},
         "outputs": {"interactiveFilters": {"id": "peoA"}},
         "filters": {"conjunction": "and", "filterSet": [
             {"columnId": "fldYear", "operator": "isNotEmpty", "value": None},
             {"columnId": "fldS", "operator": "=", "value": "selDone"},
             {"columnId": "fldC", "operator": "isAnyOf", "value": None}]}},
        # фильтр, которым не пользуется ни один элемент — в Airtable ни на что не влияет
        {"id": "f2", "type": "filter", "tableId": "tblR", "outputs": {"interactiveFilters": {"id": "peoUnused"}},
         "filters": {"conjunction": "and", "filterSet": [{"columnId": "fldS", "operator": "=", "value": "selDone"}]}},
    ]
    cfg, problems = convert_page(_page(els, [[[("n1", 4, 2)], [("n2", 4, 2)]], [[("c1", 6, 6)], [("c2", 6, 6)]]]),
                                 TABLES, COLS, NAMES)
    assert problems == []
    assert cfg["title"] == "Рейсы APS" and cfg["subtitle"] == "Работы"
    assert cfg["filters"] == [{"id": "peoA", "table": 7, "label": "Год", "conds": [
        {"col": "god", "op": "not_empty"}, {"col": "status", "op": "eq", "value": "Закончен"},
        {"col": "zakazchik", "op": "any_of", "value": None}]}]
    (r1, r2) = cfg["rows"]
    assert r1[0][0] == {"type": "number", "table": 7, "col": "metry", "agg": "sum", "label": "Пробурено",
                        "color": "lightBlue", "filter": "peoA", "w": 4, "h": 2}
    assert r1[1][0]["agg"] == "count" and r1[1][0]["col"] is None
    assert r2[0][0] == {"type": "chart", "kind": "bar", "table": 7, "title": "По годам", "x": "data", "bucket": "month",
                        "group": "zakazchik", "y": {"agg": "sum", "col": "metry"}, "empty": False,
                        "filter": "peoA", "w": 6, "h": 6}
    assert r2[1][0]["kind"] == "pie" and r2[1][0]["x"] == "zakazchik" and r2[1][0]["y"] == {"agg": "count", "col": None}


def test_unsupported_page_skipped():
    els = [{"id": "g1", "type": "gallery", "query": _q()}]
    cfg, problems = convert_page(_page(els, [[[("g1", 12, 6)]]]), TABLES, COLS, NAMES)
    assert cfg is None and problems == ["элемент gallery пока не переносится"]


def test_empty_page_skipped():
    cfg, problems = convert_page(_page([], []), TABLES, COLS, NAMES)
    assert cfg is None and problems == []


def test_canvas_level_elements_and_inline_filter():
    """Элемент прямо на холсте — ряд на всю ширину; фильтр внутри холста — тоже фильтр страницы."""
    raw = _page([], [])
    L = raw["page"]["publishedLayout"]
    L["elementById"] = {
        "f1": {"id": "f1", "type": "filter", "tableId": "tblR", "outputs": {"interactiveFilters": {"id": "peoA"}},
               "filters": {"conjunction": "and", "filterSet": [{"columnId": "fldS", "operator": "=", "value": "selDone"}]}},
        "g1": {"id": "g1", "type": "grid", "query": _q() | {"sorts": [{"columnId": "fldM", "ascending": False}]},
               "visibleColumnIds": ["fldC", "fldM", "fldGone"]},
    }
    L["elementRowById"] = {"ef": {"id": "ef", "parentId": "cv", "index": "a0", "elementId": "f1"},
                           "eg": {"id": "eg", "parentId": "cv", "index": "a1", "elementId": "g1"}}
    cfg, problems = convert_page(raw, TABLES, COLS, NAMES)
    assert problems == []
    assert [f["id"] for f in cfg["filters"]] == ["peoA"]
    assert cfg["rows"] == [[[{"type": "grid", "table": 7, "filter": "peoA", "columns": ["zakazchik", "metry"],
                              "sort": [{"col": "metry", "desc": True}], "w": None, "h": None}]]]

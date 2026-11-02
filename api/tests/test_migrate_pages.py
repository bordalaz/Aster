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
                        "yAxisGroupColumnId": "fldC", "shouldIncludeEmpty": False,
                        "colorScheme": {"colorSchemeName": "tableauExtended", "primaryColorIndex": 0}, "colorMode": "colorScheme"}},
        {"id": "c2", "type": "chart", "query": _q(), "definition": {
            "type": "pie", "sliceColumnId": "fldC", "sliceArcLength": {"type": "rowCount"}, "colorMode": "fieldColors"}},
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
                        "filter": "peoA", "colors": {"scheme": "tableauExtended", "primary": 0, "field": False},
                        "w": 6, "h": 6}
    assert r2[1][0]["colors"] == {"scheme": "airtable", "primary": 3, "field": True}   # по умолчанию — палитра Airtable
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
               "visibleColumnIds": ["fldC", "fldM", "fldGone"], "groupLevels": [{"columnId": "fldC", "ascending": True}],
               "widthByColumnId": {"fldC": 260, "fldGone": 90},
               "colorConfig": {"type": "colorDefinitions", "colorDefinitions": [{"conjunction": "and", "color": "redDark",
                               "filterSet": [{"columnId": "fldM", "operator": "<", "value": 0}]}]}},
    }
    L["elementRowById"] = {"ef": {"id": "ef", "parentId": "cv", "index": "a0", "elementId": "f1"},
                           "eg": {"id": "eg", "parentId": "cv", "index": "a1", "elementId": "g1"}}
    cfg, problems = convert_page(raw, TABLES, COLS, NAMES)
    assert problems == []
    assert [f["id"] for f in cfg["filters"]] == ["peoA"]
    assert cfg["rows"] == [[[{"type": "grid", "table": 7, "filter": "peoA", "columns": ["zakazchik", "metry"],
                              "sort": [{"col": "metry", "desc": True}], "groups": [{"col": "zakazchik", "desc": False}],
                              "widths": {"zakazchik": 260},
                              "color": {"kind": "rules", "rules": [{"color": "redDark", "filters": cfg["rows"][0][0][0]["color"]["rules"][0]["filters"]}]},
                              "w": None, "h": None}]]]
    assert cfg["rows"][0][0][0]["color"]["rules"][0]["filters"]   # условие «metry < 0» перенесено


def test_list_and_card_page():
    """«Список + карточка»: список на весь корневой холст, в его области — заголовок записи и поля карточки."""
    row = {"type": "row", "tableId": "tblR", "outputId": "peoRow"}
    raw = _page([], [])
    L = raw["page"]["publishedLayout"]
    L["elementById"] = {
        "in": {"id": "in", "type": "inbox", "visibleColumnIds": ["fldC", "fldS"],
               "query": {"source": {"type": "table", "tableId": "tblR"},
                         "filters": {"conjunction": "and", "filterSet": [{"columnId": "fldS", "operator": "=", "value": "selDone"}]},
                         "sorts": [{"columnId": "fldC", "ascending": True}]}},
        "hd": {"id": "hd", "type": "cellEditor", "source": {"row": row, "columnId": "fldC"}, "isReadOnly": True},
        "f1": {"id": "f1", "type": "cellEditor", "source": {"row": row, "columnId": "fldM"}, "isReadOnly": True},
        "f2": {"id": "f2", "type": "cellEditor", "source": {"row": row, "columnId": "fldYear"}, "isReadOnly": False},
        "ph": {"id": "ph", "type": "attachmentCarousel", "source": {"row": row, "columnId": "fldD"}, "isReadOnly": True},
    }
    L["rootCanvasAreaId"] = "root"
    L["canvasAreaById"] = {"root": {"id": "root", "canvasId": "full"}}
    L["fullCanvasElementById"] = {"full": {"id": "full", "elementId": "in"}}
    L["horizontalBarElementById"] = {"b": {"id": "b", "index": "a0", "elementId": "hd"}}
    L["elementRowById"] = {"r2": {"id": "r2", "parentId": "cv", "index": "a1", "elementId": "f2", "widthUnits": 6},
                           "r1": {"id": "r1", "parentId": "cv", "index": "a0", "elementId": "f1", "widthUnits": 6},
                           "r3": {"id": "r3", "parentId": "cv", "index": "a2", "elementId": "ph", "widthUnits": 6,
                                  "height": {"type": "provided", "heightUnits": 6}}}
    cfg, problems = convert_page(raw, TABLES, COLS, NAMES)
    assert problems == [] and cfg["filters"] == []
    assert cfg["list"] == {"table": 7, "filters": [{"col": "status", "op": "eq", "value": "Закончен"}],
                           "sort": [{"col": "zakazchik", "desc": False}], "columns": ["zakazchik", "status"],
                           "header": ["zakazchik"]}
    assert [r[0][0]["col"] for r in cfg["rows"]] == ["metry", "god", "data"]
    assert cfg["rows"][2][0][0] == {"type": "attachments", "table": 7, "col": "data", "readonly": True, "w": 6, "h": 6}
    assert cfg["rows"][1][0][0] == {"type": "field", "table": 7, "col": "god", "readonly": False, "w": 6, "h": None}

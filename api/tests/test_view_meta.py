"""Полные настройки видов из веб-клиента Airtable (at_view_datas.jsonl) → app_view.config."""
from sqlalchemy import text

from app.db import engine


def _line(view, **vd):
    return {"tableId": "tblA", "table": "T", "view": {"id": view, "name": "Вид " + view, "type": "grid", "personalForUserId": None},
            "viewData": {"columnOrder": [{"columnId": "fldA", "visibility": True, "width": 300},
                                         {"columnId": "fldB", "visibility": True, "width": 120},
                                         {"columnId": "fldC", "visibility": False, "width": 90}],
                         "frozenColumnCount": 2, **vd}}


def test_full_view_meta(zip_table):
    from migrate.view_meta import load_view_meta
    with engine.begin() as c:
        c.execute(text("update app_table set airtable_id = 'tblA' where id = :t"), {"t": zip_table})
        c.execute(text("alter table zip_test add column airtable_id text"))
        c.execute(text("update zip_test set airtable_id = 'rec' || id"))
        c.execute(text("update app_field set airtable_id = case column_name when 'name' then 'fldA' when 'qty' then 'fldB' else 'fldC' end "
                       "where table_id = :t"), {"t": zip_table})
        lines = [
            _line("viwAuto", lastSortsApplied={"sortSet": [{"columnId": "fldB", "ascending": False}], "shouldAutoSort": True},
                  metadata={"grid": {"rowHeight": "medium", "summaryBarConfigsByColumnId": {"fldB": {"aggregationFunction": "sum"},
                                                                                          "fldA": {"aggregationFunction": "none"}}}},
                  colorConfig={"type": "selectColumn", "selectColumnId": "fldC"},
                  lock={"lockLevelToEditViewConfig": "locked"}),
            _line("viwManual", lastSortsApplied={"sortSet": [{"columnId": "fldB", "ascending": True}], "shouldAutoSort": False},
                  rowOrder=[{"rowId": "rec2"}, {"rowId": "rec1"}],
                  colorConfig={"type": "colorDefinitions", "colorDefinitions": [
                      {"color": "redDark", "conjunction": "and", "filterSet": [{"columnId": "fldC", "operator": "contains", "value": "b"}]}]}),
        ]
        n = load_view_meta(c, lines)
        assert n == 2
        cfg = dict(c.execute(text("select airtable_id, config from app_view")).all())
    a, m = cfg["viwAuto"], cfg["viwManual"]
    assert a["columns"] == ["name", "qty"] and a["widths"] == {"name": 300, "qty": 120}
    assert a["frozen"] == 2 and a["rowHeight"] == "medium" and a["locked"] is True
    assert a["sort"] == [{"col": "qty", "desc": True}] and a["summary"] == {"qty": "sum"}
    assert a["color"] == {"kind": "select", "col": "note"}
    assert "sort" not in m and m["rowOrder"] == [2, 1]          # сортировка выключена — ручной порядок
    assert m["color"] == {"kind": "rules", "rules": [{"color": "redDark", "filters": [{"col": "note", "op": "contains", "value": "b"}]}]}

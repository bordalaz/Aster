"""Виды (spec R10): общие и личные, строгая схема config, перенос из Airtable."""
import pytest
from sqlalchemy import text

from app.db import engine
from tests.test_access import as_user, tables  # noqa: F401 — фикстура

CFG = {"columns": ["name"], "widths": {"name": 200}, "sort": [{"col": "name", "desc": True}], "group": "name",
       "filters": [{"col": "name", "op": "contains", "value": "x"}]}


def create(c, tid, title="Мой", shared=False, config=CFG):
    return c.post(f"/api/tables/{tid}/views", json={"title": title, "shared": shared, "config": config})


def test_personal_view_roundtrip_and_privacy(tables):
    u = as_user("u", "user")
    r = create(u, tables["eq"])
    assert r.status_code == 200
    vid = r.json()["id"]
    got = u.get(f"/api/tables/{tables['eq']}/views").json()
    assert [(v["id"], v["title"], v["shared"], v["mine"]) for v in got] == [(vid, "Мой", False, True)]
    assert got[0]["config"]["sort"] == [{"col": "name", "desc": True}]
    other = as_user("o", "user")
    assert other.get(f"/api/tables/{tables['eq']}/views").json() == []           # личный чужим не виден
    assert other.patch(f"/api/views/{vid}", json={"title": "x"}).status_code == 404
    assert other.delete(f"/api/views/{vid}").status_code == 404


def test_shared_view_admin_only(tables):
    assert create(as_user("u", "user"), tables["eq"], shared=True).status_code == 403
    a = as_user("a", "admin")
    vid = create(a, tables["eq"], title="Общий", shared=True).json()["id"]
    u = as_user("u2", "user")
    v = u.get(f"/api/tables/{tables['eq']}/views").json()[0]
    assert (v["title"], v["shared"], v["mine"]) == ("Общий", True, False)
    assert u.patch(f"/api/views/{vid}", json={"title": "x"}).status_code == 403
    assert u.delete(f"/api/views/{vid}").status_code == 403
    assert a.patch(f"/api/views/{vid}", json={"title": "Новый", "config": {"columns": []}}).status_code == 200
    assert as_user("a2", "admin").delete(f"/api/views/{vid}").status_code == 200   # общий правит любой админ


def test_owner_edits_and_deletes_personal(tables):
    u = as_user("u", "user")
    vid = create(u, tables["eq"]).json()["id"]
    assert u.patch(f"/api/views/{vid}", json={"config": {"sort": []}}).status_code == 200
    assert u.get(f"/api/tables/{tables['eq']}/views").json()[0]["config"] == {"sort": []}
    assert u.delete(f"/api/views/{vid}").status_code == 200
    assert u.get(f"/api/tables/{tables['eq']}/views").json() == []


@pytest.mark.parametrize("config", [
    {"columns": ["nope"]},                                        # нет такой колонки
    {"sort": [{"col": "name", "desc": True, "x": 1}]},             # лишнее поле
    {"filters": [{"col": "name", "op": "drop table", "value": 1}]},  # неизвестное условие
    {"widths": {"name": 99999}},                                  # вне диапазона
    {"evil": 1},
    {"group": "nope"},
])
def test_config_strict(tables, config):
    assert create(as_user("u", "user"), tables["eq"], config=config).status_code == 422


def test_views_follow_table_visibility(tables):
    assert as_user("u", "user").get(f"/api/tables/{tables['fin']}/views").status_code == 404
    assert create(as_user("u2", "user"), tables["fin"]).status_code == 404


def test_title_required(tables):
    assert create(as_user("u", "user"), tables["eq"], title="").status_code == 422


# --- перенос из Airtable ---

def test_import_airtable_views(loaded_fixture):
    from migrate.views import load_views

    schema = [
        {"id": "tblBBBBBBBBBBBBBB", "views": [
            {"id": "viwB1", "name": "В работе", "type": "grid",
             "visibleFieldIds": ["fldBwork000000000", "fldBinv0000000000", "fldGone0000000000"]},
            {"id": "viwB2", "name": "Канбан", "type": "kanban"},
            {"id": "viwB3", "name": "Личный", "type": "grid", "personalForUserId": "usrX", "visibleFieldIds": []},
        ]},
        {"id": "tblMissing", "views": [{"id": "viwZ", "name": "?", "type": "grid", "visibleFieldIds": []}]},
    ]
    with engine.begin() as c:
        assert load_views(c, schema) == 2
        assert load_views(c, schema) == 2   # повторно — обновление, без дублей
        rows = c.execute(text("select title, kind, owner_id, config, airtable_id from app_view where at_owner is null")).all()
        personal = c.execute(text("select owner_id, at_owner from app_view where airtable_id = 'viwB3'")).one()
        cols = dict(c.execute(text("select airtable_id, column_name from app_field")).all())
    assert personal == (None, {"id": "usrX", "name": "usrX"})   # личный Airtable — ничей, с автором, не общий
    assert len(rows) == 1
    title, kind, owner, config, at = rows[0]
    assert (title, kind, owner, at) == ("В работе", "grid", None, "viwB1")
    assert config == {"columns": [cols["fldBwork000000000"], cols["fldBinv0000000000"]], "source": "airtable"}


def test_convert_airtable_filters():
    """Фильтры/сортировки/группировки из веб-клиента Airtable (view_filters.json) → наш config."""
    from migrate.views import convert_view

    cols = {"fldA": "f_a", "fldB": "f_b", "fldD": "f_d"}
    recs = {"rec1": "Склад 1"}
    raw = {"f": {"c": "and", "f": [
        ["fldA", "=", "В работе"],
        ["fldA", "!=", None],                                   # незаполненное — Airtable игнорирует
        ["fldB", "|", ["rec1", "recGone"]],                      # «имеет любое из» по ссылке
        ["fldD", ">", {"mode": "exactDate", "exactDate": "2023-07-01T00:00:00.000Z"}],
        {"c": "and", "f": [["fldB", "isNotEmpty", None]]},        # вложенное И — разворачивается
        {"c": "or", "f": [["fldA", "contains", "ГПН"], ["fldA", "contains", "ТФ"]]},
        {"c": "or", "f": [["fldA", "=", "x"], ["fldA", "isAnyOf", ["y", "z"]]]},
        {"c": "or", "f": []},                                     # пустая группа
    ]}, "s": [["fldA", 1], ["fldD", 0]], "g": [["fldB", "ascending"], ["fldA", "descending"]]}
    cfg, problems = convert_view(raw, cols, recs)
    assert problems == []
    assert cfg == {
        "filters": [
            {"col": "f_a", "op": "eq", "value": "В работе"},
            {"col": "f_b", "op": "any_of", "value": ["Склад 1", "recGone"]},
            {"col": "f_d", "op": "gt", "value": "2023-07-01"},
            {"col": "f_b", "op": "not_empty"},
            {"col": "f_a", "op": "contains_any", "value": ["ГПН", "ТФ"]},
            {"col": "f_a", "op": "any_of", "value": ["x", "y", "z"]},
        ],
        "sort": [{"col": "f_a", "desc": False}, {"col": "f_d", "desc": True}],
        "group": ["f_b", "f_a"],
    }

    # непереводимое — не теряем молча: вид без фильтров + список причин
    cfg, problems = convert_view({"f": {"c": "and", "f": [
        {"c": "or", "f": [["fldA", "=", "x"], ["fldB", "=", "y"]]}, ["fldGone", "=", "1"]]}}, cols, recs)
    assert "filters" not in cfg and len(problems) == 2


def test_import_airtable_view_filters(loaded_fixture):
    from migrate.views import load_views

    schema = [{"id": "tblBBBBBBBBBBBBBB", "views": [
        {"id": "viwB1", "name": "В работе", "type": "grid", "visibleFieldIds": ["fldBwork000000000"]}]}]
    raw = {"viwB1": {"f": {"c": "and", "f": [["fldBwork000000000", "contains", "a"]]}, "g": [["fldBinv0000000000", "ascending"]]}}
    with engine.begin() as c:
        assert load_views(c, schema, raw) == 1
        config = c.execute(text("select config from app_view")).scalar()
        cols = dict(c.execute(text("select airtable_id, column_name from app_field")).all())
    assert config == {"columns": [cols["fldBwork000000000"]], "source": "airtable",
                      "filters": [{"col": cols["fldBwork000000000"], "op": "contains", "value": "a"}],
                      "group": [cols["fldBinv0000000000"]]}
    # вариант выбора в условии — по id (sel…), как хранит веб-клиент → название варианта
    raw = {"viwB1": {"f": {"c": "and", "f": [["fldAtype000000000", "=", "selAAAAAAAAAAAAA2"]]}}}
    schema[0]["id"] = "tblAAAAAAAAAAAAAA"
    with engine.begin() as c:
        c.execute(text("delete from app_view"))
        load_views(c, schema, raw)
        f = c.execute(text("select config->'filters' from app_view")).scalar()
    assert f == [{"col": cols["fldAtype000000000"], "op": "eq", "value": "скважинное"}]


@pytest.mark.parametrize("config", [
    {"filters": [{"col": "x", "op": "any_of", "value": "строка"}]},       # списочное условие — только список
    {"filters": [{"col": "x", "op": "eq", "value": ["a"]}]},              # список — только у списочных
    {"group": ["a", "b", "c", "d"]},                                       # не больше 3 уровней
])
def test_list_ops_strict(tables, config):
    assert create(as_user("u", "user"), tables["eq"], config=config).status_code == 422


def test_row_order_saved_for_everyone_admins_only_on_shared(tables):
    """Перетаскивание строк, как в Airtable: ручной порядок вида у всех; общий вид меняют администраторы."""
    a = as_user("a", "admin")
    vid = create(a, tables["eq"], title="Общий", shared=True).json()["id"]
    assert a.put(f"/api/views/{vid}/row-order", json={"order": [3, 1, 2]}).status_code == 200
    u = as_user("u", "user")
    assert u.get(f"/api/tables/{tables['eq']}/views").json()[0]["config"]["rowOrder"] == [3, 1, 2]
    assert u.put(f"/api/views/{vid}/row-order", json={"order": [1]}).status_code == 403
    assert a.put(f"/api/views/{vid}/row-order", json={"order": ["x"]}).status_code == 422


def test_airtable_view_settings_survive_save(tables):
    """Вид из Airtable (итоги, закрепление, высота строк, цвет, ручной порядок) сохраняется без 422."""
    a = as_user("a", "admin")
    vid = create(a, tables["eq"], title="Общий", shared=True).json()["id"]
    cfg = {"columns": ["name"], "summary": {"name": "count"}, "frozen": 2, "rowHeight": "medium",
           "color": {"kind": "select", "col": "name"}, "locked": True, "rowOrder": [2, 1], "source": "airtable"}
    assert a.patch(f"/api/views/{vid}", json={"config": cfg}).status_code == 200
    assert a.get(f"/api/tables/{tables['eq']}/views").json()[0]["config"] == cfg
    assert a.patch(f"/api/views/{vid}", json={"config": {"summary": {"nope": "sum"}}}).status_code == 422


def test_gallery_view_listed_with_kind_and_cover(tables):
    """Галереи из Airtable отдаются вместе с табличными видами; обложка — колонка таблицы, иначе 422."""
    with engine.begin() as c:
        c.execute(text("insert into app_view (table_id, title, kind, config) values (:t, 'Галерея', 'gallery', "
                       "'{\"columns\": [\"name\"], \"cover\": \"name\"}')"), {"t": tables["eq"]})
    u = as_user("u", "user")
    got = u.get(f"/api/tables/{tables['eq']}/views").json()
    g = next(v for v in got if v["title"] == "Галерея")
    assert g["kind"] == "gallery" and g["config"]["cover"] == "name"
    assert create(u, tables["eq"], config={"cover": "nosuch"}).status_code == 422
    assert create(u, tables["eq"], config={"cover": "name"}).status_code == 200
    # канбан: поле колонок — тоже колонка таблицы
    with engine.begin() as c:
        c.execute(text("insert into app_view (table_id, title, kind, config) values (:t, 'Канбан', 'kanban', cast(:c as jsonb))"),
                  {"t": tables["eq"], "c": '{"stack": "name", "hideEmpty": true}'})
    k = next(v for v in u.get(f"/api/tables/{tables['eq']}/views").json() if v["title"] == "Канбан")
    assert k["kind"] == "kanban" and k["config"]["stack"] == "name"
    assert create(u, tables["eq"], config={"stack": "nosuch"}).status_code == 422
    # календарь: поля начала/конца — колонки таблицы; вид виден в списке
    with engine.begin() as c:
        c.execute(text("insert into app_view (table_id, title, kind, config) values (:t, 'Календарь', 'calendar', cast(:c as jsonb))"),
                  {"t": tables["eq"], "c": '{"start": "name"}'})
    assert any(v["kind"] == "calendar" for v in u.get(f"/api/tables/{tables['eq']}/views").json())
    assert create(u, tables["eq"], config={"start": "nosuch"}).status_code == 422
    assert create(u, tables["eq"], config={"end": "nosuch"}).status_code == 422
    # таймлайн: в списке; стили подписи — только по колонкам таблицы
    with engine.begin() as c:
        c.execute(text("insert into app_view (table_id, title, kind, config) values (:t, 'Таймлайн', 'timeline', cast(:c as jsonb))"),
                  {"t": tables["eq"], "c": '{"start": "name", "layout": "stacked", "totals": {"label": "Всего"}}'})
    assert any(v["kind"] == "timeline" for v in u.get(f"/api/tables/{tables['eq']}/views").json())
    assert create(u, tables["eq"], config={"start": "name", "labelStyle": {"nosuch": {"bold": True}}}).status_code == 422
    assert create(u, tables["eq"], config={"start": "name", "layout": "stacked", "groupDesc": True}).status_code == 200


def test_airtable_personal_views_for_admins_only(tables):
    """Личные виды Airtable — ничьи, с автором: всем админам (решение владельца), остальным не видны."""
    t = tables["eq"]
    with engine.begin() as c:
        c.execute(text("insert into app_view (table_id, title, kind, config, at_owner) values "
                       "(:t, 'Юрий''s view', 'grid', '{}', '{\"name\": \"Юрий Чернов\"}')"), {"t": t})
    got = {v["title"]: v for v in as_user("adm", "admin").get(f"/api/tables/{t}/views").json()}
    assert got["Юрий's view"]["airtable_owner"] == "Юрий Чернов" and not got["Юрий's view"]["shared"]
    assert all("airtable_owner" not in v for v in as_user("u2", "user").get(f"/api/tables/{t}/views").json())


def test_save_as_keeps_kind_and_gantt_deps(tables):
    """«Сохранить как…» таймлайна — снова таймлайн (раньше становился сеткой); deps — колонка таблицы, иначе 422."""
    u = as_user("u", "user")
    r = u.post(f"/api/tables/{tables['eq']}/views", json={"title": "Gantt", "kind": "timeline", "config": {"start": "name", "deps": "name"}})
    assert r.status_code == 200
    v = next(v for v in u.get(f"/api/tables/{tables['eq']}/views").json() if v["id"] == r.json()["id"])
    assert v["kind"] == "timeline" and v["config"]["deps"] == "name"
    assert create(u, tables["eq"], config={"deps": "nosuch"}).status_code == 422
    assert u.post(f"/api/tables/{tables['eq']}/views", json={"title": "x", "kind": "form"}).status_code == 422

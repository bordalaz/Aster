"""Страницы интерфейсов (дашборды): список и конфиг; страница с финансами — только тем, кто их видит."""
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from app.db import engine
from tests.test_access import as_user


def _add(title, table_id, col="qty"):
    cfg = {"title": title, "filters": [], "rows": [[[{"type": "number", "table": table_id, "col": col, "agg": "sum",
                                                      "label": "Всего", "filter": None}]]]}
    with engine.begin() as c:
        return c.execute(text("insert into app_page (title, config, sort_order) values (:t, :c, 0) returning id")
                         .bindparams(bindparam("c", type_=JSONB)), {"t": title, "c": cfg}).scalar()


def test_pages_listed_and_finance_hidden(zip_table):
    with engine.begin() as c:
        fin = c.execute(text("insert into app_table (title, pg_name, primary_field) values ('Договоры', 'x_fin', 'name') "
                             "returning id")).scalar()
    ok, secret = _add("Ремонты", zip_table), _add("Затраты", fin)
    admin, u = as_user("a", "admin"), as_user("u", "user")
    assert [p["title"] for p in admin.get("/api/pages").json()] == ["Ремонты", "Затраты"]
    assert [p["title"] for p in u.get("/api/pages").json()] == ["Ремонты"]
    assert u.get(f"/api/pages/{ok}").json()["rows"][0][0][0]["agg"] == "sum"
    assert u.get(f"/api/pages/{secret}").status_code == 404
    assert u.get("/api/pages/999").status_code == 404


def test_list_page_hidden_when_list_table_hidden(zip_table):
    """«Список + карточка»: права проверяются и по таблице списка, даже если карточка пуста."""
    with engine.begin() as c:
        fin = c.execute(text("insert into app_table (title, pg_name, primary_field) values ('Договоры', 'x_fin2', 'name') "
                             "returning id")).scalar()
        cfg = {"title": "Персонал", "filters": [], "rows": [],
               "list": {"table": fin, "filters": [], "sort": [], "columns": ["name"], "header": ["name"]}}
        pid = c.execute(text("insert into app_page (title, config, sort_order) values ('Персонал', :c, 0) returning id")
                        .bindparams(bindparam("c", type_=JSONB)), {"c": cfg}).scalar()
    assert [p["title"] for p in as_user("a", "admin").get("/api/pages").json()] == ["Персонал"]
    assert as_user("u", "user").get(f"/api/pages/{pid}").status_code == 404

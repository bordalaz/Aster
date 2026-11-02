"""Комментарии к записи, как в Airtable: видит и пишет всякий, кому видна таблица; удаляет автор."""
from tests.test_access import as_user, tables  # noqa: F401 — фикстура


def _url(tid, rid=1):
    return f"/api/tables/{tid}/records/{rid}/comments"


def test_user_comments_readonly_table_and_sees_others(tables):
    u = as_user("petr", "user")              # «Оборудование» пользователь не правит, но комментирует
    r = u.post(_url(tables["eq"]), json={"text": "  проверить резьбу  "})
    assert r.status_code == 200
    a = as_user("anna", "admin")
    assert a.post(_url(tables["eq"]), json={"text": "ок"}).status_code == 200
    got = u.get(_url(tables["eq"])).json()
    assert [(c["text"], c["user"], c["mine"]) for c in got] == [("проверить резьбу", "petr", True), ("ок", "anna", False)]


def test_only_author_deletes(tables):
    u = as_user("petr", "user")
    cid = u.post(_url(tables["eq"]), json={"text": "моё"}).json()["id"]
    a = as_user("anna", "admin")
    assert a.delete(f"{_url(tables['eq'])}/{cid}").status_code == 404
    assert u.delete(f"{_url(tables['eq'])}/{cid}").status_code == 200
    assert u.get(_url(tables["eq"])).json() == []


def test_hidden_table_and_bad_input(tables):
    u = as_user("petr", "user")
    assert u.get(_url(tables["fin"])).status_code == 404      # финансы пользователю не видны
    assert u.post(_url(tables["fin"]), json={"text": "x"}).status_code == 404
    assert u.post(_url(tables["eq"]), json={"text": "   "}).status_code == 422
    assert u.post(_url(tables["eq"]), json={"text": "x" * 10001}).status_code == 422
    assert u.post(_url(tables["eq"], 999), json={"text": "x"}).status_code == 404   # нет записи

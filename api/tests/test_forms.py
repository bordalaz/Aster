"""Формы ввода (R12): перенос из Airtable, отправка, права, ключ отправки (E6), история создания."""
import json

from sqlalchemy import text

from app import computed
from app.db import engine
from tests.test_access import as_user


def setup_form(t, fields=None, title="Новое оборудование"):
    from migrate.forms import load_forms
    form = {"view": "viwFORM", "table": "tblBBBBBBBBBBBBBB", "after": "Спасибо!", "fields": fields or [
        {"id": "fldBinv0000000000", "req": True, "lines": ["Инвентарный номер", "Required", "Инвентарный номер", "*"]},
        {"id": "fldBwork000000000", "req": False, "lines": ["В работе", "Required", "В работе"]},
        {"id": "fldBdate000000000", "req": False, "lines": ["Дата", "Required", "Дата", "(когда пришло)", "Date format: dd.mm.yyyy"]},
        {"id": "fldBtags000000000", "req": False, "lines": ["Метки", "Required", "Метки"]},
        {"id": "fldBnom0000000000", "req": False, "lines": ["Номенклатура", "Required", "Номенклатура", "Add"]},
    ]}
    with engine.begin() as c:
        n = load_forms(c, [form], {"viwFORM": title})
        return n, c.execute(text("select id from app_form where airtable_id = 'viwFORM'")).scalar()


def rec_ids(c, tbl):
    pg = c.execute(text("select pg_name from app_table where airtable_id = :a"), {"a": tbl}).scalar()
    return pg, dict(c.execute(text(f"select airtable_id, id from {pg}")).all())


def test_import_and_read_form(loaded_fixture):
    n, fid = setup_form(loaded_fixture)
    assert n == 1 and setup_form(loaded_fixture)[0] == 1   # повторно — обновление
    u = as_user("u", "user")
    assert [f["title"] for f in u.get("/api/forms").json()] == ["Новое оборудование"]
    f = u.get(f"/api/forms/{fid}").json()
    assert f["after_message"] == "Спасибо!"
    by = {x["column_name"]: x for x in f["fields"]}
    assert [x["title"] for x in f["fields"]] == ["Инвентарный номер", "В работе", "Дата", "Метки", "Номенклатура"]
    assert by["f_fldbinv0000000000"]["required"] and not by["f_fldbwork000000000"]["required"]
    assert by["f_fldbdate000000000"]["help"] == "(когда пришло)"
    assert by["f_fldbnom0000000000"]["link_table"] == loaded_fixture["tblAAAAAAAAAAAAAA"]


def test_submit_creates_record_with_links_history_and_is_idempotent(loaded_fixture):
    computed.reset()
    _, fid = setup_form(loaded_fixture)
    with engine.connect() as c:
        _, a = rec_ids(c, "tblAAAAAAAAAAAAAA")
    u = as_user("u", "user")
    body = {"key": "k-123456789", "values": {
        "f_fldbinv0000000000": "МИР 300", "f_fldbwork000000000": True, "f_fldbdate000000000": "2026-11-01",
        "f_fldbtags000000000": ["новое"], "f_fldbnom0000000000": [a["recA2000000000000"]]}}
    r = u.post(f"/api/forms/{fid}/submit", json=body)
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    assert u.post(f"/api/forms/{fid}/submit", json=body).json()["id"] == rid      # двойной клик — одна запись (E6)
    b = loaded_fixture["tblBBBBBBBBBBBBBB"]
    rec = next(x for x in as_user("a", "admin").get(f"/api/tables/{b}/records").json() if x["id"] == rid)
    assert rec["f_fldbinv0000000000"] == "МИР 300" and rec["f_fldbtags000000000"] == ["новое"]
    assert rec["f_fldbnom0000000000"] == [{"id": a["recA2000000000000"], "name": "Втулка"}]
    ra = {x["id"]: x for x in as_user("a2", "admin").get(f"/api/tables/{loaded_fixture['tblAAAAAAAAAAAAAA']}/records").json()}
    assert [x["id"] for x in ra[a["recA2000000000000"]]["f_fldaequip00000000"]][-1] == rid   # обратная сторона — в конец
    hist = u.get(f"/api/tables/{b}/records/{rid}/history").json()
    assert {h["column_name"] for h in hist} >= {"f_fldbinv0000000000", "f_fldbnom0000000000"}
    assert all(h["old"] is None for h in hist)


def test_submit_validation(loaded_fixture):
    _, fid = setup_form(loaded_fixture)
    u = as_user("u", "user")
    post = lambda v, k="k-000000001": u.post(f"/api/forms/{fid}/submit", json={"key": k, "values": v})
    assert post({}).status_code == 422                                                   # обязательное пусто
    assert post({"f_fldbinv0000000000": "x", "f_fldbformula000000": "y"}).status_code == 422   # поле не из формы
    assert post({"f_fldbinv0000000000": "x", "f_fldbnom0000000000": [999999]}).status_code == 422   # нет записи
    assert post({"f_fldbinv0000000000": "x", "f_fldbwork000000000": "да"}).status_code == 422
    assert post({"f_fldbinv0000000000": "x", "f_fldbdate000000000": "не дата"}).status_code == 422


def test_finance_form_only_for_finance_viewers(loaded_fixture):
    _, fid = setup_form(loaded_fixture)
    with engine.begin() as c:
        c.execute(text("update app_table set title = 'Договоры' where airtable_id = 'tblBBBBBBBBBBBBBB'"))
    u = as_user("u", "user")
    assert u.get("/api/forms").json() == []
    assert u.get(f"/api/forms/{fid}").status_code == 404
    assert u.post(f"/api/forms/{fid}/submit", json={"key": "k-000000002", "values": {}}).status_code == 404


def test_record_names_for_link_picker(loaded_fixture):
    u = as_user("u", "user")
    names = u.get(f"/api/tables/{loaded_fixture['tblAAAAAAAAAAAAAA']}/names").json()
    assert sorted(n["name"] for n in names) == ["Втулка", "Кольцо"]

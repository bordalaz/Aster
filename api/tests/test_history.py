"""История изменений записи (spec R11): кто, когда, поле, было → стало."""
from tests.test_access import as_user, tables  # noqa: F401 — фикстура


def _first(c, tid):
    return c.get(f"/api/tables/{tid}/records").json()[0]


def _patch(c, tid, rec, values):
    return c.patch(f"/api/tables/{tid}/records/{rec['id']}", json={"updated_at": rec["updated_at"], "values": values})


def test_patch_writes_history(logged, zip_table):
    rec = _first(logged, zip_table)
    assert _patch(logged, zip_table, rec, {"qty": 9, "name": "Кольцо"}).status_code == 200   # name не изменилось
    h = logged.get(f"/api/tables/{zip_table}/records/{rec['id']}/history").json()
    assert len(h) == 1
    e = h[0]
    assert (e["field"], e["column_name"], e["old"], e["new"], e["user"]) == ("Кол-во", "qty", 5, 9, "Иван")
    assert e["at"]


def test_history_newest_first_and_per_record(logged, zip_table):
    rec = _first(logged, zip_table)
    _patch(logged, zip_table, rec, {"qty": 1})
    rec = _first(logged, zip_table)
    _patch(logged, zip_table, rec, {"qty": 2, "name": None})
    h = logged.get(f"/api/tables/{zip_table}/records/{rec['id']}/history").json()
    assert (h[-1]["column_name"], h[-1]["old"], h[-1]["new"]) == ("qty", 5, 1)   # новые сверху, первая правка — внизу
    assert {(e["column_name"], e["old"], e["new"]) for e in h} == {("qty", 5, 1), ("qty", 1, 2), ("name", "Кольцо", None)}
    other = logged.get(f"/api/tables/{zip_table}/records").json()[1]
    assert logged.get(f"/api/tables/{zip_table}/records/{other['id']}/history").json() == []


def test_failed_patch_writes_nothing(logged, zip_table):
    rec = _first(logged, zip_table)
    _patch(logged, zip_table, {**rec, "updated_at": "2000-01-01T00:00:00Z"}, {"qty": 3})   # 409
    assert logged.get(f"/api/tables/{zip_table}/records/{rec['id']}/history").json() == []


def test_history_dates_serialized(logged, zip_table):
    from sqlalchemy import text
    from app.db import engine
    with engine.begin() as c:
        c.execute(text("alter table zip_test add column due date"))
        c.execute(text("update zip_test set due = '2026-01-02'"))
        c.execute(text("insert into app_field (table_id, column_name, title, kind, editable) values (:t, 'due', 'Срок', 'date', true)"),
                  {"t": zip_table})
    rec = _first(logged, zip_table)
    assert _patch(logged, zip_table, rec, {"due": "2026-03-04"}).status_code == 200
    e = logged.get(f"/api/tables/{zip_table}/records/{rec['id']}/history").json()[0]
    assert (e["old"], e["new"]) == ("2026-01-02", "2026-03-04")


def test_history_respects_table_visibility(tables):
    admin = as_user("a", "admin")
    rec = _first(admin, tables["fin"])
    assert admin.get(f"/api/tables/{tables['fin']}/records/{rec['id']}/history").status_code == 200
    assert as_user("u", "user").get(f"/api/tables/{tables['fin']}/records/{rec['id']}/history").status_code == 404


def test_history_requires_login(client, zip_table):
    assert client.get(f"/api/tables/{zip_table}/records/1/history").status_code == 401


def test_empty_patch_ok_no_history(logged, zip_table):
    rec = _first(logged, zip_table)
    assert _patch(logged, zip_table, rec, {}).status_code == 200
    assert logged.get(f"/api/tables/{zip_table}/records/{rec['id']}/history").json() == []

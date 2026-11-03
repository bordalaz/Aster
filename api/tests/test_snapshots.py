"""Снимки: список и задания — админам, откат — только суперадмину с подтверждением, ручной снимок не чаще раза в час,
одно действие за раз; экземпляр снимка — только чтение."""
import pytest
from sqlalchemy import text

from app import main
from app.db import ops
from tests.test_access import as_user


@pytest.fixture(autouse=True)
def clean():
    with ops.begin() as c:
        c.execute(text("delete from job; delete from snapshot; delete from state"))
    yield


def test_snapshots_rights_queue_and_cooldown():
    u, a, s = as_user("u_s", "user"), as_user("a_s", "admin"), as_user("s_s", "superadmin")
    assert u.get("/api/snapshots").status_code == 403
    with ops.begin() as c:
        sid = c.execute(text("insert into snapshot (kind, file, size, rows) values ('auto', 'bd-x.dump', 1, 1) returning id")).scalar()
    got = a.get("/api/snapshots").json()
    assert [x["id"] for x in got["snapshots"]] == [sid] and got["can_restore"] is False and got["open"] is None
    assert a.post("/api/snapshots").status_code == 200
    assert a.post(f"/api/snapshots/{sid}/open").status_code == 409          # пока идёт снимок — другое не ставится
    with ops.begin() as c:
        c.execute(text("update job set status = 'done'"))
        c.execute(text("insert into snapshot (kind, file) values ('manual', 'bd-y.dump')"))
    assert a.post("/api/snapshots").status_code == 429                      # ручной — не чаще раза в час
    assert a.post("/api/snapshots/999999/open").status_code == 404
    assert a.post(f"/api/snapshots/{sid}/restore", json={"confirm": True}).status_code == 403   # откат — только суперадмин
    assert s.post(f"/api/snapshots/{sid}/restore", json={"confirm": False}).status_code == 422
    assert s.post(f"/api/snapshots/{sid}/restore", json={"confirm": True}).status_code == 200
    with ops.connect() as c:
        assert c.execute(text("select kind, snapshot_id from job where status = 'pending'")).all() == [("restore", sid)]
    assert u.get("/api/snapshot-info").json() == {"snapshot": None}


def test_snapshot_instance_is_read_only(monkeypatch):
    a = as_user("a_ro", "admin")
    monkeypatch.setattr(main, "SNAPSHOT", True)
    assert a.post("/api/snapshots").status_code == 405
    assert a.get("/api/tables").status_code == 200

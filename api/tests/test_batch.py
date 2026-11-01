"""Пакетная правка (вставка из Excel) и склейка фоновых пересчётов."""
import threading
import time

from app import computed
from tests.test_access import as_user, tables  # noqa: F401 — фикстура


def _recs(c, tid):
    return c.get(f"/api/tables/{tid}/records").json()


def _batch(c, tid, items):
    return c.patch(f"/api/tables/{tid}/records", json={"items": items})


def test_batch_updates_all_and_writes_history(logged, zip_table):
    a, b = _recs(logged, zip_table)
    r = _batch(logged, zip_table, [
        {"id": a["id"], "updated_at": a["updated_at"], "values": {"qty": 10}},
        {"id": b["id"], "updated_at": b["updated_at"], "values": {"qty": 20, "name": "Втулка 2"}},
    ])
    assert r.status_code == 200
    assert [x["id"] for x in r.json()] == [a["id"], b["id"]]
    a2, b2 = _recs(logged, zip_table)
    assert (a2["qty"], b2["qty"], b2["name"]) == (10, 20, "Втулка 2")
    assert len(logged.get(f"/api/tables/{zip_table}/records/{b['id']}/history").json()) == 2


def test_batch_all_or_nothing(logged, zip_table):
    a, b = _recs(logged, zip_table)
    r = _batch(logged, zip_table, [
        {"id": a["id"], "updated_at": a["updated_at"], "values": {"qty": 10}},
        {"id": b["id"], "updated_at": "2000-01-01T00:00:00Z", "values": {"qty": 20}},
    ])
    assert r.status_code == 409 and str(b["id"]) in r.json()["detail"]
    assert [x["qty"] for x in _recs(logged, zip_table)] == [5, 7]
    assert logged.get(f"/api/tables/{zip_table}/records/{a['id']}/history").json() == []


def test_batch_checks_fields_and_rights(logged, zip_table, tables):
    a = _recs(logged, zip_table)[0]
    assert _batch(logged, zip_table, [{"id": a["id"], "updated_at": a["updated_at"], "values": {"note": "x"}}]).status_code == 422
    u = as_user("u", "user")
    rec = _recs(u, tables["eq"])[0]
    assert _batch(u, tables["eq"], [{"id": rec["id"], "updated_at": rec["updated_at"], "values": {"name": "y"}}]).status_code == 403


def test_batch_limits(logged, zip_table):
    assert _batch(logged, zip_table, []).status_code == 422
    item = {"id": 1, "updated_at": "2026-01-01T00:00:00Z", "values": {"qty": 1}}
    assert _batch(logged, zip_table, [item] * 1001).status_code == 422


def test_invalidate_coalesces(monkeypatch):
    """Много правок подряд — не по пересчёту на каждую: идущий расчёт + не больше одного следующего."""
    calls, gate = [], threading.Event()

    def slow():
        calls.append(1)
        gate.wait(5)
        return {"n": len(calls)}

    monkeypatch.setattr(computed, "_compute", slow)
    for _ in range(50):
        computed.invalidate()
    time.sleep(0.05)
    gate.set()
    computed.wait()
    assert len(calls) == 2
    assert computed._values == {"n": 2}   # последний расчёт видел все правки

"""Корзина: удалённое не всплывает нигде, восстанавливается целиком со связями; права и срок."""
from sqlalchemy import text

from app import computed
from app.db import engine
from tests.test_access import as_user
from tests.test_links import col, ids

A, B = "tblAAAAAAAAAAAAAA", "tblBBBBBBBBBBBBBB"
NOM = col("fldBnom0000000000")   # Работы → Номенклатура


def setup(t):
    with engine.connect() as c:
        return ids(c, A), ids(c, B)


def rows(u, tid):
    return {r["id"]: r for r in u.get(f"/api/tables/{tid}/records?fresh=1").json()}


def test_delete_hides_everywhere_restore_brings_back(loaded_fixture):
    computed.reset()
    t = loaded_fixture
    a, b = setup(t)
    adm = as_user("adm", "admin")
    ring, job = a["recA1000000000000"], b["recB1000000000000"]
    assert rows(adm, t[B])[job][NOM] == [{"id": ring, "name": "Кольцо"}]

    r = adm.post(f"/api/tables/{t[A]}/records/delete", json={"ids": [ring]})
    assert r.status_code == 200
    trash_id = r.json()["trash"][0]
    computed.wait()
    assert ring not in rows(adm, t[A])                 # в таблице её нет
    assert rows(adm, t[B])[job][NOM] == []              # и в связях других таблиц
    item = adm.get("/api/trash").json()[0]
    assert (item["title"], item["table_id"], item["record_id"], item["deleted_by"]) == ("Кольцо", t[A], ring, "adm")
    card = adm.get(f"/api/trash/{trash_id}").json()
    assert card["title"] == "Кольцо" and card["deleted_by"] == "adm"

    assert adm.post("/api/trash/restore", json={"ids": [trash_id]}).json()["restored"] == [{"table_id": t[A], "record_id": ring}]
    computed.wait()
    assert ring in rows(adm, t[A])                      # тот же id — история и комментарии при ней
    assert rows(adm, t[B])[job][NOM] == [{"id": ring, "name": "Кольцо"}]   # связь вернулась
    assert adm.get("/api/trash").json() == []


def test_link_between_two_deleted_survives_any_restore_order(loaded_fixture):
    computed.reset()
    t = loaded_fixture
    a, b = setup(t)
    adm = as_user("adm", "admin")
    ring, job = a["recA1000000000000"], b["recB1000000000000"]
    ta = adm.post(f"/api/tables/{t[A]}/records/delete", json={"ids": [ring]}).json()["trash"][0]
    tb = adm.post(f"/api/tables/{t[B]}/records/delete", json={"ids": [job]}).json()["trash"][0]
    adm.post("/api/trash/restore", json={"ids": [tb]})   # работа раньше номенклатуры — связь ждёт в корзине у «Кольца»
    computed.wait()
    assert rows(adm, t[B])[job][NOM] == []
    adm.post("/api/trash/restore", json={"ids": [ta]})
    computed.wait()
    assert rows(adm, t[B])[job][NOM] == [{"id": ring, "name": "Кольцо"}]


def test_rights_admins_delete_superadmin_purges(loaded_fixture):
    t = loaded_fixture
    a, _ = setup(t)
    ring = a["recA1000000000000"]
    usr = as_user("usr", "user")
    assert usr.post(f"/api/tables/{t[A]}/records/delete", json={"ids": [ring]}).status_code == 403
    adm = as_user("adm", "admin")
    tid = adm.post(f"/api/tables/{t[A]}/records/delete", json={"ids": [ring]}).json()["trash"][0]
    assert usr.get("/api/trash").status_code == 403
    assert usr.post("/api/trash/restore", json={"ids": [tid]}).status_code == 403
    assert adm.delete(f"/api/trash/{tid}").status_code == 403         # навсегда — только суперадмин
    assert as_user("boss", "superadmin").delete(f"/api/trash/{tid}").status_code == 200
    assert adm.get("/api/trash").json() == []


def test_kept_one_year(loaded_fixture):
    t = loaded_fixture
    a, _ = setup(t)
    adm = as_user("adm", "admin")
    adm.post(f"/api/tables/{t[A]}/records/delete", json={"ids": [a["recA1000000000000"]]})
    with engine.begin() as c:
        c.execute(text("update app_trash set deleted_at = now() - interval '366 days'"))
    assert adm.get("/api/trash").json() == []          # старше года — стёрто


def test_delete_recomputes_linked_only_and_matches_full(loaded_fixture):
    """Удаление не гоняет полный пересчёт (~35 с): только связанные записи, доли секунды —
    и результат тот же, что у полного расчёта; сетка узнаёт, какие строки перечитать."""
    from datetime import datetime, timezone

    from migrate.compute import compute_all
    computed.reset()
    t = loaded_fixture
    a, b = setup(t)
    adm = as_user("adm", "admin")
    computed.values()
    tok = adm.get(f"/api/tables/{t[B]}/records?since=0").json()["token"]
    adm.post(f"/api/tables/{t[A]}/records/delete", json={"ids": [a["recA1000000000000"]]})
    computed.wait()
    assert computed._log[-1][1] is not None                       # не «всё»: пересчёт по записям
    got = adm.get(f"/api/tables/{t[B]}/records?since={tok}").json()
    assert got["full"] is False and b["recB1000000000000"] in [r["id"] for r in got["rows"]]   # связанная работа
    with engine.connect() as c:
        full = compute_all(c, datetime.now(timezone.utc).date())
    live = computed.values()
    for f, vals in full.items():
        assert {k: v for k, v in live.get(f, {}).items() if k != "recA1000000000000"} == vals, f

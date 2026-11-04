"""Связи (spec R11): ссылки отдаются названиями связанных записей, с переходом; скрытые таблицы — пусто."""
from sqlalchemy import text

from app import computed
from app.db import engine
from tests.test_access import as_user


def ids(c, tbl):
    pg = c.execute(text("select pg_name from app_table where airtable_id = :a"), {"a": tbl}).scalar()
    return dict(c.execute(text(f"select airtable_id, id from {pg}")).all())


def col(tbl_fld):
    return "f_" + tbl_fld.lower()


def test_links_as_names(loaded_fixture):
    computed.reset()
    t = loaded_fixture
    with engine.connect() as c:
        a, b, cc = ids(c, "tblAAAAAAAAAAAAAA"), ids(c, "tblBBBBBBBBBBBBBB"), ids(c, "tblCCCCCCCCCCCCCC")
    u = as_user("adm", "admin")
    rows = {r["id"]: r for r in u.get(f"/api/tables/{t['tblBBBBBBBBBBBBBB']}/records").json()}
    r1 = rows[b["recB1000000000000"]]
    # битая ссылка recZZZ… при загрузке не попала — остаётся одна
    assert r1[col("fldBnom0000000000")] == [{"id": a["recA1000000000000"], "name": "Кольцо"}]
    assert r1[col("fldBtrips00000000")] == [{"id": cc["recC1000000000000"], "name": "1"}]
    assert rows[b["recB2000000000000"]][col("fldBtrips00000000")] == []
    # обратная сторона пары
    ra = {r["id"]: r for r in u.get(f"/api/tables/{t['tblAAAAAAAAAAAAAA']}/records").json()}
    assert ra[a["recA2000000000000"]][col("fldAequip00000000")] == [{"id": b["recB2000000000000"], "name": "МИР 296"}]

    f = {x["column_name"]: x for x in u.get(f"/api/tables/{t['tblBBBBBBBBBBBBBB']}/fields").json()}
    assert f[col("fldBnom0000000000")]["link_table"] == t["tblAAAAAAAAAAAAAA"]
    assert f[col("fldBinv0000000000")].get("link_table") is None


def test_links_to_hidden_table_are_hidden(loaded_fixture):
    computed.reset()
    t = loaded_fixture
    with engine.begin() as c:   # Номенклатура становится финансовой — пользователю не видна
        c.execute(text("update app_table set title = 'Договоры' where airtable_id = 'tblAAAAAAAAAAAAAA'"))
    u = as_user("usr", "user")
    rows = u.get(f"/api/tables/{t['tblBBBBBBBBBBBBBB']}/records").json()
    assert all(col("fldBnom0000000000") not in r for r in rows)          # поле целиком скрыто
    assert all(r[col("fldBtrips00000000")] is not None for r in rows)
    f = {x["column_name"]: x for x in u.get(f"/api/tables/{t['tblBBBBBBBBBBBBBB']}/fields").json()}
    assert col("fldBnom0000000000") not in f


def test_edit_links(loaded_fixture):
    """Правка связи из сетки/карточки: список id целиком; обе стороны пары, история, порядок."""
    computed.reset()
    t = loaded_fixture
    with engine.connect() as c:
        a, b, cc = ids(c, "tblAAAAAAAAAAAAAA"), ids(c, "tblBBBBBBBBBBBBBB"), ids(c, "tblCCCCCCCCCCCCCC")
    u = as_user("adm", "admin")
    tb, trips = t["tblBBBBBBBBBBBBBB"], col("fldBtrips00000000")
    f = {x["column_name"]: x for x in u.get(f"/api/tables/{tb}/fields").json()}
    assert f[trips]["editable"] is True
    rows = {r["id"]: r for r in u.get(f"/api/tables/{tb}/records").json()}
    b2 = rows[b["recB2000000000000"]]
    r = u.patch(f"/api/tables/{tb}/records/{b2['id']}", json={"updated_at": b2["updated_at"], "values": {trips: [cc["recC1000000000000"]]}})
    assert r.status_code == 200, r.text
    rows = {x["id"]: x for x in u.get(f"/api/tables/{tb}/records").json()}
    assert rows[b2["id"]][trips] == [{"id": cc["recC1000000000000"], "name": "1"}]
    hist = u.get(f"/api/tables/{tb}/records/{b2['id']}/history").json()
    assert hist[0]["column_name"] == trips and hist[0]["old"] == [] and hist[0]["new"][0]["name"] == "1"
    # убрать связь
    r = u.patch(f"/api/tables/{tb}/records/{b2['id']}", json={"updated_at": r.json()["updated_at"], "values": {trips: []}})
    assert r.status_code == 200
    assert {x["id"]: x for x in u.get(f"/api/tables/{tb}/records").json()}[b2["id"]][trips] == []
    # чужие id и не-числа — отказ
    upd = r.json()["updated_at"]
    assert u.patch(f"/api/tables/{tb}/records/{b2['id']}", json={"updated_at": upd, "values": {trips: [999999]}}).status_code == 422
    assert u.patch(f"/api/tables/{tb}/records/{b2['id']}", json={"updated_at": upd, "values": {trips: ["x"]}}).status_code == 422
    # пользователь без права правки — 403
    assert as_user("ro", "user").patch(f"/api/tables/{tb}/records/{b2['id']}",
                                        json={"updated_at": upd, "values": {trips: []}}).status_code == 403

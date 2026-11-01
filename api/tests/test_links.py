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


def test_links_to_hidden_table_are_empty(loaded_fixture):
    computed.reset()
    t = loaded_fixture
    with engine.begin() as c:   # Номенклатура становится финансовой — пользователю не видна
        c.execute(text("update app_table set title = 'Договоры' where airtable_id = 'tblAAAAAAAAAAAAAA'"))
    u = as_user("usr", "user")
    rows = u.get(f"/api/tables/{t['tblBBBBBBBBBBBBBB']}/records").json()
    assert all(r[col("fldBnom0000000000")] is None for r in rows)
    assert all(r[col("fldBtrips00000000")] is not None for r in rows)
    f = {x["column_name"]: x for x in u.get(f"/api/tables/{t['tblBBBBBBBBBBBBBB']}/fields").json()}
    assert f[col("fldBnom0000000000")]["link_table"] is None

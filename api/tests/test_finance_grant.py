"""Финансы: видят админы и те, кому суперадмин выдал доступ (только просмотр).
Поля, чьи данные идут из финансовых таблиц (ссылки, rollup/lookup и формулы по цепочке), остальным не видны."""
import json

from sqlalchemy import text

from app import computed
from app.db import engine
from tests.test_access import as_user, make_user, tables  # noqa: F401 — фикстура


def grant(actor, login, on=True):
    with engine.connect() as c:
        uid = c.execute(text("select id from app_user where login = :l"), {"l": login}).scalar()
    return actor.patch(f"/api/users/{uid}", json={"finance_access": on})


def test_grant_gives_read_only_finance(tables):
    u = as_user("u", "user")
    assert u.get(f"/api/tables/{tables['fin']}/records").status_code == 404
    assert grant(as_user("a", "admin"), "u").status_code == 403          # выдаёт только суперадмин
    s = as_user("s", "superadmin")
    assert grant(s, "u").status_code == 200
    assert tables["fin"] in {t["id"] for t in u.get("/api/tables").json()}
    rec = u.get(f"/api/tables/{tables['fin']}/records").json()[0]
    r = u.patch(f"/api/tables/{tables['fin']}/records/{rec['id']}", json={"updated_at": rec["updated_at"], "values": {"name": "y"}})
    assert r.status_code == 403                                           # только просмотр
    assert next(x for x in s.get("/api/users").json() if x["login"] == "u")["finance_access"] is True
    assert grant(s, "u", False).status_code == 200
    assert u.get(f"/api/tables/{tables['fin']}/records").status_code == 404


def test_superadmin_target_untouchable():
    sid = make_user("boss", "superadmin")
    s = as_user("s2", "admin")
    assert s.patch(f"/api/users/{sid}", json={"finance_access": True}).status_code == 403


def test_finance_derived_fields_hidden(loaded_fixture):
    computed.reset()
    t = loaded_fixture
    b = t["tblBBBBBBBBBBBBBB"]
    with engine.begin() as c:   # Номенклатура — финансовая; формула-цепочка поверх rollup из неё
        c.execute(text("update app_table set title = 'Договоры' where airtable_id = 'tblAAAAAAAAAAAAAA'"))
        c.execute(text(
            "insert into app_field (table_id, column_name, title, kind, editable, sort_order, options, airtable_id) "
            "values (:t, 'f_fldbchain00000000', 'Цепочка', 'formula', false, 99, cast(:o as jsonb), 'fldBchain00000000')"),
            {"t": b, "o": json.dumps({"virtual": True, "formula": "{fldBrollup0000000} * 2",
                                    "referencedFieldIds": ["fldBrollup0000000"], "result": {"type": "number"}})})
    hidden = {"f_fldbnom0000000000", "f_fldbrollup0000000", "f_fldbchain00000000"}

    u = as_user("u", "user")
    cols = {f["column_name"] for f in u.get(f"/api/tables/{b}/fields").json()}
    assert not cols & hidden and "f_fldbformula000000" in cols and "f_fldbtrips00000000" in cols
    assert not set(u.get(f"/api/tables/{b}/records").json()[0]) & hidden

    grant(as_user("s", "superadmin"), "u")
    cols = {f["column_name"] for f in u.get(f"/api/tables/{b}/fields").json()}
    assert hidden <= cols
    assert as_user("a", "admin").get(f"/api/tables/{b}/fields").json()   # админ видит всё и так


def test_primary_field_never_hidden(loaded_fixture):
    """Первичное поле держит всю таблицу (названия записей, ссылки) — не скрывается, даже если формула
    смотрит на финансы (в базе: ID_Рейса_APS добавляет «-АРЕНДА» по ссылке на подрядчика)."""
    b = loaded_fixture["tblBBBBBBBBBBBBBB"]
    with engine.begin() as c:
        c.execute(text("update app_table set title = 'Договоры' where airtable_id = 'tblAAAAAAAAAAAAAA'"))
        c.execute(text("update app_field set options = options || cast(:o as jsonb) where airtable_id = 'fldBinv0000000000'"),
                  {"o": json.dumps({"referencedFieldIds": ["fldBnom0000000000"]})})
    cols = {f["column_name"] for f in as_user("u", "user").get(f"/api/tables/{b}/fields").json()}
    assert "f_fldbinv0000000000" in cols and "f_fldbnom0000000000" not in cols

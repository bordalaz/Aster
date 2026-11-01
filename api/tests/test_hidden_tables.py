"""Скрытые таблицы (как «N hidden tables» в Airtable): общий для базы признак, меняют админы."""
from sqlalchemy import text

from app.db import engine
from tests.test_access import as_user


def test_hidden_flag_listed_and_toggled_by_admin(logged, zip_table):
    t = logged.get("/api/tables").json()[0]
    assert t["hidden"] is False
    assert logged.patch(f"/api/tables/{zip_table}", json={"hidden": True}).status_code == 200
    assert logged.get("/api/tables").json()[0]["hidden"] is True


def test_user_cannot_hide(zip_table):
    u = as_user("petya", "user")
    assert u.patch(f"/api/tables/{zip_table}", json={"hidden": True}).status_code == 403


def test_migrate_marks_hidden_from_airtable_switcher(zip_table):
    from migrate.tables import apply_hidden
    with engine.begin() as c:
        c.execute(text("update app_table set airtable_id = 'tblZIP' where id = :t"), {"t": zip_table})
        n = apply_hidden(c, {"tableSchemas": [{"id": "tblZIP", "isHiddenFromSwitcher": True}, {"id": "tblNone", "isHiddenFromSwitcher": True}]})
        assert n == 1
        assert c.execute(text("select hidden from app_table where id = :t"), {"t": zip_table}).scalar() is True

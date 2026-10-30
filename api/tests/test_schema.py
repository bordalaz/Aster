import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from app.db import engine


def test_core_tables_exist():
    names = set(inspect(engine).get_table_names())
    assert {"app_user", "app_session", "app_table", "app_field", "app_view"} <= names


def test_role_is_checked():
    with pytest.raises(IntegrityError):
        with engine.begin() as c:
            c.execute(text("insert into app_user (login, name, password_hash, role) values ('x', 'X', 'h', 'boss')"))

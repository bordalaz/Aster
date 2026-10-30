import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

# Тесты — в отдельной базе <имя>_test, пересоздаётся при каждом запуске
url = make_url(os.environ["DATABASE_URL"])
test_url = url.set(database=url.database + "_test")
os.environ["DATABASE_URL"] = test_url.render_as_string(hide_password=False)

_admin = create_engine(url, isolation_level="AUTOCOMMIT")
with _admin.connect() as c:
    c.execute(text(f'drop database if exists "{test_url.database}" with (force)'))
    c.execute(text(f'create database "{test_url.database}"'))
_admin.dispose()

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402

command.upgrade(Config("alembic.ini"), "head")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture
def client():
    return TestClient(app)

from app.db import engine  # noqa: E402


@pytest.fixture(autouse=True)
def clean():
    yield
    with engine.begin() as c:
        c.execute(text("truncate app_user, app_session, app_table, app_field, app_view restart identity cascade"))
        c.execute(text("drop table if exists zip_test"))


@pytest.fixture
def user():
    from app.auth import hash_password

    with engine.begin() as c:
        c.execute(
            text("insert into app_user (login, name, password_hash) values ('ivan', 'Иван', :h)"),
            {"h": hash_password("secret")},
        )


@pytest.fixture
def logged(client, user):
    r = client.post("/api/auth/login", json={"login": "ivan", "password": "secret"})
    assert r.status_code == 200
    return client

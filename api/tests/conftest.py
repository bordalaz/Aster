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


@pytest.fixture
def zip_table():
    """Мини-«Ведомость ЗИП»: таблица данных + её метаданные. Возвращает id из app_table."""
    with engine.begin() as c:
        c.execute(text(
            "create table zip_test (id serial primary key, name text, qty int, note text, "
            "created_at timestamptz not null default now(), created_by int, "
            "updated_at timestamptz not null default now(), updated_by int)"
        ))
        c.execute(text("insert into zip_test (name, qty, note) values ('Кольцо', 5, 'a'), ('Втулка', 7, 'b')"))
        tid = c.execute(text(
            "insert into app_table (pg_name, title, primary_field) "
            "values ('zip_test', 'Ведомость ЗИП', 'name') returning id"
        )).scalar()
        c.execute(text(
            "insert into app_field (table_id, column_name, title, kind, editable, sort_order) values "
            "(:t, 'name', 'Наименование', 'text', true, 1), "
            "(:t, 'qty', 'Кол-во', 'number', true, 2), "
            "(:t, 'note', 'Примечание', 'text', false, 3)"
        ), {"t": tid})
    return tid

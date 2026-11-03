import json
import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

# Тесты — в отдельной базе <имя>_test, пересоздаётся при каждом запуске
url = make_url(os.environ["DATABASE_URL"])
test_url = url.set(database=url.database + "_test")
os.environ["DATABASE_URL"] = test_url.render_as_string(hide_password=False)

# служебная база снимков — своя тестовая (как её создаёт ops/backup.sh)
ops_url = url.set(database=url.database + "_test_ops")
os.environ["OPS_DATABASE_URL"] = ops_url.render_as_string(hide_password=False)

_admin = create_engine(url, isolation_level="AUTOCOMMIT")
with _admin.connect() as c:
    for db in (test_url.database, ops_url.database):
        c.execute(text(f'drop database if exists "{db}" with (force)'))
        c.execute(text(f'create database "{db}"'))
_admin.dispose()
_ops = create_engine(ops_url)
with _ops.begin() as c:
    c.execute(text("create table snapshot (id serial primary key, created_at timestamptz not null default now(), kind text not null, "
                   "file text not null unique, size bigint, rows bigint, by_user text)"))
    c.execute(text("create table job (id serial primary key, kind text not null, snapshot_id int, by_user text, status text not null "
                   "default 'pending', message text not null default '', created_at timestamptz not null default now(), done_at timestamptz)"))
    c.execute(text("create table state (key text primary key, value text not null)"))
_ops.dispose()

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402

command.upgrade(Config("alembic.ini"), "head")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture
def client():
    return TestClient(app, client=("127.0.0.1", 50000))   # офисная сеть (R7)

from app.db import engine  # noqa: E402


@pytest.fixture(autouse=True)
def clean():
    yield
    from app import computed
    computed.reset()   # кеш вычисляемых — на процесс; между тестами данные другие
    from app import auth
    auth.reset_login_limits()
    with engine.begin() as c:
        c.execute(text("truncate app_user, app_session, app_table, app_field, app_view, app_page restart identity cascade"))
        c.execute(text("drop table if exists zip_test"))
        c.execute(text("truncate attachment, at_computed, at_link_meta"))
        names = c.execute(text(
            "select tablename from pg_tables where schemaname = 'public' "
            "and (tablename like :a or tablename like :l)"
        ), {"a": r"at\_tbl%", "l": r"l\_fld%"}).scalars().all()
        for t in names:
            c.execute(text(f'drop table if exists "{t}" cascade'))


@pytest.fixture
def user():
    from app.auth import hash_password

    with engine.begin() as c:
        c.execute(
            text("insert into app_user (login, name, role, password_hash) values ('ivan', 'Иван', 'admin', :h)"),
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


FIXTURE = Path(__file__).parent / "fixtures" / "airtable"


@pytest.fixture
def loaded_fixture():
    """Фикстура снимка Airtable, загруженная в БД. Возвращает {tbl_id: app_table.id}."""
    from migrate.load import load_snapshot
    from migrate.schema import apply_schema

    with engine.begin() as c:
        apply_schema(c, json.loads((FIXTURE / "schema.json").read_text(encoding="utf-8")))
        load_snapshot(c, FIXTURE)
        return dict(c.execute(text("select airtable_id, id from app_table")).all())

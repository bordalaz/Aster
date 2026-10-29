# Этап 1а: backend-каркас — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Docker Compose с PostgreSQL и FastAPI: вход по логину/паролю, метаданные таблиц, чтение всех записей таблицы и правка записи с защитой от параллельной правки.

**Architecture:** Один FastAPI-процесс, SQLAlchemy Core (без ORM-моделей на каждую таблицу). Таблицы данных — настоящие таблицы PostgreSQL. API находит их через `app_table.pg_name` и читает структуру отражением (`autoload_with`). Какие колонки показывать и править, задаёт `app_field`. Схема служебных таблиц — миграции Alembic на чистом SQL.

**Tech Stack:** Python 3.12 (в контейнере), FastAPI 0.115, SQLAlchemy 2.0, psycopg 3, Alembic 1.14, pytest, PostgreSQL 16.

**Спецификация:** `docs/2026-10-23-app-design.md` (§4, §5, §8, §11 этап 1).

---

## Контекст для исполнителя

- Разработка на Windows, но **Python и тесты запускаются только в контейнере**: локальный Python 3.14 не нужен, у части библиотек нет под него готовых сборок.
- Все команды выполняются из корня репозитория `C:\Soft\Telegram\BD`.
- Тесты работают с настоящим PostgreSQL из compose, в отдельной базе `bd_test`, которую `conftest.py` пересоздаёт при каждом запуске.
- Тексты ошибок для пользователя пишутся по-русски.

## Предусловие (делает пользователь)

- [ ] Установить Docker Desktop for Windows (WSL 2) с docker.com и перезагрузить ПК.
- [ ] Проверить: `docker --version` и `docker compose version` выводят версии.

## Структура файлов

| Файл | Ответственность |
|---|---|
| `docker-compose.yml` | сервисы `db`, `api` |
| `.env.example` | образец переменных (копируется в `.env`, который в git не попадает) |
| `api/Dockerfile` | образ backend |
| `api/requirements.txt` | зависимости с точными версиями |
| `api/alembic.ini`, `api/migrations/env.py`, `api/migrations/script.py.mako` | Alembic |
| `api/migrations/versions/0001_core.py` | служебные таблицы |
| `api/app/db.py` | `engine` |
| `api/app/main.py` | приложение, `/api/health`, подключение роутеров |
| `api/app/auth.py` | хеш пароля, вход/выход, `current_user` |
| `api/app/cli.py` | создание пользователя из консоли |
| `api/app/meta.py` | `/api/tables`, `/api/tables/{id}/fields` |
| `api/app/records.py` | `/api/tables/{id}/records` (чтение, правка) |
| `api/tests/conftest.py` | тестовая база, фикстуры |
| `api/tests/test_*.py` | тесты по модулям |

---

### Task 1: Compose, контейнер API, health

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `api/Dockerfile`, `api/requirements.txt`, `api/alembic.ini`, `api/migrations/env.py`, `api/migrations/script.py.mako`, `api/migrations/versions/.gitkeep`, `api/app/__init__.py`, `api/app/db.py`, `api/app/main.py`, `api/tests/conftest.py`, `api/tests/test_health.py`
- Modify: `.gitignore`

- [ ] **Step 1: Инфраструктура**

`docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: bd
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: bd
    command: postgres -c shared_buffers=256MB
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "bd"]
      interval: 2s
      retries: 30
  api:
    build: ./api
    environment:
      DATABASE_URL: postgresql+psycopg://bd:${POSTGRES_PASSWORD}@db/bd
      COOKIE_SECURE: ${COOKIE_SECURE:-0}
    depends_on:
      db: { condition: service_healthy }
    # ponytail: код монтируется для разработки; для NAS — отдельный compose в этапе 3
    volumes: [./api:/app]
    ports: ["8000:8000"]
volumes:
  pgdata: {}
```

`.env.example`:
```
POSTGRES_PASSWORD=change-me
COOKIE_SECURE=0
```

Добавить в `.gitignore` строки:
```
.env
__pycache__/
proto/grid/node_modules/
```

`api/requirements.txt`:
```
fastapi==0.115.6
uvicorn==0.34.0
SQLAlchemy==2.0.36
psycopg[binary]==3.2.3
alembic==1.14.0
pytest==8.3.4
httpx==0.28.1
```

`api/Dockerfile`:
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
```

`api/alembic.ini`:
```ini
[alembic]
script_location = migrations
```

`api/migrations/env.py`:
```python
import os

from alembic import context
from sqlalchemy import create_engine

engine = create_engine(os.environ["DATABASE_URL"])
with engine.connect() as connection:
    context.configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()
```

`api/migrations/script.py.mako`:
```mako
"""${message}"""
from alembic import op

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}


def upgrade():
    ${upgrades if upgrades else "pass"}


def downgrade():
    ${downgrades if downgrades else "pass"}
```

`api/migrations/versions/.gitkeep` — пустой файл. `api/app/__init__.py` — пустой файл.

`api/app/db.py`:
```python
import os

from sqlalchemy import create_engine

engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
```

- [ ] **Step 2: Тестовая обвязка и падающий тест**

`api/tests/conftest.py`:
```python
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
```

`api/tests/test_health.py`:
```python
def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
```

- [ ] **Step 3: Запустить — тест падает**

```bash
copy .env.example .env
docker compose build api
docker compose run --rm api pytest -q
```
Ожидается: ошибка импорта `app.main` (файла ещё нет).

- [ ] **Step 4: Реализация**

`api/app/main.py`:
```python
from fastapi import FastAPI
from sqlalchemy import text

from .db import engine

app = FastAPI(title="БД гидроканал")


@app.get("/api/health")
def health():
    with engine.connect() as c:
        c.execute(text("select 1"))
    return {"ok": True}
```

- [ ] **Step 5: Тест проходит**

Run: `docker compose run --rm api pytest -q`
Ожидается: `1 passed`.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .env.example .gitignore api
git commit -m "feat(api): compose, FastAPI skeleton, health endpoint"
```

---

### Task 2: Служебные таблицы (миграция 0001)

**Files:**
- Create: `api/migrations/versions/0001_core.py`, `api/tests/test_schema.py`

- [ ] **Step 1: Падающий тест**

`api/tests/test_schema.py`:
```python
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
```

- [ ] **Step 2: Запустить — падает**

Run: `docker compose run --rm api pytest -q tests/test_schema.py`
Ожидается: FAIL — таблиц нет.

- [ ] **Step 3: Миграция**

`api/migrations/versions/0001_core.py`:
```python
"""core tables: users, sessions, metadata"""
from alembic import op

revision = "0001"
down_revision = None

STATEMENTS = [
    """create table app_user (
        id serial primary key,
        login text unique not null,
        name text not null,
        password_hash text not null,
        role text not null default 'editor' check (role in ('admin', 'editor', 'reader')),
        created_at timestamptz not null default now()
    )""",
    """create table app_session (
        token text primary key,
        user_id int not null references app_user on delete cascade,
        expires_at timestamptz not null
    )""",
    """create table app_table (
        id serial primary key,
        pg_name text unique not null,
        title text not null,
        primary_field text not null,
        sort_order int not null default 0,
        airtable_id text unique
    )""",
    """create table app_field (
        id serial primary key,
        table_id int not null references app_table on delete cascade,
        column_name text not null,
        title text not null,
        kind text not null,
        editable boolean not null default true,
        sort_order int not null default 0,
        options jsonb not null default '{}',
        airtable_id text,
        unique (table_id, column_name)
    )""",
    """create table app_view (
        id serial primary key,
        table_id int not null references app_table on delete cascade,
        title text not null,
        kind text not null default 'grid',
        owner_id int references app_user on delete cascade,
        config jsonb not null default '{}',
        sort_order int not null default 0,
        airtable_id text unique
    )""",
]


def upgrade():
    for s in STATEMENTS:
        op.execute(s)


def downgrade():
    for t in ("app_view", "app_field", "app_table", "app_session", "app_user"):
        op.execute(f"drop table {t}")
```

- [ ] **Step 4: Тесты проходят**

Run: `docker compose run --rm api pytest -q`
Ожидается: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add api/migrations/versions/0001_core.py api/tests/test_schema.py
git commit -m "feat(api): core tables migration"
```

---

### Task 3: Вход, выход, текущий пользователь

**Files:**
- Create: `api/app/auth.py`, `api/tests/test_auth.py`
- Modify: `api/app/main.py`, `api/tests/conftest.py`

- [ ] **Step 1: Фикстуры очистки и пользователя**

Дописать в конец `api/tests/conftest.py`:
```python
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
```

- [ ] **Step 2: Падающие тесты**

`api/tests/test_auth.py`:
```python
from app.auth import check_password, hash_password


def test_hash_roundtrip():
    h = hash_password("пароль")
    assert check_password("пароль", h)
    assert not check_password("другой", h)
    assert hash_password("пароль") != h  # соль случайная


def test_login_wrong_password(client, user):
    r = client.post("/api/auth/login", json={"login": "ivan", "password": "nope"})
    assert r.status_code == 401


def test_login_unknown_user(client):
    r = client.post("/api/auth/login", json={"login": "nobody", "password": "x"})
    assert r.status_code == 401


def test_me_requires_login(client):
    assert client.get("/api/auth/me").status_code == 401


def test_login_me_logout(logged):
    r = logged.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["login"] == "ivan"
    assert r.json()["role"] == "editor"
    assert "password_hash" not in r.json()
    assert logged.post("/api/auth/logout").status_code == 200
    assert logged.get("/api/auth/me").status_code == 401
```

- [ ] **Step 3: Запустить — падает**

Run: `docker compose run --rm api pytest -q tests/test_auth.py`
Ожидается: ошибка импорта `app.auth`.

- [ ] **Step 4: Реализация**

`api/app/auth.py`:
```python
import hashlib
import hmac
import os
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import text

from .db import engine

COOKIE = "session"
SESSION_DAYS = 30
_SCRYPT = dict(n=2**14, r=8, p=1)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    return salt.hex() + ":" + hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT).hex()


def check_password(password: str, stored: str) -> bool:
    salt, digest = stored.split(":")
    actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), **_SCRYPT).hex()
    return hmac.compare_digest(actual, digest)


def current_user(request: Request) -> dict:
    token = request.cookies.get(COOKIE)
    if token:
        with engine.connect() as c:
            u = c.execute(
                text(
                    "select u.id, u.login, u.name, u.role from app_session s "
                    "join app_user u on u.id = s.user_id "
                    "where s.token = :t and s.expires_at > now()"
                ),
                {"t": token},
            ).first()
        if u:
            return u._asdict()
    raise HTTPException(401, "Нужен вход")


router = APIRouter(prefix="/api/auth")


class LoginBody(BaseModel):
    login: str
    password: str


# ponytail: без ограничения попыток входа — внутренняя сеть, ~50 человек; добавить, если откроем доступ снаружи (В1)
@router.post("/login")
def login(body: LoginBody, response: Response):
    with engine.begin() as c:
        u = c.execute(
            text("select id, password_hash from app_user where login = :l"), {"l": body.login}
        ).first()
        if not u or not check_password(body.password, u.password_hash):
            raise HTTPException(401, "Неверный логин или пароль")
        token = secrets.token_urlsafe(32)
        c.execute(text("delete from app_session where expires_at < now()"))
        c.execute(
            text("insert into app_session values (:t, :u, now() + make_interval(days => :d))"),
            {"t": token, "u": u.id, "d": SESSION_DAYS},
        )
    response.set_cookie(
        COOKIE, token, httponly=True, samesite="lax",
        secure=os.environ.get("COOKIE_SECURE") == "1", max_age=SESSION_DAYS * 86400,
    )
    return {"ok": True}


@router.post("/logout")
def logout(request: Request, response: Response):
    with engine.begin() as c:
        c.execute(text("delete from app_session where token = :t"), {"t": request.cookies.get(COOKIE)})
    response.delete_cookie(COOKIE)
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return user
```

В `api/app/main.py` подключить роутер — итоговый файл:
```python
from fastapi import FastAPI
from sqlalchemy import text

from . import auth
from .db import engine

app = FastAPI(title="БД гидроканал")
app.include_router(auth.router)


@app.get("/api/health")
def health():
    with engine.connect() as c:
        c.execute(text("select 1"))
    return {"ok": True}
```

- [ ] **Step 5: Тесты проходят**

Run: `docker compose run --rm api pytest -q`
Ожидается: `8 passed`.

- [ ] **Step 6: Commit**

```bash
git add api/app/auth.py api/app/main.py api/tests/conftest.py api/tests/test_auth.py
git commit -m "feat(api): login, logout, session cookie"
```

---

### Task 4: Создание пользователя из консоли

**Files:**
- Create: `api/app/cli.py`, `api/tests/test_cli.py`

- [ ] **Step 1: Падающий тест**

`api/tests/test_cli.py`:
```python
def test_created_user_can_log_in(client):
    from app.cli import create_user

    create_user("petr", "Пётр", "admin", "pw123")
    r = client.post("/api/auth/login", json={"login": "petr", "password": "pw123"})
    assert r.status_code == 200
    assert client.get("/api/auth/me").json()["role"] == "admin"
```

- [ ] **Step 2: Запустить — падает**

Run: `docker compose run --rm api pytest -q tests/test_cli.py`
Ожидается: ошибка импорта `app.cli`.

- [ ] **Step 3: Реализация**

`api/app/cli.py`:
```python
"""python -m app.cli create-user <login> <ФИО> <admin|editor|reader>"""
import getpass
import sys

from sqlalchemy import text

from .auth import hash_password
from .db import engine


def create_user(login: str, name: str, role: str, password: str) -> None:
    with engine.begin() as c:
        c.execute(
            text("insert into app_user (login, name, role, password_hash) values (:l, :n, :r, :h)"),
            {"l": login, "n": name, "r": role, "h": hash_password(password)},
        )


if __name__ == "__main__":
    if len(sys.argv) != 5 or sys.argv[1] != "create-user":
        sys.exit(__doc__)
    create_user(*sys.argv[2:5], getpass.getpass("Пароль: "))
```

- [ ] **Step 4: Тесты проходят**

Run: `docker compose run --rm api pytest -q`
Ожидается: `9 passed`.

- [ ] **Step 5: Commit**

```bash
git add api/app/cli.py api/tests/test_cli.py
git commit -m "feat(api): create-user CLI"
```

---

### Task 5: API метаданных

**Files:**
- Create: `api/app/meta.py`, `api/tests/test_meta.py`
- Modify: `api/app/main.py`, `api/tests/conftest.py`

- [ ] **Step 1: Фикстура тестовой таблицы данных**

Дописать в конец `api/tests/conftest.py`:
```python
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
```

- [ ] **Step 2: Падающие тесты**

`api/tests/test_meta.py`:
```python
def test_tables_require_login(client):
    assert client.get("/api/tables").status_code == 401


def test_tables(logged, zip_table):
    r = logged.get("/api/tables")
    assert r.status_code == 200
    assert r.json() == [{"id": zip_table, "title": "Ведомость ЗИП", "primary_field": "name"}]


def test_fields_in_order(logged, zip_table):
    r = logged.get(f"/api/tables/{zip_table}/fields")
    assert r.status_code == 200
    assert [f["column_name"] for f in r.json()] == ["name", "qty", "note"]
    assert r.json()[2]["editable"] is False


def test_fields_unknown_table(logged):
    assert logged.get("/api/tables/999/fields").status_code == 404
```

- [ ] **Step 3: Запустить — падает**

Run: `docker compose run --rm api pytest -q tests/test_meta.py`
Ожидается: FAIL — 404 на `/api/tables`.

- [ ] **Step 4: Реализация**

`api/app/meta.py`:
```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from .auth import current_user
from .db import engine

router = APIRouter(prefix="/api", dependencies=[Depends(current_user)])


@router.get("/tables")
def tables():
    with engine.connect() as c:
        rows = c.execute(text("select id, title, primary_field from app_table order by sort_order, id"))
        return [r._asdict() for r in rows]


@router.get("/tables/{table_id}/fields")
def fields(table_id: int):
    with engine.connect() as c:
        if not c.execute(text("select 1 from app_table where id = :t"), {"t": table_id}).first():
            raise HTTPException(404, "Нет такой таблицы")
        rows = c.execute(
            text(
                "select id, column_name, title, kind, editable, options from app_field "
                "where table_id = :t order by sort_order, id"
            ),
            {"t": table_id},
        )
        return [r._asdict() for r in rows]
```

В `api/app/main.py` заменить строку импорта и добавить подключение:
```python
from . import auth, meta
```
```python
app.include_router(auth.router)
app.include_router(meta.router)
```

- [ ] **Step 5: Тесты проходят**

Run: `docker compose run --rm api pytest -q`
Ожидается: `13 passed`.

- [ ] **Step 6: Commit**

```bash
git add api/app/meta.py api/app/main.py api/tests/conftest.py api/tests/test_meta.py
git commit -m "feat(api): tables and fields metadata endpoints"
```

---

### Task 6: Чтение записей таблицы

**Files:**
- Create: `api/app/records.py`, `api/tests/test_records.py`
- Modify: `api/app/main.py`

- [ ] **Step 1: Падающие тесты**

`api/tests/test_records.py`:
```python
def test_list_records(logged, zip_table):
    r = logged.get(f"/api/tables/{zip_table}/records")
    assert r.status_code == 200
    rows = r.json()
    assert [x["name"] for x in rows] == ["Кольцо", "Втулка"]
    assert set(rows[0]) == {"id", "updated_at", "name", "qty", "note"}  # created_by и пр. не отдаём


def test_list_requires_login(client, zip_table):
    assert client.get(f"/api/tables/{zip_table}/records").status_code == 401


def test_list_unknown_table(logged):
    assert logged.get("/api/tables/999/records").status_code == 404
```

- [ ] **Step 2: Запустить — падает**

Run: `docker compose run --rm api pytest -q tests/test_records.py`
Ожидается: FAIL — 404 на `/records` в первом тесте.

- [ ] **Step 3: Реализация**

`api/app/records.py`:
```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import MetaData, Table, select, text

from .auth import current_user
from .db import engine

router = APIRouter(prefix="/api/tables", dependencies=[Depends(current_user)])


def load_table(c, table_id: int):
    """Таблица данных (отражением) и её поля из app_field."""
    row = c.execute(text("select pg_name from app_table where id = :t"), {"t": table_id}).first()
    if not row:
        raise HTTPException(404, "Нет такой таблицы")
    fields = c.execute(
        text("select column_name, editable from app_field where table_id = :t order by sort_order, id"),
        {"t": table_id},
    ).all()
    # ponytail: отражение на каждый запрос (~мс); кешировать, если станет заметно
    return Table(row.pg_name, MetaData(), autoload_with=c), fields


# ponytail: отдаём все строки сразу (13,6 тыс. ≈ 3 МБ JSON) — сетке нужен весь набор; постранично — если упрёмся
@router.get("/{table_id}/records")
def list_records(table_id: int):
    with engine.connect() as c:
        t, fields = load_table(c, table_id)
        cols = [t.c.id, t.c.updated_at] + [t.c[f.column_name] for f in fields]
        return [dict(r) for r in c.execute(select(*cols).order_by(t.c.id)).mappings()]
```

В `api/app/main.py`:
```python
from . import auth, meta, records
```
```python
app.include_router(auth.router)
app.include_router(meta.router)
app.include_router(records.router)
```

- [ ] **Step 4: Тесты проходят**

Run: `docker compose run --rm api pytest -q`
Ожидается: `16 passed`.

- [ ] **Step 5: Commit**

```bash
git add api/app/records.py api/app/main.py api/tests/test_records.py
git commit -m "feat(api): list records of a table"
```

---

### Task 7: Правка записи с защитой от параллельной правки

Правило: клиент отправляет `updated_at`, который он видел. Если запись с тех пор изменили, ответ — 409, и ничего не сохраняется. Менять можно только поля с `editable = true`.

**Files:**
- Modify: `api/app/records.py`, `api/tests/test_records.py`

- [ ] **Step 1: Падающие тесты**

Дописать в `api/tests/test_records.py`:
```python
def _first(client, tid):
    return client.get(f"/api/tables/{tid}/records").json()[0]


def test_patch_record(logged, zip_table):
    rec = _first(logged, zip_table)
    r = logged.patch(
        f"/api/tables/{zip_table}/records/{rec['id']}",
        json={"updated_at": rec["updated_at"], "values": {"qty": 999}},
    )
    assert r.status_code == 200
    assert r.json()["updated_at"] != rec["updated_at"]
    after = _first(logged, zip_table)
    assert after["qty"] == 999
    assert after["name"] == "Кольцо"


def test_patch_stale_is_conflict(logged, zip_table):
    rec = _first(logged, zip_table)
    url = f"/api/tables/{zip_table}/records/{rec['id']}"
    assert logged.patch(url, json={"updated_at": rec["updated_at"], "values": {"qty": 1}}).status_code == 200
    r = logged.patch(url, json={"updated_at": rec["updated_at"], "values": {"qty": 2}})
    assert r.status_code == 409
    assert _first(logged, zip_table)["qty"] == 1


def test_patch_readonly_field(logged, zip_table):
    rec = _first(logged, zip_table)
    r = logged.patch(
        f"/api/tables/{zip_table}/records/{rec['id']}",
        json={"updated_at": rec["updated_at"], "values": {"note": "x"}},
    )
    assert r.status_code == 422


def test_patch_unknown_column(logged, zip_table):
    rec = _first(logged, zip_table)
    r = logged.patch(
        f"/api/tables/{zip_table}/records/{rec['id']}",
        json={"updated_at": rec["updated_at"], "values": {"created_by": 1}},
    )
    assert r.status_code == 422


def test_patch_bad_type(logged, zip_table):
    rec = _first(logged, zip_table)
    r = logged.patch(
        f"/api/tables/{zip_table}/records/{rec['id']}",
        json={"updated_at": rec["updated_at"], "values": {"qty": "много"}},
    )
    assert r.status_code == 422


def test_patch_missing_record(logged, zip_table):
    rec = _first(logged, zip_table)
    r = logged.patch(
        f"/api/tables/{zip_table}/records/99999",
        json={"updated_at": rec["updated_at"], "values": {"qty": 1}},
    )
    assert r.status_code == 404
```

- [ ] **Step 2: Запустить — падает**

Run: `docker compose run --rm api pytest -q tests/test_records.py`
Ожидается: FAIL — 405 Method Not Allowed на PATCH.

- [ ] **Step 3: Реализация**

Итоговый `api/app/records.py`:
```python
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import MetaData, Table, func, select, text, update
from sqlalchemy.exc import DataError, IntegrityError

from .auth import current_user
from .db import engine

router = APIRouter(prefix="/api/tables", dependencies=[Depends(current_user)])


def load_table(c, table_id: int):
    """Таблица данных (отражением) и её поля из app_field."""
    row = c.execute(text("select pg_name from app_table where id = :t"), {"t": table_id}).first()
    if not row:
        raise HTTPException(404, "Нет такой таблицы")
    fields = c.execute(
        text("select column_name, editable from app_field where table_id = :t order by sort_order, id"),
        {"t": table_id},
    ).all()
    # ponytail: отражение на каждый запрос (~мс); кешировать, если станет заметно
    return Table(row.pg_name, MetaData(), autoload_with=c), fields


# ponytail: отдаём все строки сразу (13,6 тыс. ≈ 3 МБ JSON) — сетке нужен весь набор; постранично — если упрёмся
@router.get("/{table_id}/records")
def list_records(table_id: int):
    with engine.connect() as c:
        t, fields = load_table(c, table_id)
        cols = [t.c.id, t.c.updated_at] + [t.c[f.column_name] for f in fields]
        return [dict(r) for r in c.execute(select(*cols).order_by(t.c.id)).mappings()]


class PatchBody(BaseModel):
    updated_at: datetime  # какое значение видел клиент
    values: dict[str, Any]


@router.patch("/{table_id}/records/{record_id}")
def patch_record(table_id: int, record_id: int, body: PatchBody, user: dict = Depends(current_user)):
    try:
        with engine.begin() as c:
            t, fields = load_table(c, table_id)
            bad = set(body.values) - {f.column_name for f in fields if f.editable}
            if bad:
                raise HTTPException(422, "Нельзя менять поля: " + ", ".join(sorted(bad)))
            row = c.execute(
                update(t)
                .where(t.c.id == record_id, t.c.updated_at == body.updated_at)
                .values(**body.values, updated_at=func.now(), updated_by=user["id"])
                .returning(t.c.id, t.c.updated_at)
            ).first()
            if not row:
                if c.execute(select(t.c.id).where(t.c.id == record_id)).first():
                    raise HTTPException(409, "Запись уже изменили — обновите и повторите")
                raise HTTPException(404, "Нет такой записи")
            return dict(row._mapping)
    except (DataError, IntegrityError) as e:
        raise HTTPException(422, "Неверное значение: " + str(e.orig).splitlines()[0])
```

- [ ] **Step 4: Тесты проходят**

Run: `docker compose run --rm api pytest -q`
Ожидается: `22 passed`.

- [ ] **Step 5: Commit**

```bash
git add api/app/records.py api/tests/test_records.py
git commit -m "feat(api): patch record with optimistic concurrency"
```

---

### Task 8: Проверка руками

- [ ] **Step 1: Поднять и создать админа**

```bash
docker compose up -d --build
docker compose exec api python -m app.cli create-user admin "Администратор" admin
```
Ввести пароль.

- [ ] **Step 2: Проверить**

Открыть http://localhost:8000/docs. Выполнить `POST /api/auth/login`, затем `GET /api/auth/me`: приходит пользователь `admin`. `GET /api/tables` возвращает `[]`, это правильно: таблицы появятся после этапа 1б.

---

## Что дальше (отдельные планы, по порядку)

1. **1б — перенос из Airtable.** Скрипт `migrate/`:
   - схема Airtable → DDL таблиц данных (миграция Alembic) и строки `app_table`/`app_field`;
   - записи и связи; вложения на том `files`;
   - виды → `app_view`;
   - не больше 5 запросов/с; повторный запуск на пустую базу; сопоставление по `airtable_id`.

   Первая таблица — Ведомость ЗИП.
2. **1в — интерфейс.**
   - `web/`: Vite + React, вход, боковое меню таблиц;
   - сетка Glide + логика строк TanStack (по прототипу `proto/grid`), правка через PATCH, ответ 409 показывать пользователю;
   - карточка записи.

   Можно начинать параллельно с 1б: проверять на `zip_test`.
3. **1г — сверка.** Количество записей и значения формул/rollup: Airtable против приложения. Нужны скриншоты настроек rollup (`docs/rollup/`).

Роли и права по таблицам, история изменений, read-only ссылки — этапы 2–3 по спецификации.

"""Роли и доступ: spec R1–R7, E1–E4 (план 2026-10-31-stage2a-roles)."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.auth import hash_password
from app.db import engine
from app.main import app

TITLES = {"fin": "Договоры", "zip": "Ведомость ЗИП", "eq": "Оборудование", "svc": "AddDataToZIP"}


def make_user(login, role, must_change=False, blocked=False, password="secret-pass"):
    with engine.begin() as c:
        return c.execute(text(
            "insert into app_user (login, name, role, password_hash, must_change_password, blocked) "
            "values (:l, :l, :r, :h, :m, :b) returning id"
        ), {"l": login, "r": role, "h": hash_password(password), "m": must_change, "b": blocked}).scalar()


def as_user(login, role, ip="127.0.0.1", **kw):
    make_user(login, role, **kw)
    c = TestClient(app, client=(ip, 50000))
    r = c.post("/api/auth/login", json={"login": login, "password": "secret-pass"})
    c.login_status = r.status_code
    return c


@pytest.fixture
def tables():
    """По таблице на каждую группу прав; в каждой одна запись и правимое поле name."""
    ids = {}
    with engine.begin() as c:
        for key, title in TITLES.items():
            pg = f"acl_{key}"
            c.execute(text(
                f"create table {pg} (id serial primary key, name text, "
                "created_at timestamptz not null default now(), created_by int, "
                "updated_at timestamptz not null default now(), updated_by int)"
            ))
            c.execute(text(f"insert into {pg} (name) values ('x')"))
            tid = c.execute(text(
                "insert into app_table (pg_name, title, primary_field) values (:p, :t, 'name') returning id"
            ), {"p": pg, "t": title}).scalar()
            c.execute(text(
                "insert into app_field (table_id, column_name, title, kind, editable) "
                "values (:t, 'name', 'Имя', 'singleLineText', true)"
            ), {"t": tid})
            ids[key] = tid
    yield ids
    with engine.begin() as c:
        for key in TITLES:
            c.execute(text(f"drop table if exists acl_{key}"))


def patch(c, tid):
    rec = c.get(f"/api/tables/{tid}/records").json()[0]
    return c.patch(f"/api/tables/{tid}/records/{rec['id']}",
                   json={"updated_at": rec["updated_at"], "values": {"name": "y"}})


# --- видимость и правка по ролям ---

@pytest.mark.parametrize("role, visible", [
    ("superadmin", {"fin", "zip", "eq"}),
    ("admin", {"fin", "zip", "eq"}),
    ("storekeeper", {"zip", "eq"}),
    ("user", {"zip", "eq"}),
])
def test_visible_tables(tables, role, visible):
    c = as_user("u", role)
    titles = {t["title"] for t in c.get("/api/tables").json()}
    assert titles == {TITLES[k] for k in visible}   # служебные скрыты всем (R8)


@pytest.mark.parametrize("role", ["storekeeper", "user"])
def test_finance_hidden_is_404(tables, role):
    c = as_user("u", role)
    assert c.get(f"/api/tables/{tables['fin']}/fields").status_code == 404
    assert c.get(f"/api/tables/{tables['fin']}/records").status_code == 404


@pytest.mark.parametrize("role, editable", [
    ("admin", {"fin", "zip", "eq"}),
    ("storekeeper", {"zip"}),
    ("user", set()),
])
def test_edit_rights(tables, role, editable):
    c = as_user("u", role)
    for key in ("fin", "zip", "eq"):
        if key == "fin" and role != "admin":
            continue
        fields = c.get(f"/api/tables/{tables[key]}/fields").json()
        assert fields[0]["editable"] == (key in editable), key
        assert patch(c, tables[key]).status_code == (200 if key in editable else 403), key


def test_forbidden_patch_is_logged(tables, caplog):   # E4
    c = as_user("u", "user")
    with caplog.at_level("WARNING"):
        assert patch(c, tables["eq"]).status_code == 403
    assert any("запрещ" in r.getMessage() for r in caplog.records)


# --- смена пароля (R6, E3) ---

def test_must_change_password_blocks_data(tables):
    c = as_user("u", "admin", must_change=True)
    assert c.login_status == 200
    assert c.get("/api/auth/me").json()["must_change_password"] is True
    r = c.get("/api/tables")
    assert r.status_code == 403 and "пароль" in r.json()["detail"]
    r = c.post("/api/auth/password", json={"old": "secret-pass", "new": "brand-new-pass"})
    assert r.status_code == 200
    assert c.get("/api/tables").status_code == 200
    c2 = TestClient(app, client=("127.0.0.1", 1))
    assert c2.post("/api/auth/login", json={"login": "u", "password": "brand-new-pass"}).status_code == 200


def test_password_change_checks_old_and_length():
    c = as_user("u", "user")
    assert c.post("/api/auth/password", json={"old": "wrong", "new": "brand-new-pass"}).status_code == 403
    assert c.post("/api/auth/password", json={"old": "secret-pass", "new": "short"}).status_code == 422


# --- офисная сеть (R7, E2) ---

@pytest.mark.parametrize("role, ok", [("superadmin", True), ("admin", True), ("storekeeper", False), ("user", False)])
def test_outside_office_login(role, ok):
    c = as_user("u", role, ip="8.8.8.8")
    assert c.login_status == (200 if ok else 403)


def test_outside_office_session_rejected():
    c = as_user("u", "user")
    assert c.get("/api/auth/me").status_code == 200
    out = TestClient(app, client=("8.8.8.8", 1), cookies=c.cookies)
    r = out.get("/api/auth/me")
    assert r.status_code == 403 and "вне офиса" in r.json()["detail"]


def test_office_nets_env(monkeypatch):
    monkeypatch.setenv("OFFICE_NETS", "203.0.113.0/24")
    assert as_user("a", "user", ip="203.0.113.5").login_status == 200
    assert as_user("b", "user", ip="127.0.0.1").login_status == 403


# --- блокировка ---

def test_blocked_cannot_login():
    assert as_user("u", "user", blocked=True).login_status == 401


# --- управление пользователями (R2, R3, E1) ---

def test_users_admin_only():
    assert as_user("u", "user").get("/api/users").status_code == 403
    assert as_user("s", "storekeeper").get("/api/users").status_code == 403
    r = as_user("a", "admin").get("/api/users")
    assert r.status_code == 200
    assert {"login", "role", "blocked", "must_change_password"} <= set(r.json()[0])
    assert "password_hash" not in r.json()[0]


def test_admin_creates_user_with_temp_password():
    a = as_user("a", "admin")
    r = a.post("/api/users", json={"login": "new", "name": "Новый", "role": "storekeeper", "password": "temp-pass-1"})
    assert r.status_code == 200
    c = TestClient(app, client=("127.0.0.1", 1))
    assert c.post("/api/auth/login", json={"login": "new", "password": "temp-pass-1"}).status_code == 200
    assert c.get("/api/auth/me").json()["must_change_password"] is True


def test_duplicate_login_rejected():
    a = as_user("a", "admin")
    assert a.post("/api/users", json={"login": "a", "name": "x", "role": "user", "password": "temp-pass-1"}).status_code == 409


@pytest.mark.parametrize("actor, role, ok", [
    ("admin", "user", True), ("admin", "storekeeper", True),
    ("admin", "admin", False), ("admin", "superadmin", False),
    ("superadmin", "admin", True), ("superadmin", "superadmin", False),
])
def test_who_creates_which_role(actor, role, ok):
    c = as_user("a", actor)
    r = c.post("/api/users", json={"login": "n", "name": "n", "role": role, "password": "temp-pass-1"})
    assert r.status_code == (200 if ok else 403)


@pytest.mark.parametrize("body", [{"role": "user"}, {"blocked": True}, {"password": "temp-pass-2"}])
def test_superadmin_untouchable(body):   # E1
    sid = make_user("boss", "superadmin")
    for actor in ("admin", "superadmin"):
        c = as_user(actor, actor) if actor == "admin" else TestClient(app, client=("127.0.0.1", 1))
        if actor == "superadmin":
            c.post("/api/auth/login", json={"login": "boss", "password": "secret-pass"})
        r = c.patch(f"/api/users/{sid}", json=body)
        assert r.status_code == 403 and "Суперадмина изменить нельзя" in r.json()["detail"]


def test_only_superadmin_manages_admins():
    aid = make_user("adm2", "admin")
    a = as_user("a", "admin")
    assert a.patch(f"/api/users/{aid}", json={"role": "user"}).status_code == 403
    assert a.patch(f"/api/users/{aid}", json={"blocked": True}).status_code == 403
    uid = make_user("plain", "user")
    assert a.patch(f"/api/users/{uid}", json={"role": "admin"}).status_code == 403
    s = as_user("s", "superadmin")
    assert s.patch(f"/api/users/{aid}", json={"role": "user"}).status_code == 200
    assert s.patch(f"/api/users/{uid}", json={"role": "admin"}).status_code == 200


def test_block_kills_sessions_and_reset_forces_change():
    victim = as_user("v", "user")
    vid = victim.get("/api/auth/me").json()["id"]
    a = as_user("a", "admin")
    assert a.patch(f"/api/users/{vid}", json={"blocked": True}).status_code == 200
    assert victim.get("/api/auth/me").status_code == 401
    assert a.patch(f"/api/users/{vid}", json={"blocked": False, "password": "temp-pass-9"}).status_code == 200
    c = TestClient(app, client=("127.0.0.1", 1))
    assert c.post("/api/auth/login", json={"login": "v", "password": "temp-pass-9"}).status_code == 200
    assert c.get("/api/auth/me").json()["must_change_password"] is True


def test_users_patch_rejects_extra_fields():   # R37: лишние поля отвергаются
    uid = make_user("plain", "user")
    a = as_user("a", "admin")
    assert a.patch(f"/api/users/{uid}", json={"password_hash": "x"}).status_code == 422
    assert a.patch("/api/users/99999", json={"blocked": True}).status_code == 404


def test_single_superadmin_in_db():   # R2
    make_user("boss", "superadmin")
    with pytest.raises(Exception):
        make_user("boss2", "superadmin")

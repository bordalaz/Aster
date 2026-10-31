"""Ограничение попыток входа и адрес клиента за обратным прокси."""
from fastapi.testclient import TestClient

from app.main import app
from tests.test_access import make_user


def client(ip="127.0.0.1"):
    return TestClient(app, client=(ip, 50000))


def login(c, login="u", password="secret-pass", **headers):
    return c.post("/api/auth/login", json={"login": login, "password": password}, headers=headers)


def test_lockout_after_5_failures_even_with_right_password():
    make_user("u", "admin")
    c = client()
    for _ in range(5):
        assert login(c, password="wrong").status_code == 401
    r = login(c)
    assert r.status_code == 429 and "Слишком много попыток" in r.json()["detail"]
    assert login(client("10.0.0.7")).status_code == 200   # с другого адреса — не заблокирован (нет DoS на чужой логин)


def test_success_resets_counter():
    make_user("u", "admin")
    c = client()
    for _ in range(4):
        login(c, password="wrong")
    assert login(c).status_code == 200
    for _ in range(4):
        assert login(c, password="wrong").status_code == 401
    assert login(c).status_code == 200


def test_per_ip_cap_across_logins():
    make_user("u", "admin")
    c = client()
    for i in range(30):
        login(c, login=f"guess{i}", password="x")
    assert login(c).status_code == 429


def test_forwarded_for_ignored_without_trusted_proxy():
    make_user("u", "user")
    # подделанный заголовок не делает «внешним» и не обходит лимит
    assert login(client(), **{"X-Forwarded-For": "8.8.8.8"}).status_code == 200


def test_forwarded_for_from_trusted_proxy(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXIES", "10.0.0.2/32")
    make_user("u", "user")
    proxy = client("10.0.0.2")
    assert login(proxy, **{"X-Forwarded-For": "8.8.8.8"}).status_code == 403          # снаружи
    assert login(proxy, **{"X-Forwarded-For": "8.8.8.8, 192.168.1.5"}).status_code == 200  # правый не-прокси адрес
    # лимит считается по настоящему адресу: чужой внешний адрес не блокирует офисный
    for _ in range(5):
        login(proxy, password="wrong", **{"X-Forwarded-For": "9.9.9.9"})
    assert login(proxy, **{"X-Forwarded-For": "192.168.1.6"}).status_code == 200

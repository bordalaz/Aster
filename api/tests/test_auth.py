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
    assert r.json()["role"] == "admin"
    assert "password_hash" not in r.json()
    assert logged.post("/api/auth/logout").status_code == 200
    assert logged.get("/api/auth/me").status_code == 401

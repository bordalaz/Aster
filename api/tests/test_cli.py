def test_created_user_can_log_in(client):
    from app.cli import create_user

    create_user("petr", "Пётр", "admin", "pw123")
    r = client.post("/api/auth/login", json={"login": "petr", "password": "pw123"})
    assert r.status_code == 200
    assert client.get("/api/auth/me").json()["role"] == "admin"


def test_compute_verify_runs(capsys, loaded_fixture):
    from migrate.__main__ import main

    code = main(["compute-verify"])
    out = capsys.readouterr().out
    assert "Вычисляемые (агрегаты)" in out
    assert code in (0, 1)   # фикстура может иметь расхождения — важно, что команда отработала

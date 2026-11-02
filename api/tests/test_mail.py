"""«Отправить запись» (Send record Airtable): письмо собирается на сервере с правами отправителя."""
import pytest
from sqlalchemy import text

from app import mail
from app.db import engine
from tests.test_access import as_user


class FakeSMTP:
    sent: list = []

    def __init__(self, host, port, timeout=None):
        self.host = host

    def starttls(self, context=None):
        pass

    def login(self, user, password):
        pass

    def send_message(self, m):
        FakeSMTP.sent.append(m)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def smtp(monkeypatch):
    FakeSMTP.sent = []
    monkeypatch.setattr(mail.smtplib, "SMTP", FakeSMTP)
    for k, v in {"SMTP_HOST": "mail.local", "SMTP_FROM": "bd@hydro.local", "SMTP_PORT": "587"}.items():
        monkeypatch.setenv(k, v)
    return FakeSMTP


def body(ids, **kw):
    return {"ids": ids, "columns": ["name", "qty", "note", "nope"], "to": ["boss@hydro.local"],
            "subject": "Записи из «Ведомость ЗИП»", "message": "Глянь <b>это</b>", **kw}


def test_send_record_card_layout(zip_table, smtp):
    u = as_user("u", "user")
    r = u.post(f"/api/tables/{zip_table}/send", json=body([2, 1]))
    assert r.status_code == 200 and r.json()["sent"] == 2
    m = smtp.sent[0]
    assert m["To"] == "boss@hydro.local" and "bd@hydro.local" in m["From"]
    html = m.get_body(("html",)).get_content()
    assert html.index("Втулка") < html.index("Кольцо")          # порядок записей — как выбрал отправитель
    assert "Кол-во" in html and "nope" not in html               # чужие/несуществующие поля молча отбрасываются
    assert "&lt;b&gt;это&lt;/b&gt;" in html                       # сообщение экранируется
    assert "2 записи" in html
    assert "Наименование: Втулка" in m.get_body(("plain",)).get_content()


def test_send_grid_layout_and_validation(zip_table, smtp):
    u = as_user("u", "user")
    assert u.post(f"/api/tables/{zip_table}/send", json=body([1], grid=True)).status_code == 200
    assert "<th" in smtp.sent[0].get_body(("html",)).get_content()
    assert u.post(f"/api/tables/{zip_table}/send", json=body([1], to=["не адрес"])).status_code == 422
    assert u.post(f"/api/tables/{zip_table}/send", json=body([1], to=[f"a{i}@x.ru" for i in range(16)])).status_code == 422
    assert u.post(f"/api/tables/{zip_table}/send", json=body([999])).status_code == 404


def test_send_needs_mail_server_and_table_access(zip_table, monkeypatch):
    monkeypatch.delenv("SMTP_HOST", raising=False)
    u = as_user("u", "user")
    assert u.get("/api/mail/status").json() == {"configured": False}
    assert u.post(f"/api/tables/{zip_table}/send", json=body([1])).status_code == 503
    with engine.begin() as c:
        fin = c.execute(text("insert into app_table (title, pg_name, primary_field) values ('Договоры', 'x_mail_fin', 'name') "
                             "returning id")).scalar()
    monkeypatch.setenv("SMTP_HOST", "mail.local")
    monkeypatch.setenv("SMTP_FROM", "bd@hydro.local")
    assert u.post(f"/api/tables/{fin}/send", json=body([1])).status_code in (403, 404)   # чужая таблица — нельзя


def test_value_text_like_grid():
    num = {"kind": "number", "options": {"precision": 2}}
    assert mail.value_text(num, 3.5) == "3.50"
    assert mail.value_text({"kind": "currency", "options": {"precision": 2, "symbol": "$"}}, 1234.5) == "$1,234.50"
    assert mail.value_text({"kind": "date", "options": {}}, "2024-03-05") == "05.03.2024"
    assert mail.value_text({"kind": "multipleRecordLinks", "options": {}}, [{"id": 1, "name": "А"}, {"id": 2, "name": "Б"}]) == "А, Б"
    assert mail.value_text({"kind": "checkbox", "options": {}}, True) == "✓"
    assert mail.value_text({"kind": "formula", "options": {"result": {"type": "number", "options": {"precision": 1}}}}, 2) == "2.0"


def test_select_values_as_colored_pills():
    f = {"kind": "singleSelect", "options": {"choices": [{"name": "В работе", "color": "greenLight2"}]}}
    out = mail.value_html(f, "В работе")
    assert "#d1f7c4" in out and "В работе" in out
    assert mail.value_html({"kind": "singleLineText", "options": {}}, "<x>") == "&lt;x&gt;"

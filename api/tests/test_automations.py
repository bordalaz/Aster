"""Автоматизации: список для админов, вкл/выкл и настройки, срабатывание по условию → очередь, логика скриптов."""
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text

from app import automations
from app.db import engine
from tests.test_access import as_user


@pytest.fixture
def moves():
    """Таблица «Перемещение» с галочкой «Отправляем?»; состояние автоматизаций — как после миграции."""
    with engine.begin() as c:
        c.execute(text("create table aut_moves (id serial primary key, name text, ok boolean, "
                       "created_at timestamptz not null default now(), created_by int, "
                       "updated_at timestamptz not null default now(), updated_by int)"))
        c.execute(text("insert into aut_moves (name) values ('x')"))
        tid = c.execute(text("insert into app_table (pg_name, title, primary_field) values ('aut_moves', 'Перемещение', 'name') "
                             "returning id")).scalar()
        c.execute(text("insert into app_field (table_id, column_name, title, kind) values "
                       "(:t, 'name', 'Имя', 'singleLineText'), (:t, 'ok', 'Отправляем?', 'checkbox')"), {"t": tid})
        c.execute(text("update app_automation set enabled = true where key = 'mail_peremeshcheniya'"))
        c.execute(text("delete from app_automation_job; delete from app_automation_run"))
    yield tid
    with engine.begin() as c:
        c.execute(text("drop table if exists aut_moves"))
        c.execute(text("update app_automation set enabled = false, settings = '{}' where key = 'mail_peremeshcheniya'"))
        c.execute(text("delete from app_automation_job; delete from app_automation_run"))


def _jobs():
    with engine.connect() as c:
        return c.execute(text("select key, record_id from app_automation_job")).all()


def test_checkbox_entering_condition_queues_mail_once(moves):
    a = as_user("adm", "admin")
    rec = a.get(f"/api/tables/{moves}/records").json()[0]
    r = a.patch(f"/api/tables/{moves}/records/{rec['id']}", json={"updated_at": rec["updated_at"], "values": {"ok": True}})
    assert r.status_code == 200
    assert _jobs() == [("mail_peremeshcheniya", rec["id"])]
    # снова «да» — уже подходит, не срабатывает; другое поле — тоже нет
    a.patch(f"/api/tables/{moves}/records/{rec['id']}", json={"updated_at": r.json()["updated_at"], "values": {"name": "y"}})
    assert len(_jobs()) == 1
    # без получателей — запуск в журнале с ошибкой, очередь пуста, правка не сломалась
    assert automations.process_jobs() == 1 and _jobs() == []
    run = a.get("/api/automations").json()
    mail = next(x for x in run if x["key"] == "mail_peremeshcheniya")
    assert mail["runs"][0]["ok"] is False and "получатели" in mail["runs"][0]["message"]


def test_disabled_automation_does_not_queue(moves):
    a = as_user("adm", "admin")
    assert a.patch("/api/automations/mail_peremeshcheniya", json={"enabled": False}).status_code == 200
    rec = a.get(f"/api/tables/{moves}/records").json()[0]
    a.patch(f"/api/tables/{moves}/records/{rec['id']}", json={"updated_at": rec["updated_at"], "values": {"ok": True}})
    assert _jobs() == []


def test_admin_only_list_settings_and_manual_run(moves):
    assert as_user("u", "user").get("/api/automations").status_code == 403
    a = as_user("adm", "admin")
    got = {x["key"]: x for x in a.get("/api/automations").json()}
    assert len(got) == 9 and got["zip_foto"]["state"] == "buttons" and got["otchet"]["state"] == "off"
    assert got["defektoskopiya"]["scheduled"] and "schedule" not in got["defektoskopiya"]
    assert a.patch("/api/automations/mail_peremeshcheniya", json={"settings": {"to": ["не адрес"]}}).status_code == 422
    assert a.patch("/api/automations/mail_peremeshcheniya", json={"settings": {"to": ["a@b.ru"], "cc": [], "from_name": "X"}}).status_code == 200
    assert a.patch("/api/automations/narabotka", json={"settings": {"to": ["a@b.ru"]}}).status_code == 422
    assert a.patch("/api/automations/otchet", json={"enabled": True}).status_code == 404     # выключенная в Airtable — без логики
    assert a.post("/api/automations/narabotka/run").status_code == 404                     # вручную — только по расписанию


def test_wpr_note_like_airtable_script():
    assert automations.wpr_note("", "WPR 701", "Текущие") == "WPR 701"
    assert automations.wpr_note("старое", "WPR 701", "Текущие") == "WPR 701, старое"
    assert automations.wpr_note("WPR 701, старое", "WPR 701", "Текущие") is None
    assert automations.wpr_note("WPR 701, старое", "WPR 701", "Разобрали") == "старое"
    assert automations.wpr_note("WPR 701xyz", "WPR 701", "Разобрали") == ""      # как в Airtable — хвост без «, » стирается
    assert automations.wpr_note("другое", "WPR 701", "Разобрали") is None


def test_nk_date_and_daily_schedule():
    assert automations.nk_date("2021-11-23") == date(2021, 11, 23)
    assert automations.nk_date([{"name": "05-03-2024_акт"}, "23-11-2021"]) == date(2024, 3, 5)
    assert automations.nk_date("мусор") is None and automations.nk_date(None) is None
    tz = ZoneInfo("Asia/Tomsk")
    assert not automations.due(datetime(2026, 11, 3, 7, 59, tzinfo=tz), 8, 0)
    assert automations.due(datetime(2026, 11, 3, 8, 0, tzinfo=tz), 8, 0)


def test_scheduled_run_claimed_once_per_day_and_manual_run_does_not_eat_it():
    tz = ZoneInfo("Asia/Tomsk")
    d1, d2 = datetime(2030, 1, 1, 8, 5, tzinfo=tz), datetime(2030, 1, 2, 8, 5, tzinfo=tz)
    with engine.begin() as c:
        c.execute(text("update app_automation set last_scheduled = null, enabled = true where key = 'defektoskopiya'"))
        c.execute(text("insert into app_automation_run (key, ok, at) values ('defektoskopiya', true, :a)"), {"a": d1})  # ручной в 7:xx
    try:
        assert automations.claim("defektoskopiya", d1)          # ручной запуск плановый не съел
        assert not automations.claim("defektoskopiya", d1)      # второй процесс в тот же день — нет
        assert automations.claim("defektoskopiya", d2)
    finally:
        with engine.begin() as c:
            c.execute(text("update app_automation set last_scheduled = null where key = 'defektoskopiya'"))
            c.execute(text("delete from app_automation_run"))


def test_crashed_job_retried_later_then_dropped(moves, monkeypatch):
    calls = []
    def boom(c, t, r):
        calls.append(r)
        raise OSError("SMTP недоступен")
    monkeypatch.setitem(automations.JOBS, "mail_peremeshcheniya", boom)
    with engine.begin() as c:
        c.execute(text("insert into app_automation_job (key, table_id, record_id) values ('mail_peremeshcheniya', :t, 1)"), {"t": moves})
    assert automations.process_jobs() == 1
    with engine.connect() as c:
        j = c.execute(text("select attempts, next_at > now() from app_automation_job")).one()
    assert tuple(j) == (1, True) and automations.process_jobs() == 0   # отложено, а не потеряно
    with engine.begin() as c:
        c.execute(text("update app_automation_job set attempts = :n, next_at = now()"), {"n": automations.MAX_ATTEMPTS - 1})
    assert automations.process_jobs() == 1 and _jobs() == [] and len(calls) == 2

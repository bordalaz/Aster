import shutil

from sqlalchemy import text

from app.db import engine
from migrate.__main__ import main
from migrate.names import column_name, table_name
from migrate.verify import verify

from .conftest import FIXTURE
from .test_migrate_load import A, B, fid, load, rid


def run_verify(snap=FIXTURE):
    with engine.connect() as c:
        return verify(c, snap)


def test_verify_clean_after_load():
    load()
    rep = run_verify()
    assert rep["ok"] is True, rep
    for t in rep["tables"].values():
        assert t["airtable"] == t["db"]
        assert t["value_mismatches"] == [] and t["missing"] == [] and t["extra"] == []
    assert rep["links"]["airtable"] == rep["links"]["db"] == 3
    assert rep["attachments"] == {"airtable": 1, "db": 1, "missing_files": 0}


def test_verify_finds_changed_value():
    load()
    with engine.begin() as c:
        c.execute(text(f"update {table_name(A)} set {column_name(fid('Aname'))} = 'Шайба' where airtable_id = :r"),
                  {"r": rid("A1")})
    rep = run_verify()
    assert rep["ok"] is False
    assert rep["tables"][A]["value_mismatches"] == [
        {"record": rid("A1"), "field": fid("Aname"), "airtable": "Кольцо", "db": "Шайба"}]


def test_verify_reports_extra_rows():
    load()
    with engine.begin() as c:
        c.execute(text(f"insert into {table_name(B)} (airtable_id) values ('recDELETED0000000')"))
    rep = run_verify()
    assert rep["ok"] is True
    assert rep["tables"][B]["extra"] == ["recDELETED0000000"]
    with engine.connect() as c:
        assert c.execute(text(f"select count(*) from {table_name(B)}")).scalar() == 3


def test_verify_missing_file(tmp_path):
    snap = tmp_path / "snap"
    shutil.copytree(FIXTURE, snap)
    (snap / "files" / "attAAAAAAAAAAAAAA").unlink()
    load(snap)
    rep = run_verify(snap)
    assert rep["attachments"]["missing_files"] == 1
    assert rep["ok"] is False


def test_cli_without_token(capsys, monkeypatch):
    monkeypatch.delenv("AIRTABLE_TOKEN", raising=False)
    assert main(["fetch"]) == 2
    assert "Не задан AIRTABLE_TOKEN" in capsys.readouterr().out


def test_cli_no_files_flag(monkeypatch):
    import migrate.__main__ as m

    seen = {}
    monkeypatch.setattr(m, "cmd_fetch", lambda files: seen.setdefault("files", files) and 0)
    monkeypatch.setattr(m, "cmd_load", lambda: 0)
    monkeypatch.setattr(m, "cmd_verify", lambda: 0)
    assert m.main(["all", "--no-files"]) == 0
    assert seen == {"files": False}


def test_verify_lost_attachment_row():
    load()
    with engine.begin() as c:
        c.execute(text("delete from attachment"))
    rep = run_verify()
    assert rep["attachments"]["db"] == 0
    assert rep["ok"] is False

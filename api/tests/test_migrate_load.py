import json
import shutil
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import inspect, text

from app.db import engine
from migrate.load import load_snapshot
from migrate.names import column_name, link_table_name, table_name
from migrate.schema import apply_schema

from .conftest import FIXTURE

A, B, C = "tblAAAAAAAAAAAAAA", "tblBBBBBBBBBBBBBB", "tblCCCCCCCCCCCCCC"


def fid(s):
    s = "fld" + s
    return s + "0" * (17 - len(s))


def rid(s):
    s = "rec" + s
    return s + "0" * (17 - len(s))


def q(sql, **p):
    with engine.connect() as c:
        return c.execute(text(sql), p).all()


def row(tbl, rec):
    with engine.connect() as c:
        return c.execute(text(f"select * from {table_name(tbl)} where airtable_id = :r"), {"r": rec}).mappings().one()


def load(snap=FIXTURE):
    with engine.begin() as c:
        apply_schema(c, json.loads((snap / "schema.json").read_text(encoding="utf-8")))
        return load_snapshot(c, snap)


def counts():
    names = [table_name(t) for t in (A, B, C)] + ["attachment", "at_computed", "at_link_meta"]
    names += q(r"select tablename from pg_tables where tablename like 'l\_fld%'")
    return {n if isinstance(n, str) else n[0]: q(f"select count(*) from {n if isinstance(n, str) else n[0]}")[0][0]
            for n in names}


def test_tables_and_columns_created(loaded_fixture):
    cols = {c["name"] for c in inspect(engine).get_columns(table_name(B))}
    assert column_name(fid("Bwork")) in cols
    assert column_name(fid("Bformula")) not in cols
    assert column_name(fid("Bnom")) not in cols
    assert {"id", "airtable_id", "created_at", "updated_at"} <= cols


def test_metadata_filled(loaded_fixture):
    assert {r.title for r in q("select title from app_table")} == {"Номенклатура", "Оборудование", "Рейсы"}
    f = q("select editable, options from app_field where airtable_id = :f", f=fid("Bformula"))[0]
    assert f.editable is False and f.options["virtual"] is True
    sel = q("select options from app_field where airtable_id = :f", f=fid("Atype"))[0].options
    assert sel["choices"][0] == {"id": "selAAAAAAAAAAAAA1", "name": "трубное", "color": "blueLight2"}


def test_one_link_table_per_pair(loaded_fixture):
    meta = dict((r.field_id, (r.link_table, r.side)) for r in q("select * from at_link_meta"))
    # пара A.Оборудование ↔ B.Номенклатура — одна таблица по меньшему id
    assert meta[fid("Aequip")] == (link_table_name(fid("Aequip")), "src")
    assert meta[fid("Bnom")] == (link_table_name(fid("Aequip")), "dst")
    assert link_table_name(fid("Bnom")) not in inspect(engine).get_table_names()


def test_values_loaded(loaded_fixture):
    r = row(B, rid("B1"))
    assert r[column_name(fid("Bdate"))] == date(2026, 8, 23)
    assert r[column_name(fid("Btime"))] == datetime(2026, 8, 23, 5, 30, tzinfo=timezone.utc)
    assert r[column_name(fid("Btags"))] == ["новое", "аренда"]
    assert r[column_name(fid("Bmod"))]["email"] == "user@example.com"
    assert row(A, rid("A1"))[column_name(fid("Aprice"))] == Decimal("5.5")


def test_missing_checkbox_is_false(loaded_fixture):
    r = row(B, rid("B2"))
    assert r[column_name(fid("Bwork"))] is False
    assert r[column_name(fid("Bdate"))] is None


def test_links_loaded_with_order(loaded_fixture):
    lt = link_table_name(fid("Aequip"))
    pairs = q(f"select a.airtable_id s, b.airtable_id d from {lt} l "
              f"join {table_name(A)} a on a.id = l.src join {table_name(B)} b on b.id = l.dst order by 1")
    assert [tuple(p) for p in pairs] == [(rid("A1"), rid("B1")), (rid("A2"), rid("B2"))]


def test_dangling_link_counted():
    assert load()["dangling_links"] == 1


def test_computed_saved(loaded_fixture):
    vals = dict(((r.record_airtable_id, r.field_id), r.value) for r in q("select * from at_computed"))
    assert vals[(rid("B1"), fid("Bformula"))] == "МИР 295!"
    assert vals[(rid("B2"), fid("Brollup"))] == 0
    assert vals[(rid("B1"), fid("Brollup"))] == 5.5


def test_attachment_saved(loaded_fixture):
    a = q("select * from attachment")[0]
    assert (a.airtable_att_id, a.filename, a.path, a.field_id) == (
        "attAAAAAAAAAAAAAA", "photo.jpg", "files/attAAAAAAAAAAAAAA", fid("Bphoto"))


def test_load_twice_no_duplicates():
    load()
    before = counts()
    load()
    assert counts() == before


def test_reload_applies_changes(tmp_path):
    load()
    snap = tmp_path / "snap"
    shutil.copytree(FIXTURE, snap)
    pa = snap / "records" / f"{A}.jsonl"
    recs = [json.loads(x) for x in pa.read_text(encoding="utf-8").splitlines()]
    recs[0]["fields"][fid("Aprice")] = 7
    recs[0]["fields"][fid("Aequip")] = []
    pa.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in recs), encoding="utf-8")
    pb = snap / "records" / f"{B}.jsonl"
    recs = [json.loads(x) for x in pb.read_text(encoding="utf-8").splitlines()]
    recs[0]["fields"][fid("Bnom")] = []
    pb.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in recs), encoding="utf-8")
    load(snap)
    assert row(A, rid("A1"))[column_name(fid("Aprice"))] == 7
    assert q(f"select count(*) from {link_table_name(fid('Aequip'))}")[0][0] == 1


def test_bad_id_in_schema_rejected():
    bad = [{"id": "tbl1; drop table app_user", "name": "x", "primaryFieldId": fid("X"), "fields": []}]
    with pytest.raises(ValueError):
        with engine.begin() as c:
            apply_schema(c, bad)
    assert q("select count(*) from app_table")[0][0] == 0

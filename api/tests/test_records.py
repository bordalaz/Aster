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


def test_patch_wrong_kind_values(logged, zip_table):
    for bad in (True, {"a": 1}, [1]):
        rec = _first(logged, zip_table)
        r = logged.patch(
            f"/api/tables/{zip_table}/records/{rec['id']}",
            json={"updated_at": rec["updated_at"], "values": {"qty": bad}},
        )
        assert r.status_code == 422, bad


def test_records_computed_and_links(logged, loaded_fixture):
    # вычисляемые поля считает движок и отдаёт; связи — названиями (подробно — test_links.py)
    from migrate.names import column_name

    r = logged.get(f"/api/tables/{loaded_fixture['tblBBBBBBBBBBBBBB']}/records")
    assert r.status_code == 200
    keys = set(r.json()[0])
    assert column_name("fldBinv0000000000") in keys
    assert column_name("fldBformula000000") in keys
    assert column_name("fldBnom0000000000") in keys


def test_records_skip_virtual_even_if_column_exists(logged, loaded_fixture):
    # поле стало вычисляемым в Airtable, а старая колонка осталась — старые значения не отдаём
    from sqlalchemy import text as sql

    from app.db import engine
    from migrate.names import column_name, table_name

    col = column_name("fldBformula000000")
    with engine.begin() as c:
        c.execute(sql(f"alter table {table_name('tblBBBBBBBBBBBBBB')} add column {col} text"))
        c.execute(sql(f"update {table_name('tblBBBBBBBBBBBBBB')} set {col} = 'STALE'"))
    r = logged.get(f"/api/tables/{loaded_fixture['tblBBBBBBBBBBBBBB']}/records")
    assert r.json()[0][col] != "STALE"   # значение — от движка, не из колонки


def test_records_include_live_computed(logged, tmp_path):
    # formula Оборудование.Метка = {Инв} & "!" — в ответе /records, пересчёт после правки входа
    from sqlalchemy import text as sql

    from app import computed
    from app.db import engine
    from migrate.load import load_snapshot
    from migrate.schema import apply_schema
    from tests.compute_fixtures import write_snapshot
    from tests.test_compute import _two_tables

    schema, records = _two_tables()
    schema[1]["fields"].append({"id": "fldOmark000000000", "name": "Метка", "type": "formula", "options": {
        "isValid": True, "referencedFieldIds": [], "result": {"type": "singleLineText"},
        "formula": '{fldOinv0000000000} & "!"'}})
    write_snapshot(tmp_path, schema, records)
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        tid = c.execute(sql("select id from app_table where airtable_id = 'tblOOOOOOOOOOOOOO'")).scalar()
    computed.reset()
    rows = logged.get(f"/api/tables/{tid}/records").json()
    assert [r["f_fldomark000000000"] for r in rows] == ["INV-1!", "INV-2!"]
    assert "airtable_id" not in rows[0]

    r = logged.patch(f"/api/tables/{tid}/records/{rows[0]['id']}",
                     json={"updated_at": rows[0]["updated_at"], "values": {"f_fldoinv0000000000": "NEW"}})
    assert r.status_code == 200
    computed.wait()   # фоновый пересчёт после записи
    assert logged.get(f"/api/tables/{tid}/records").json()[0]["f_fldomark000000000"] == "NEW!"

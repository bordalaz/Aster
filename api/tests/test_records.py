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

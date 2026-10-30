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

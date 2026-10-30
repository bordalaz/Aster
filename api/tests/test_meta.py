def test_tables_require_login(client):
    assert client.get("/api/tables").status_code == 401


def test_tables(logged, zip_table):
    r = logged.get("/api/tables")
    assert r.status_code == 200
    assert r.json() == [{"id": zip_table, "title": "Ведомость ЗИП", "primary_field": "name"}]


def test_fields_in_order(logged, zip_table):
    r = logged.get(f"/api/tables/{zip_table}/fields")
    assert r.status_code == 200
    assert [f["column_name"] for f in r.json()] == ["name", "qty", "note"]
    assert r.json()[2]["editable"] is False


def test_fields_unknown_table(logged):
    assert logged.get("/api/tables/999/fields").status_code == 404

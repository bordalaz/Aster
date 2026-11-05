"""Связи (spec R11): ссылки отдаются названиями связанных записей, с переходом; скрытые таблицы — пусто."""
from sqlalchemy import text

from app import computed
from app.db import engine
from tests.test_access import as_user


def ids(c, tbl):
    pg = c.execute(text("select pg_name from app_table where airtable_id = :a"), {"a": tbl}).scalar()
    return dict(c.execute(text(f"select airtable_id, id from {pg}")).all())


def col(tbl_fld):
    return "f_" + tbl_fld.lower()


def test_links_as_names(loaded_fixture):
    computed.reset()
    t = loaded_fixture
    with engine.connect() as c:
        a, b, cc = ids(c, "tblAAAAAAAAAAAAAA"), ids(c, "tblBBBBBBBBBBBBBB"), ids(c, "tblCCCCCCCCCCCCCC")
    u = as_user("adm", "admin")
    rows = {r["id"]: r for r in u.get(f"/api/tables/{t['tblBBBBBBBBBBBBBB']}/records").json()}
    r1 = rows[b["recB1000000000000"]]
    # битая ссылка recZZZ… при загрузке не попала — остаётся одна
    assert r1[col("fldBnom0000000000")] == [{"id": a["recA1000000000000"], "name": "Кольцо"}]
    assert r1[col("fldBtrips00000000")] == [{"id": cc["recC1000000000000"], "name": "1"}]
    assert rows[b["recB2000000000000"]][col("fldBtrips00000000")] == []
    # обратная сторона пары
    ra = {r["id"]: r for r in u.get(f"/api/tables/{t['tblAAAAAAAAAAAAAA']}/records").json()}
    assert ra[a["recA2000000000000"]][col("fldAequip00000000")] == [{"id": b["recB2000000000000"], "name": "МИР 296"}]

    f = {x["column_name"]: x for x in u.get(f"/api/tables/{t['tblBBBBBBBBBBBBBB']}/fields").json()}
    assert f[col("fldBnom0000000000")]["link_table"] == t["tblAAAAAAAAAAAAAA"]
    assert f[col("fldBinv0000000000")].get("link_table") is None


def test_links_to_hidden_table_are_hidden(loaded_fixture):
    computed.reset()
    t = loaded_fixture
    with engine.begin() as c:   # Номенклатура становится финансовой — пользователю не видна
        c.execute(text("update app_table set title = 'Договоры' where airtable_id = 'tblAAAAAAAAAAAAAA'"))
    u = as_user("usr", "user")
    rows = u.get(f"/api/tables/{t['tblBBBBBBBBBBBBBB']}/records").json()
    assert all(col("fldBnom0000000000") not in r for r in rows)          # поле целиком скрыто
    assert all(r[col("fldBtrips00000000")] is not None for r in rows)
    f = {x["column_name"]: x for x in u.get(f"/api/tables/{t['tblBBBBBBBBBBBBBB']}/fields").json()}
    assert col("fldBnom0000000000") not in f


def test_edit_links(loaded_fixture):
    """Правка связи из сетки/карточки: список id целиком; обе стороны пары, история, порядок."""
    computed.reset()
    t = loaded_fixture
    with engine.connect() as c:
        a, b, cc = ids(c, "tblAAAAAAAAAAAAAA"), ids(c, "tblBBBBBBBBBBBBBB"), ids(c, "tblCCCCCCCCCCCCCC")
    u = as_user("adm", "admin")
    tb, trips = t["tblBBBBBBBBBBBBBB"], col("fldBtrips00000000")
    f = {x["column_name"]: x for x in u.get(f"/api/tables/{tb}/fields").json()}
    assert f[trips]["editable"] is True
    rows = {r["id"]: r for r in u.get(f"/api/tables/{tb}/records").json()}
    b2 = rows[b["recB2000000000000"]]
    r = u.patch(f"/api/tables/{tb}/records/{b2['id']}", json={"updated_at": b2["updated_at"], "values": {trips: [cc["recC1000000000000"]]}})
    assert r.status_code == 200, r.text
    rows = {x["id"]: x for x in u.get(f"/api/tables/{tb}/records").json()}
    assert rows[b2["id"]][trips] == [{"id": cc["recC1000000000000"], "name": "1"}]
    hist = u.get(f"/api/tables/{tb}/records/{b2['id']}/history").json()
    assert hist[0]["column_name"] == trips and hist[0]["old"] == [] and hist[0]["new"][0]["name"] == "1"
    # убрать связь
    r = u.patch(f"/api/tables/{tb}/records/{b2['id']}", json={"updated_at": r.json()["updated_at"], "values": {trips: []}})
    assert r.status_code == 200
    assert {x["id"]: x for x in u.get(f"/api/tables/{tb}/records").json()}[b2["id"]][trips] == []
    # чужие id и не-числа — отказ
    upd = r.json()["updated_at"]
    assert u.patch(f"/api/tables/{tb}/records/{b2['id']}", json={"updated_at": upd, "values": {trips: [999999]}}).status_code == 422
    assert u.patch(f"/api/tables/{tb}/records/{b2['id']}", json={"updated_at": upd, "values": {trips: ["x"]}}).status_code == 422
    # пользователь без права правки — 403
    assert as_user("ro", "user").patch(f"/api/tables/{tb}/records/{b2['id']}",
                                        json={"updated_at": upd, "values": {trips: []}}).status_code == 403


def test_place_by_date():
    from datetime import date
    from app.links import place_by_date
    d = {1: date(2026, 3, 1), 2: date(2026, 1, 1), 3: date(2026, 2, 1), 4: None, 5: date(2026, 1, 1)}
    assert place_by_date([2, 1], [3], d) == [2, 3, 1]          # по дате, старые раньше, свежие в конце
    assert place_by_date([2, 1], [5], d) == [2, 5, 1]          # та же дата — после
    assert place_by_date([2, 1], [4], d) == [2, 1, 4]          # без даты — в конец
    assert place_by_date([1, 2], [3], d) == [3, 1, 2]          # ручной порядок не трогаем — перед первой новее


def test_links_to_events_by_date_and_manual_order(loaded_fixture):
    """Связанные записи-события (с «Датой») встают по дате, а не по времени добавления; переставленное вручную
    остаётся как есть; sort-links один раз раскладывает старые стопки по дате."""
    computed.reset()
    t = loaded_fixture
    with engine.begin() as c:
        b = ids(c, "tblBBBBBBBBBBBBBB")
        bpg = c.execute(text("select pg_name from app_table where airtable_id = 'tblBBBBBBBBBBBBBB'")).scalar()
        c.execute(text(f"update {bpg} set {col('fldBdate000000000')} = :d where id = :i"), {"d": "2026-01-01", "i": b["recB1000000000000"]})
        c.execute(text(f"update {bpg} set {col('fldBdate000000000')} = :d where id = :i"), {"d": "2026-03-01", "i": b["recB2000000000000"]})
        cc = ids(c, "tblCCCCCCCCCCCCCC")
    u = as_user("adm", "admin")
    tc, eq = t["tblCCCCCCCCCCCCCC"], col("fldCequip00000000")
    b1, b2 = b["recB1000000000000"], b["recB2000000000000"]
    rows = {r["id"]: r for r in u.get(f"/api/tables/{tc}/records").json()}
    c1 = rows[cc["recC1000000000000"]]
    assert [x["id"] for x in c1[eq]] == [b1]
    r = u.patch(f"/api/tables/{tc}/records/{c1['id']}", json={"updated_at": c1["updated_at"], "values": {eq: [b1, b2]}})
    assert r.status_code == 200, r.text
    got = lambda: [x["id"] for x in {x["id"]: x for x in u.get(f"/api/tables/{tc}/records").json()}[c1["id"]][eq]]  # noqa: E731
    r = u.patch(f"/api/tables/{tc}/records/{c1['id']}", json={"updated_at": r.json()["updated_at"], "values": {eq: [b2]}})
    r = u.patch(f"/api/tables/{tc}/records/{c1['id']}", json={"updated_at": r.json()["updated_at"], "values": {eq: [b2, b1]}})
    assert got() == [b1, b2]                                    # добавлена в конец, а встала по дате — раньше свежей
    r = u.patch(f"/api/tables/{tc}/records/{c1['id']}", json={"updated_at": r.json()["updated_at"], "values": {eq: [b2, b1]}})
    assert got() == [b2, b1]                                    # перетащили вручную — так и осталось
    from app.cli import sort_links
    assert sort_links() >= 1
    assert got() == [b1, b2]
    # правка со стороны события: B1 (теперь новее) снова связали с рейсом — в стопке рейса встаёт после B2
    tb, trips = t["tblBBBBBBBBBBBBBB"], col("fldBtrips00000000")
    with engine.begin() as c:
        c.execute(text(f"update {bpg} set {col('fldBdate000000000')} = :d where id = :i"), {"d": "2026-05-01", "i": b1})
    rb = lambda: {x["id"]: x for x in u.get(f"/api/tables/{tb}/records").json()}[b1]  # noqa: E731
    r = u.patch(f"/api/tables/{tb}/records/{b1}", json={"updated_at": rb()["updated_at"], "values": {trips: []}})
    assert r.status_code == 200, r.text
    assert got() == [b2]
    r = u.patch(f"/api/tables/{tb}/records/{b1}", json={"updated_at": rb()["updated_at"], "values": {trips: [c1["id"]]}})
    assert r.status_code == 200, r.text
    assert got() == [b2, b1]
    with engine.begin() as c:   # а если B1 старше B2 — встаёт перед ним, хоть добавлена последней
        c.execute(text(f"update {bpg} set {col('fldBdate000000000')} = :d where id = :i"), {"d": "2025-12-01", "i": b1})
    r = u.patch(f"/api/tables/{tb}/records/{b1}", json={"updated_at": rb()["updated_at"], "values": {trips: []}})
    r = u.patch(f"/api/tables/{tb}/records/{b1}", json={"updated_at": rb()["updated_at"], "values": {trips: [c1["id"]]}})
    assert got() == [b1, b2]


def test_records_since_only_changed(loaded_fixture):
    """После правки сетка перечитывает только изменившиеся записи (?since=метка), а не всю таблицу;
    связь — с обеих сторон; чужая/старая метка — вся таблица."""
    computed.reset()
    t = loaded_fixture
    with engine.connect() as c:
        b, cc = ids(c, "tblBBBBBBBBBBBBBB"), ids(c, "tblCCCCCCCCCCCCCC")
    u = as_user("adm", "admin")
    tb, tc, trips = t["tblBBBBBBBBBBBBBB"], t["tblCCCCCCCCCCCCCC"], col("fldBtrips00000000")
    first = u.get(f"/api/tables/{tb}/records?since=0").json()
    assert first["full"] is True and len(first["rows"]) == len(b)
    tok_b = first["token"]
    tok_c = u.get(f"/api/tables/{tc}/records?since=0").json()["token"]
    computed.wait()
    b2 = {r["id"]: r for r in first["rows"]}[b["recB2000000000000"]]
    r = u.patch(f"/api/tables/{tb}/records/{b2['id']}", json={"updated_at": b2["updated_at"], "values": {trips: [cc["recC2000000000000"]]}})
    assert r.status_code == 200, r.text
    got = u.get(f"/api/tables/{tb}/records?since={tok_b}&fresh=1").json()
    assert got["full"] is False and [x["id"] for x in got["rows"]] == [b2["id"]]
    assert got["rows"][0][trips][0]["id"] == cc["recC2000000000000"]
    other = u.get(f"/api/tables/{tc}/records?since={tok_c}&fresh=1").json()
    assert other["full"] is False and [x["id"] for x in other["rows"]] == [cc["recC2000000000000"]]   # обратная сторона
    again = u.get(f"/api/tables/{tb}/records?since={got['token']}").json()
    assert again["full"] is False and again["rows"] == []                                              # ничего нового
    assert u.get(f"/api/tables/{tb}/records?since=чужой.5").json()["full"] is True

"""Калибровка (R22–R26, E11, E13, E14): одно событие на пару МИР × кожух, файлы по шаблону, матрица."""
import shutil

import pytest
from sqlalchemy import text

from app import attachments
from app.db import engine
from tests.conftest import FIXTURE
from tests.test_access import as_user
from tests.test_attachments import upload


@pytest.fixture
def eq(loaded_fixture, tmp_path, monkeypatch):
    """Номенклатура: Кольцо → МИР, Втулка → кожух 121/130; Оборудование: МИР 295 (B1), МИР 296 (B2) — кожух.
    Плюс третий прибор — кожух неизвестного габарита 190/203, и списанный кожух."""
    shutil.copytree(FIXTURE / "files", tmp_path / "files")
    monkeypatch.setattr(attachments, "ROOT", tmp_path)
    with engine.begin() as c:
        c.execute(text("delete from app_housing_size where pattern not in ('121/130', '166/181', '190/213')"))
        a = "at_tblaaaaaaaaaaaaaa"
        b = "at_tblbbbbbbbbbbbbbb"
        c.execute(text(f"update {a} set f_fldaname000000000 = 'МИР' where airtable_id = 'recA1000000000000'"))
        c.execute(text(f"update {a} set f_fldaname000000000 = 'Кожух резистивиметра 121/130/З-102' where airtable_id = 'recA2000000000000'"))
        c.execute(text(f"insert into {a} (airtable_id, f_fldaname000000000) values "
                       "('recA3000000000000', 'Кожух резистивиметра 190/203/З-152'), ('recA4000000000000', 'Инклинометр')"))
        c.execute(text(f"insert into {b} (airtable_id, f_fldbinv0000000000) values "
                       "('recB3000000000000', 'Кожух 7'), ('recB4000000000000', 'Кожух 8'), ('recB5000000000000', 'Инклинометр 12')"))
        ids = dict(c.execute(text(f"select airtable_id, id from {b}")).all())
        nom = dict(c.execute(text(f"select airtable_id, id from {a}")).all())
        lt, side = c.execute(text("select link_table, side from at_link_meta where field_id = 'fldBnom0000000000'")).first()
        c.execute(text(f"delete from {lt}"))
        ins = (f"insert into {lt} (src, dst, pos) values (:s, :d, 0)" if side == "src"
               else f"insert into {lt} (src, dst, rpos) values (:d, :s, 0)")
        for rb, ra in [("recB1000000000000", "recA1000000000000"), ("recB2000000000000", "recA2000000000000"),
                       ("recB3000000000000", "recA3000000000000"), ("recB4000000000000", "recA2000000000000"),
                       ("recB5000000000000", "recA4000000000000")]:
            c.execute(text(ins), {"s": ids[rb], "d": nom[ra]})
        # «Кожух 8» списан: поле статуса — как в базе
        c.execute(text(f"alter table {b} add column f_fldbstatus0000000 text"))
        c.execute(text("insert into app_field (table_id, column_name, title, kind, editable, sort_order, options, airtable_id) "
                       "select table_id, 'f_fldbstatus0000000', 'Статус', 'singleSelect', true, 50, '{}'::jsonb, 'fldBstatus0000000' "
                       "from app_field where airtable_id = 'fldBinv0000000000'"))
        c.execute(text(f"update {b} set f_fldbstatus0000000 = 'Списан' where airtable_id = 'recB4000000000000'"))
    return {"mir": ids["recB1000000000000"], "h": ids["recB2000000000000"], "h_unknown": ids["recB3000000000000"],
            "h_off": ids["recB4000000000000"], "incl": ids["recB5000000000000"]}


def test_equipment_for_form(eq):
    u = as_user("u", "user")
    d = u.get("/api/calibration/equipment").json()
    assert [m["id"] for m in d["mirs"]] == [eq["mir"]]
    hs = {h["id"]: h for h in d["housings"]}
    assert set(hs) == {eq["h"], eq["h_unknown"]}                    # списанный скрыт (E11)
    assert hs[eq["h"]]["size"] == "4.75" and hs[eq["h_unknown"]]["size"] is None
    assert [s["id"] for s in d["singles"]] == [eq["incl"]]
    assert d["unknown_sizes"] == ["190/203"]                        # подсказка админу (E14)


def test_pair_calibration_files_renamed_and_seen_by_both(eq):
    u = as_user("u", "user")
    f1 = upload(u, name="скрины.docx").json()["id"]
    f2 = upload(u, name="mir.CAL").json()["id"]
    body = {"key": "cal-0000001", "date": "2026-08-23", "equipment_id": eq["mir"], "housing_id": eq["h"], "files": [f1, f2]}
    r = u.post("/api/calibrations", json=body)
    assert r.status_code == 200, r.text
    assert u.post("/api/calibrations", json=body).json()["id"] == r.json()["id"]    # E6
    f3 = upload(u, name="другой.cal").json()["id"]
    u.post("/api/calibrations", json={**body, "key": "cal-0000002", "files": [f3]})   # та же пара в тот же день (E13)
    for who in (eq["mir"], eq["h"]):                                                  # видно в карточках обоих (R22)
        cals = u.get(f"/api/calibrations?equipment_id={who}").json()
        assert len(cals) == 2
    names = sorted(f["name"] for c in u.get(f"/api/calibrations?equipment_id={eq['mir']}").json() for f in c["files"])
    assert names == ["МИР-295_КОЖУХ-296_4.75_2026-08-23.cal", "МИР-295_КОЖУХ-296_4.75_2026-08-23.docx",
                     "МИР-295_КОЖУХ-296_4.75_2026-08-23_2.cal"]
    with engine.connect() as c:
        assert c.execute(text("select original_name from attachment where id = :i"), {"i": f2}).scalar() == "mir.CAL"
    d = u.get(f"/api/attachments/{f1}")
    assert d.status_code == 200 and "attachment" in d.headers["content-disposition"]


def test_unknown_size_name_without_size(eq):
    u = as_user("u", "user")
    f = upload(u, name="x.cal").json()["id"]
    r = u.post("/api/calibrations", json={"key": "cal-0000003", "date": "2026-01-05", "equipment_id": eq["mir"],
                                          "housing_id": eq["h_unknown"], "files": [f]})
    assert r.status_code == 200
    assert u.get(f"/api/calibrations?equipment_id={eq['mir']}").json()[0]["files"][0]["name"] == "МИР-295_КОЖУХ-007_2026-01-05.cal"


def test_validation(eq):
    u = as_user("u", "user")
    post = lambda **kw: u.post("/api/calibrations", json={"key": "cal-bad-0001", "date": "2026-02-01", **kw})
    assert post(equipment_id=eq["mir"]).status_code == 422                                  # МИР без кожуха
    assert post(equipment_id=eq["mir"], housing_id=eq["h_off"]).status_code == 422          # списанный кожух (E11)
    assert post(equipment_id=eq["mir"], housing_id=eq["mir"]).status_code == 422            # не кожух
    assert post(equipment_id=eq["h"], housing_id=eq["h"]).status_code == 422                # кожух — не прибор
    f = upload(u).json()["id"]
    assert post(equipment_id=eq["incl"], files=[f]).status_code == 422                      # R23: без файлов
    assert post(equipment_id=eq["incl"], housing_id=eq["h"]).status_code == 422             # R23: без пары
    assert post(equipment_id=eq["incl"]).status_code == 200


def test_matrix_latest_pair(eq):
    u = as_user("u", "user")
    for k, d in (("cal-m-000001", "2025-01-10"), ("cal-m-000002", "2025-06-01")):
        u.post("/api/calibrations", json={"key": k, "date": d, "equipment_id": eq["mir"], "housing_id": eq["h"]})
    m = u.get("/api/calibration/matrix").json()
    assert [x["id"] for x in m["mirs"]] == [eq["mir"]] and {x["id"] for x in m["housings"]} == {eq["h"], eq["h_unknown"]}
    assert m["cells"] == [{"mir": eq["mir"], "housing": eq["h"], "date": "2025-06-01", "count": 2, "id": m["cells"][0]["id"]}]


def test_admin_adds_housing_size(eq):
    assert as_user("u", "user").put("/api/calibration/sizes", json={"pattern": "190/203", "size": "7"}).status_code == 403
    a = as_user("a", "admin")
    assert a.put("/api/calibration/sizes", json={"pattern": "190/203", "size": "7"}).status_code == 200
    d = a.get("/api/calibration/equipment").json()
    assert {h["id"]: h["size"] for h in d["housings"]}[eq["h_unknown"]] == "7" and d["unknown_sizes"] == []


def test_maintenance_columns_on_equipment(eq):
    """Регламент на данных базы: вычисляемые колонки Оборудования; списанный — без рекомендаций."""
    u = as_user("u", "user")
    b = u.get("/api/tables").json()
    tid = next(t["id"] for t in b if t["title"] == "Оборудование")
    cols = [f["column_name"] for f in u.get(f"/api/tables/{tid}/fields").json()]
    assert cols[-5:] == ["_need_to", "_last_to", "_defect", "_defect_mark", "_calib"]
    u.post("/api/calibrations", json={"key": "cal-mt-00001", "date": "2026-10-01", "equipment_id": eq["mir"], "housing_id": eq["h"]})
    rows = {r["id"]: r for r in u.get(f"/api/tables/{tid}/records").json()}
    assert rows[eq["mir"]]["_need_to"]["name"] == "нет данных"           # E7: ТО не было — не «пора»
    assert rows[eq["mir"]]["_calib"]["name"].startswith("2026-10-01 · ")  # R21: дата + пара
    assert rows[eq["h"]]["_calib"]["name"].startswith("2026-10-01 · МИР 295")   # видно и у кожуха
    assert "_need_to" not in rows[eq["h_off"]] and "_calib" not in rows[eq["h_off"]]   # списан


def test_rules_admin_edits_thresholds(eq):
    from sqlalchemy import text as t_
    with engine.connect() as c:
        to2 = c.execute(t_("select id from app_maint_rule where level = 'ТО-2' and match ? 'Пульсатор'")).scalar()
        arr = c.execute(t_("select id from app_maint_rule where on_arrival limit 1")).scalar()
    u = as_user("u", "user")
    assert len(u.get("/api/maintenance/rules").json()) >= 13
    assert u.patch(f"/api/maintenance/rules/{to2}", json={"hours": 300}).status_code == 403
    a = as_user("a", "admin")
    assert a.patch(f"/api/maintenance/rules/{arr}", json={"hours": 10}).status_code == 404     # «при поступлении» без порога
    assert a.patch(f"/api/maintenance/rules/{to2}", json={"hours": 300, "months": None}).status_code == 200
    assert next(r for r in a.get("/api/maintenance/rules").json() if r["id"] == to2)["hours"] == 300
    a.patch(f"/api/maintenance/rules/{to2}", json={"hours": 250})   # вернуть (таблица правил общая для тестов)

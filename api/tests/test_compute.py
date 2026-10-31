from pathlib import Path

from sqlalchemy import text

from migrate.load import load_snapshot
from migrate.schema import apply_schema
from migrate.compute import compute_field
from migrate.verify import verify_computed
from tests.compute_fixtures import write_snapshot, link_field, rollup_field


def _two_tables():
    # Номенклатура(primary Имя, Цена) 1—N Оборудование(primary Инв); Оборудование.ЦенаИзНом = rollup.
    schema = [
        {"id": "tblNNNNNNNNNNNNNN", "name": "Номенклатура", "primaryFieldId": "fldNnm00000000000",
         "fields": [
            {"id": "fldNnm00000000000", "name": "Имя", "type": "singleLineText"},
            {"id": "fldNprice00000000", "name": "Цена", "type": "number", "options": {"precision": 2}},
            link_field("fldNequip00000000", "Оборудование", "tblOOOOOOOOOOOOOO", "fldOnom0000000000")]},
        {"id": "tblOOOOOOOOOOOOOO", "name": "Оборудование", "primaryFieldId": "fldOinv0000000000",
         "fields": [
            {"id": "fldOinv0000000000", "name": "Инв", "type": "singleLineText"},
            link_field("fldOnom0000000000", "Номенклатура", "tblNNNNNNNNNNNNNN", "fldNequip00000000"),
            rollup_field("fldOprice00000000", "ЦенаИзНом", "fldOnom0000000000", "fldNprice00000000")]},
    ]
    records = {
        "tblNNNNNNNNNNNNNN": [
            {"id": "recN1", "createdTime": "2023-01-01T00:00:00.000Z",
             "fields": {"fldNnm00000000000": "Кольцо", "fldNprice00000000": 5.5, "fldNequip00000000": ["recO1", "recO2"]}}],
        "tblOOOOOOOOOOOOOO": [
            {"id": "recO1", "createdTime": "2023-01-01T00:00:00.000Z",
             "fields": {"fldOinv0000000000": "INV-1", "fldOnom0000000000": ["recN1"]}},
            {"id": "recO2", "createdTime": "2023-01-02T00:00:00.000Z",
             "fields": {"fldOinv0000000000": "INV-2", "fldOnom0000000000": ["recN1"]}}],
    }
    return schema, records


def test_snapshot_loads(tmp_path):
    schema, records = _two_tables()
    write_snapshot(tmp_path, schema, records)
    from app.db import engine  # noqa
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        n = c.execute(text("select count(*) from at_tbloooooooooooooo")).scalar()
    assert n == 2


def test_sum_over_links(tmp_path):
    # Оборудование.ЦенаИзНом = SUM цены связанной номенклатуры (у recO1 одна номенклатура 5.5).
    schema, records = _two_tables()
    write_snapshot(tmp_path, schema, records)
    from app.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        vals = compute_field(c, "Оборудование.ЦенаИзНом", "SUM")
    assert vals["recO1"] == 5.5
    assert vals["recO2"] == 5.5


def test_counta_and_arrayjoin(tmp_path):
    # Номенклатура.ЧислоОбор = COUNTA по инв. номерам; .ИнвСписок = ARRAYJOIN по инв. номерам.
    schema, records = _two_tables()
    schema[0]["fields"] += [
        rollup_field("fldNcnt0000000000", "ЧислоОбор", "fldNequip00000000", "fldOinv0000000000", "number"),
        rollup_field("fldNjoin000000000", "ИнвСписок", "fldNequip00000000", "fldOinv0000000000", "text"),
    ]
    write_snapshot(tmp_path, schema, records)
    from app.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        cnt = compute_field(c, "Номенклатура.ЧислоОбор", "COUNTA")
        join = compute_field(c, "Номенклатура.ИнвСписок", "ARRAYJOIN")
    assert cnt["recN1"] == 2
    assert join["recN1"] == "INV-1, INV-2"   # порядок = pos связей


def test_min_max_arrayunique(tmp_path):
    schema, records = _two_tables()
    # числовое поле-источник с повтором для ARRAYUNIQUE
    schema[1]["fields"].append({"id": "fldOq000000000000", "name": "Кол", "type": "number", "options": {"precision": 0}})
    records["tblOOOOOOOOOOOOOO"][0]["fields"]["fldOq000000000000"] = 3
    records["tblOOOOOOOOOOOOOO"][1]["fields"]["fldOq000000000000"] = 3
    schema[0]["fields"] += [
        rollup_field("fldNmin0000000000", "МинКол", "fldNequip00000000", "fldOq000000000000", "number"),
        rollup_field("fldNmax0000000000", "МаксКол", "fldNequip00000000", "fldOq000000000000", "number"),
        rollup_field("fldNuniq000000000", "УникКол", "fldNequip00000000", "fldOq000000000000", "text"),
    ]
    write_snapshot(tmp_path, schema, records)
    from app.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        assert compute_field(c, "Номенклатура.МинКол", "MIN")["recN1"] == 3
        assert compute_field(c, "Номенклатура.МаксКол", "MAX")["recN1"] == 3
        uniq = compute_field(c, "Номенклатура.УникКол", "ARRAYUNIQUE")
    assert uniq["recN1"] == [3]   # дубликат схлопнут


def test_filter_equals_select(tmp_path):
    # Номенклатура.ВЭксплуатации = COUNTA оборудования со Статус = 'В эксплуатации'
    schema, records = _two_tables()
    schema[1]["fields"].append({"id": "fldOstatus0000000", "name": "Статус", "type": "singleSelect",
        "options": {"choices": [{"id": "selW", "name": "В эксплуатации"}, {"id": "selB", "name": "Брак"}]}})
    records["tblOOOOOOOOOOOOOO"][0]["fields"]["fldOstatus0000000"] = "В эксплуатации"
    records["tblOOOOOOOOOOOOOO"][1]["fields"]["fldOstatus0000000"] = "Брак"
    schema[0]["fields"].append(rollup_field(
        "fldNwork000000000", "ВЭксплуатации", "fldNequip00000000", "fldOinv0000000000", "number",
        filters={"conjunction": "and", "conditions": [
            {"fieldId": "fldOstatus0000000", "operator": "=", "value": "В эксплуатации"}]}))
    write_snapshot(tmp_path, schema, records)
    from app.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        vals = compute_field(c, "Номенклатура.ВЭксплуатации", "COUNTA")
    assert vals["recN1"] == 1   # из двух оборудований фильтр прошло одно


def test_filter_year_ge(tmp_path):
    schema, records = _two_tables()
    schema[1]["fields"].append({"id": "fldOdate000000000", "name": "Дата", "type": "date",
        "options": {"dateFormat": {"name": "iso", "format": "YYYY-MM-DD"}}})
    records["tblOOOOOOOOOOOOOO"][0]["fields"]["fldOdate000000000"] = "2020-06-01"
    records["tblOOOOOOOOOOOOOO"][1]["fields"]["fldOdate000000000"] = "2022-06-01"
    schema[0]["fields"].append(rollup_field(
        "fldNfresh00000000", "СвежихОбор", "fldNequip00000000", "fldOinv0000000000", "number",
        filters={"conjunction": "and", "conditions": [
            {"fieldId": "fldOdate000000000", "operator": ">=", "value": 2021, "valueKind": "year"}]}))
    write_snapshot(tmp_path, schema, records)
    from app.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        vals = compute_field(c, "Номенклатура.СвежихОбор", "COUNTA")
    assert vals["recN1"] == 1   # только запись 2022 года


def test_filter_all_fail_gives_empty_aggregate(tmp_path):
    schema, records = _two_tables()
    schema[0]["fields"].append(rollup_field(
        "fldNnone000000000", "Никого", "fldNequip00000000", "fldOinv0000000000", "number",
        filters={"conjunction": "and", "conditions": [
            {"fieldId": "fldOinv0000000000", "operator": "contains", "value": "ZZZ"}]}))
    write_snapshot(tmp_path, schema, records)
    from app.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        vals = compute_field(c, "Номенклатура.Никого", "COUNTA")
    assert vals["recN1"] == 0   # владелец остаётся, агрегат пустого списка


def test_verify_matches_oracle(tmp_path):
    # recO1 совпадает с ожиданием (5.5), recO2 нет (99) — сверка должна поймать второе.
    schema, records = _two_tables()
    write_snapshot(tmp_path, schema, records)
    from app.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        c.execute(text("insert into at_computed values "
                       "('tblOOOOOOOOOOOOOO','recO1','fldOprice00000000', to_jsonb(5.5)), "
                       "('tblOOOOOOOOOOOOOO','recO2','fldOprice00000000', to_jsonb(99)) "
                       "on conflict (table_id, record_airtable_id, field_id) do update set value = excluded.value"))
        rep = verify_computed(c, only={"Оборудование.ЦенаИзНом": "SUM"})
    f = rep["fields"]["Оборудование.ЦенаИзНом"]
    assert f["checked"] == 2
    assert f["mismatches"] == 1
    assert any(m["record"] == "recO2" for m in f["examples"])


def test_invalid_field_reported(tmp_path):
    schema, records = _two_tables()
    bad = rollup_field("fldObad0000000000", "Битое", "fldOnom0000000000", "fldNprice00000000")
    bad["options"]["isValid"] = False
    schema[1]["fields"].append(bad)
    write_snapshot(tmp_path, schema, records)
    from app.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        rep = verify_computed(c, only={"Оборудование.Битое": "COUNTA"})
    assert rep["fields"]["Оборудование.Битое"]["status"] == "invalid"

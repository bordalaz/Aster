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
    assert type(vals["recO1"]) is float   # как в API Airtable: Decimal из numeric не сравнивается с float точно


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
    assert join["recN1"] == "INV-1,INV-2"   # порядок = pos связей; разделитель Airtable — ","


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
        filters={"operator": "and", "operands": [
            {"operator": "=", "operands": ["fldOstatus0000000", "selW"]}]}))   # Airtable шлёт id варианта
    write_snapshot(tmp_path, schema, records)
    from app.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        vals = compute_field(c, "Номенклатура.ВЭксплуатации", "COUNTA")
    assert vals["recN1"] == 1   # из двух оборудований фильтр прошло одно


def test_filter_year_ge_on_formula(tmp_path):
    # фильтр «Год >= 2021», где Год — formula-поле связанной таблицы (значение приходит в at_computed)
    schema, records = _two_tables()
    schema[1]["fields"].append({"id": "fldOyear000000000", "name": "Год", "type": "formula",
        "options": {"isValid": True, "formula": "YEAR(x)", "referencedFieldIds": [],
                    "result": {"type": "number", "options": {"precision": 0}}}})
    records["tblOOOOOOOOOOOOOO"][0]["fields"]["fldOyear000000000"] = 2020
    records["tblOOOOOOOOOOOOOO"][1]["fields"]["fldOyear000000000"] = 2022
    schema[0]["fields"].append(rollup_field(
        "fldNfresh00000000", "СвежихОбор", "fldNequip00000000", "fldOinv0000000000", "number",
        filters={"operator": "and", "operands": [
            {"operator": ">=", "operands": ["fldOyear000000000", 2021]}]}))
    write_snapshot(tmp_path, schema, records)
    from app.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        vals = compute_field(c, "Номенклатура.СвежихОбор", "COUNTA")
    assert vals["recN1"] == 1   # только запись 2022 года


def test_filter_exact_date_and_does_not_contain(tmp_path):
    schema, records = _two_tables()
    schema[1]["fields"].append({"id": "fldOdate000000000", "name": "Дата", "type": "date",
        "options": {"dateFormat": {"name": "iso", "format": "YYYY-MM-DD"}}})
    records["tblOOOOOOOOOOOOOO"][0]["fields"]["fldOdate000000000"] = "2020-06-01"
    records["tblOOOOOOOOOOOOOO"][1]["fields"]["fldOdate000000000"] = "2022-06-01"
    schema[0]["fields"] += [
        rollup_field("fldNafter00000000", "После2021", "fldNequip00000000", "fldOinv0000000000", "number",
            filters={"operator": "and", "operands": [{"operator": ">", "operands": ["fldOdate000000000",
                {"mode": "exactDate", "timeZone": "Asia/Tomsk", "exactDate": "2021-01-01T00:00:00.000Z"}]}]}),
        rollup_field("fldNnot1000000000", "БезИнв1", "fldNequip00000000", "fldOinv0000000000", "number",
            filters={"operator": "and", "operands": [
                {"operator": "doesNotContain", "operands": ["fldOinv0000000000", "inv-1"]}]}),  # без учёта регистра
    ]
    write_snapshot(tmp_path, schema, records)
    from app.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        assert compute_field(c, "Номенклатура.После2021", "COUNTA")["recN1"] == 1
        assert compute_field(c, "Номенклатура.БезИнв1", "COUNTA")["recN1"] == 1


def test_link_source_gives_primary_names(tmp_path):
    # источник — поле-связь: Номенклатура → Оборудование → его связь «Номенклатура» → первичные имена второго звена
    schema, records = _two_tables()
    schema[0]["fields"].append(rollup_field(
        "fldNback000000000", "НазадИмена", "fldNequip00000000", "fldOnom0000000000", "text"))
    write_snapshot(tmp_path, schema, records)
    from app.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        assert compute_field(c, "Номенклатура.НазадИмена", "ARRAYJOIN")["recN1"] == "Кольцо,Кольцо"
        assert compute_field(c, "Номенклатура.НазадИмена", "COUNTA")["recN1"] == 2


def test_rollup_items_are_cells(tmp_path):
    # Элемент rollup — ячейка связанной записи: ARRAYJOIN оставляет пустые («a,»),
    # COUNTA по полю-связи считает ячейки, а не имена в них (у recO1 две номенклатуры — одна ячейка).
    schema, records = _two_tables()
    records["tblNNNNNNNNNNNNNN"].append({"id": "recN2", "createdTime": "2023-01-01T00:00:00.000Z",
        "fields": {"fldNnm00000000000": "Втулка", "fldNequip00000000": ["recO1"]}})
    records["tblOOOOOOOOOOOOOO"][0]["fields"]["fldOnom0000000000"] = ["recN1", "recN2"]
    schema[1]["fields"].append({"id": "fldOnote000000000", "name": "Прим", "type": "singleLineText"})
    records["tblOOOOOOOOOOOOOO"][0]["fields"]["fldOnote000000000"] = "x"
    schema[0]["fields"] += [
        rollup_field("fldNback000000000", "НазадИмена", "fldNequip00000000", "fldOnom0000000000", "text"),
        rollup_field("fldNnote000000000", "Примечания", "fldNequip00000000", "fldOnote000000000", "text")]
    write_snapshot(tmp_path, schema, records)
    from app.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        assert compute_field(c, "Номенклатура.НазадИмена", "COUNTA")["recN1"] == 2
        assert compute_field(c, "Номенклатура.НазадИмена", "ARRAYJOIN")["recN1"] == "Кольцо, Втулка,Кольцо"
        assert compute_field(c, "Номенклатура.Примечания", "ARRAYJOIN")["recN1"] == "x,"


def test_filter_all_fail_gives_empty_aggregate(tmp_path):
    schema, records = _two_tables()
    schema[0]["fields"].append(rollup_field(
        "fldNnone000000000", "Никого", "fldNequip00000000", "fldOinv0000000000", "number",
        filters={"operator": "and", "operands": [
            {"operator": "=", "operands": ["fldOinv0000000000", "ZZZ"]}]}))
    write_snapshot(tmp_path, schema, records)
    from app.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        vals = compute_field(c, "Номенклатура.Никого", "COUNTA")
    assert vals["recN1"] == 0   # владелец остаётся, агрегат пустого списка


def test_duplicate_select_choices_merged(tmp_path):
    # Два одноимённых варианта статуса сливаются в один: остаётся первый id, второй — в mergedIds;
    # фильтр по второму id находит тот же статус (как «На калибровку» в Оборудовании).
    schema, records = _two_tables()
    schema[1]["fields"].append({"id": "fldOstatus0000000", "name": "Статус", "type": "singleSelect",
        "options": {"choices": [{"id": "selA", "name": "На калибровку", "color": "redBright"},
                                {"id": "selW", "name": "В эксплуатации"},
                                {"id": "selB", "name": "На калибровку", "color": "pinkBright"}]}})
    records["tblOOOOOOOOOOOOOO"][0]["fields"]["fldOstatus0000000"] = "На калибровку"
    schema[0]["fields"].append(rollup_field(
        "fldNcal0000000000", "НаКалибровку", "fldNequip00000000", "fldOinv0000000000", "number",
        filters={"operator": "and", "operands": [{"operator": "=", "operands": ["fldOstatus0000000", "selB"]}]}))
    write_snapshot(tmp_path, schema, records)
    from app.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        choices = c.execute(text("select options->'choices' from app_field "
                                 "where airtable_id = 'fldOstatus0000000'")).scalar()
        assert [ch["name"] for ch in choices] == ["На калибровку", "В эксплуатации"]
        assert choices[0]["id"] == "selA" and choices[0]["mergedIds"] == ["selB"]
        assert compute_field(c, "Номенклатура.НаКалибровку", "COUNTA")["recN1"] == 1


def test_known_divergence_not_failing(tmp_path):
    # Поле из KNOWN_DIFF расходится с Airtable сознательно — статус known, сверка не падает.
    schema, records = _two_tables()
    write_snapshot(tmp_path, schema, records)
    from app.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        c.execute(text("insert into at_computed values ('tblOOOOOOOOOOOOOO','recO1','fldOprice00000000', to_jsonb(99)) "
                       "on conflict (table_id, record_airtable_id, field_id) do update set value = excluded.value"))
        rep = verify_computed(c, only={"Оборудование.ЦенаИзНом": "SUM"},
                              known={"Оборудование.ЦенаИзНом": "тест"})
    assert rep["fields"]["Оборудование.ЦенаИзНом"]["status"] == "known"
    assert rep["ok"]


def test_last_and_first_value(tmp_path):
    # «Последнее значение» (сноска ¹): ARRAYJOIN через «;», хвостовая «;» отрезается, берётся хвост после
    # последней «;». «Первое» (²): ARRAYJOIN, текст до первой запятой.
    from migrate.compute import _aggregate
    assert _aggregate(["a", "b", "c"], "LAST") == "c"
    assert _aggregate(["a", "b", None], "LAST") == "b"        # одна пустая в конце съедается вместе с «;»
    assert _aggregate(["a", None, None], "LAST") == ""
    assert _aggregate(["x; y", "z"], "LAST") == "z"
    assert _aggregate(["x; y"], "LAST") == " y"               # «;» внутри значения тоже режет — как в Airtable
    assert _aggregate([], "LAST") == ""
    assert _aggregate(["WPR 120", "ГК 172"], "FIRST") == "WPR 120"
    assert _aggregate(["ГК 172"], "FIRST") == "ГК 172"


def test_formula_over_link_and_rollup(tmp_path):
    # Оборудование.Имя = {Номенклатура} & "_" & {ЦенаИзНом}: связь даёт первичное имя, rollup — из at_computed
    from datetime import date
    from migrate.compute import compute_formula
    schema, records = _two_tables()
    schema[1]["fields"].append({"id": "fldOname000000000", "name": "Имя", "type": "formula", "options": {
        "isValid": True, "referencedFieldIds": [], "result": {"type": "singleLineText"},
        "formula": '{fldOnom0000000000} & "_" & {fldOprice00000000}'}})
    records["tblOOOOOOOOOOOOOO"][0]["fields"]["fldOprice00000000"] = 5.5   # ожидание rollup из Airtable
    write_snapshot(tmp_path, schema, records)
    from app.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        got = compute_formula(c, "Оборудование.Имя", date(2026, 10, 31))
    assert got == {"recO1": "Кольцо_5.5", "recO2": "Кольцо_"}


def _with_lookups(schema):
    # Номенклатура: lookup инв. номеров, lookup поля-связи «Номенклатура» оборудования, count оборудования
    schema[0]["fields"] += [
        {"id": "fldNlkinv00000000", "name": "Инвентарные", "type": "multipleLookupValues", "options": {
            "isValid": True, "recordLinkFieldId": "fldNequip00000000", "fieldIdInLinkedTable": "fldOinv0000000000",
            "result": {"type": "singleLineText"}}},
        {"id": "fldNlklnk00000000", "name": "НомОборудования", "type": "multipleLookupValues", "options": {
            "isValid": True, "recordLinkFieldId": "fldNequip00000000", "fieldIdInLinkedTable": "fldOnom0000000000",
            "result": {"type": "multipleRecordLinks", "options": {}}}},
        {"id": "fldNcount00000000", "name": "Штук", "type": "count", "options": {
            "isValid": True, "recordLinkFieldId": "fldNequip00000000"}},
        {"id": "fldNfml0000000000", "name": "Текст", "type": "formula", "options": {
            "isValid": True, "referencedFieldIds": [], "result": {"type": "singleLineText"},
            "formula": "{fldNlklnk00000000} & \"\""}},
    ]


def test_lookup_and_count(tmp_path):
    from datetime import date
    from migrate.compute import compute_count, compute_formula, compute_lookup
    schema, records = _two_tables()
    _with_lookups(schema)
    records["tblNNNNNNNNNNNNNN"][0]["fields"]["fldNlklnk00000000"] = ["recN1", "recN1"]   # API: id записей
    write_snapshot(tmp_path, schema, records)
    from app.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        assert compute_lookup(c, "Номенклатура.Инвентарные")["recN1"] == ["INV-1", "INV-2"]
        assert compute_lookup(c, "Номенклатура.НомОборудования")["recN1"] == ["recN1", "recN1"]  # id, как в API
        assert compute_count(c, "Номенклатура.Штук")["recN1"] == 2
        # в формуле lookup поля-связи — имена, а не id
        assert compute_formula(c, "Номенклатура.Текст", date(2026, 10, 31))["recN1"] == "Кольцо, Кольцо"


def test_filter_is_any_none_of_and_attachment_equality():
    from migrate.compute import _passes
    from migrate.verify import _equal
    f = {"operator": "isNoneOf", "operands": ["fldX", ["Брак", "Списан"]]}
    assert _passes(f, lambda fid, t: ("В эксплуатации", t))
    assert not _passes(f, lambda fid, t: ("Брак", t))
    assert _passes({"operator": "isAnyOf", "operands": ["fldX", ["Брак"]]}, lambda fid, t: ("Брак", t))
    # вложения сравниваем по id: url у Airtable временный
    assert _equal(["attA", "attB"], [{"id": "attA", "url": "https://x/1"}, {"id": "attB", "url": "https://x/2"}])
    assert not _equal(["attA"], [{"id": "attB", "url": "https://x/1"}])


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

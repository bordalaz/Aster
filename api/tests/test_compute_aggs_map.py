from migrate.rollup_aggs import AGG, FUNCS


def test_known_functions_only():
    bad = {v for v in AGG.values()} - FUNCS
    assert not bad, f"неизвестные функции в карте: {bad}"


def test_keys_are_table_dot_field():
    for k in AGG:
        assert k.count(".") >= 1, f"ключ не в виде 'Таблица.Поле': {k!r}"


def test_covers_sample_rollups():
    # контрольные поля из docs/airtable-analysis.md §3
    assert AGG["Работы.Рейсов"] == "COUNTA"
    assert AGG["Работы.Начало работ"] == "MIN"
    assert AGG["Оборудование.Дефектоскопия от"] == "MAX"
    assert AGG["Подрядчики.Работ"] == "COUNTA_UNIQUE"
    assert AGG["Оборудование.Местонахождение"] == "FORMULA_DEFER"
    assert AGG["Номенклатура.На ТО"] == "INVALID"

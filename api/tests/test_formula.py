"""Формулы Airtable: разбор и вычисление. Семантика снята с at_computed реальной базы (план 1б-2b)."""
from datetime import date, datetime, timezone

import pytest

from migrate.formula import evaluate, parse, to_api

TODAY = date(2026, 10, 31)


def ev(src, **fields):
    """Вычислить формулу; {name} в тексте — поле name из fields."""
    return evaluate(parse(src), lambda f: fields.get(f), TODAY)


def test_precedence_and_concat():
    assert ev("1 + 2 * 3") == 7
    assert ev("(1 + 2) * 3") == 9
    assert ev("-2 * 3") == -6
    assert ev('{a} & " " & {b}', a=2025, b=9) == "2025 9"          # число в строке без «.0»
    assert ev('{a} & "_" & {b}', a=0.05, b="x") == "0.05_x"
    assert ev("1 + 2 & 3") == "33"                                  # & слабее +


def test_js_numbers():
    assert ev("{a}/{b}", a=5, b=0) == float("inf")
    assert to_api(ev("{a}/{b}", a=5, b=0), "number") == {"specialValue": "Infinity"}
    assert to_api(ev("{a}/{b}", a=0, b=0), "number") == {"specialValue": "NaN"}
    assert to_api(ev("{a}/{b}", a=None, b=None), "number") == {"specialValue": "NaN"}   # пусто = 0
    assert to_api(ev("YEAR({d})"), "number") == {"specialValue": "NaN"}
    assert ev('YEAR({d}) & " " & MONTH({d})') == "NaN NaN"
    assert ev("{a} - {b}", a=5, b=None) == 5
    assert ev("{n} * {p}", n=2, p=[3.5]) == 7                       # lookup из одного значения


def test_blank_and_if():
    assert ev("IF({d} = BLANK(), BLANK(), YEAR({d}))") is None
    assert ev("IF({d} = BLANK(), BLANK(), YEAR({d}))", d=date(2021, 5, 1)) == 2021
    assert ev("IF({x} = BLANK(), 1, 2)", x=0) == 1                  # 0 = BLANK() — истина в Airtable
    assert ev("IF({x} = BLANK(), 1, 2)", x="") == 1
    assert ev("IF({x} = BLANK(), 1, 2)", x=[]) == 1
    assert ev("IF({x} > 0, 1, 2)", x=None) == 2
    assert ev("IF(OR({a} = BLANK(), {b} = BLANK()), 1, 2)", a=1, b=None) == 1
    assert ev('IF({t} = "Договор", "Д", "ДС")', t="Договор") == "Д"


def test_dates():
    d = date(2023, 12, 18)
    assert ev("DATETIME_FORMAT({d}, 'DD-MM-YYYY')", d=d) == "18-12-2023"
    assert ev("DATETIME_FORMAT({d}, 'DDMM') & \"/\" & DATETIME_FORMAT({d}, 'YY')", d=d) == "1812/23"
    assert ev("DATETIME_FORMAT(SET_LOCALE({d}, 'ru'), 'MMMM')", d=d) == "Декабрь"
    assert ev("DATETIME_FORMAT({d}, 'GGGG')", d=date(2021, 1, 1)) == "2020"     # ISO-год недели
    assert ev("DATETIME_FORMAT({d}, 'DD-MM-YYYY')", d="2021-01-05") == "05-01-2021"  # дата из at_computed
    assert ev("DATETIME_FORMAT({d}, 'DD-MM-YYYY')", d=["2021-01-05"]) == "05-01-2021"  # lookup
    assert ev("YEAR({d})", d=datetime(2020, 12, 31, 20, 0, tzinfo=timezone.utc)) == 2020   # dateTime — по UTC
    assert ev("MONTH({d})", d="2019-02-12T10:50:00.000Z") == 2
    assert ev("DATETIME_DIFF({a}, {b}, 'days') + 1", a=date(2021, 3, 10), b=date(2021, 3, 1)) == 10
    assert ev("DATETIME_DIFF({a}, {b}, 'minutes') / 60",
              a=datetime(2021, 1, 2, 6, 30, tzinfo=timezone.utc),
              b=datetime(2021, 1, 1, 6, 0, tzinfo=timezone.utc)) == 24.5
    assert ev("DATETIME_DIFF('08-01-2023', '12-31-2020', 'month')") == 31
    assert ev("DATETIME_DIFF(TODAY(), {d}, 'days')", d=date(2026, 10, 1)) == 30
    assert to_api(ev("DATETIME_DIFF(TODAY(), {d}, 'days')"), "number") == {"specialValue": "NaN"}
    assert to_api(ev("TODAY()"), "date") == "2026-10-31"
    assert ev("MONTH(NOW())") == 10


def test_text_functions():
    assert ev('CONCATENATE({a}, "_", {b})', a=["ЮПО_1"], b="Т3") == "ЮПО_1_Т3"
    assert ev('{f} & "_" & LEFT({i}, 1) & "."', f="Иванов", i="Пётр") == "Иванов_П."
    assert ev("LEFT({i}, 1)") == ""
    assert ev("{a} & \">>\" & {b}", a=["X", "Y"], b=None) == "X, Y>>"    # список — через «, »
    sw = "SWITCH({x}, 'A', '1', 'B', '2')"
    assert ev(sw, x="B") == "2"
    assert ev(sw, x="C") is None
    assert ev("SWITCH({x}, 1, 'Январь', 2, 'Февраль')", x=2) == "Февраль"
    assert ev("SWITCH({x}, 1, 'a', 'дефолт')", x=5) == "дефолт"


def test_roundup():
    assert ev("ROUNDUP({x} * 3, 0)", x=0.34) == 2
    assert ev("ROUNDUP({x}, 0)", x=-1.2) == -2      # от нуля
    assert ev("ROUNDUP({x}, 1)", x=1.21) == 1.3


def test_multiline_and_unknown():
    assert ev("SWITCH(\n MONTH({d}),\n   1,'Январь',\n   2,'Февраль'\n)", d=date(2020, 2, 3)) == "Февраль"
    with pytest.raises(ValueError):
        parse("FOO(1)")


def test_errors_and_special_inputs():
    from migrate.formula import ERROR
    # ошибка Airtable: DATETIME_FORMAT от пустого, дата из многозначного lookup, ошибка во входе
    assert ev("DATETIME_FORMAT({d}, 'DD-MM-YYYY') & \"_\" & {n}", n=28) is ERROR
    assert ev("YEAR({d})", d=["2021-12-07", "2023-06-05"]) is ERROR
    assert ev("{x} & \"!\"", x={"error": "#ERROR!"}) is ERROR
    assert to_api(ERROR, "singleLineText") == {"error": "#ERROR!"}
    # NaN/Infinity из at_computed — числа
    assert ev('{a} & " " & {b}', a={"specialValue": "NaN"}, b="") == "NaN "
    assert to_api(ev("{a} + 1", a={"specialValue": "Infinity"}), "number") == {"specialValue": "Infinity"}


def test_link_names_with_quotes_csv_quoted():
    # в строке имя из поля-связи с « " » Airtable берёт в кавычки, кавычки удваивает; у lookup текста — нет
    from migrate.formula import LinkCell
    assert ev('{a} & "-"', a=LinkCell(['Резистивиметр 4.75"_№_830'])) == '"Резистивиметр 4.75""_№_830"-'
    assert ev('"" & {a}', a=LinkCell(["UTMC", '4 3/4" PONY'])) == 'UTMC, "4 3/4"" PONY"'
    assert ev('{a} & "_№_"', a=['Pin-Pin 4 3/4"']) == 'Pin-Pin 4 3/4"_№_'

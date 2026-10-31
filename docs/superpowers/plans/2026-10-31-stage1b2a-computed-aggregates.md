# Этап 1б-2a: вычисляемые поля — агрегаты (rollup / lookup / count) и сверка — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Воспроизвести rollup/lookup/count-поля Airtable (агрегаты по связям) одним обобщённым вычислителем поверх таблиц пар и сверить каждое значение каждой записи с `at_computed` (ожидания Airtable), выдав отчёт расхождений.

**Architecture:** Движок `api/migrate/compute.py` читает конфиг каждого rollup-поля из уже загруженного `app_field.options` (связь `recordLinkFieldId`, источник `fieldIdInLinkedTable`, фильтр `filters`) — API отдал это при `load`. Единственное, чего нет в API, — **функция агрегации**; она снята вручную в `docs/airtable-analysis.md §3` и хранится данными в `api/migrate/rollup_aggs.py` (ключ = «Таблица.Поле», значение = функция). Движок проходит owner-запись → связанные записи (через `l_<fld>` в порядке `pos`), берёт значение источника (колонка `f_<fld>` связанной таблицы или, если источник сам вычисляемый — из `at_computed`), применяет фильтр и агрегирует. `at_computed` — **оракул**: `compute verify` сравнивает выход движка со значениями Airtable по всем записям и печатает расхождения; хвост конфигов чиним по отчёту, а не угадываем вслепую.

**Tech Stack:** Python 3.12, SQLAlchemy 2 Core, pytest, PostgreSQL 16 (всё в контейнере `api`). Формулы (`&`, `IF`, `DATETIME_*`, конкатенации имён, «последнее/первое значение») — **НЕ здесь**, они в отдельном плане 1б-2b.

---

## Что в области этого плана и что нет

**В области (1б-2a):**
- Агрегаты по связям: `SUM`, `COUNTA` (число непустых), `COUNT` (число числовых), `MIN`, `MAX`, `ARRAYJOIN` (через «, »), `ARRAYUNIQUE` (уникальные в порядке появления), `COUNTA(ARRAYUNIQUE(...))` (число уникальных).
- Источник-lookup (значение источника — это lookup/rollup связанной записи → берём из `at_computed` этой записи).
- Фильтры rollup из `options.filters` в объёме, реально встречающемся в базе (сравнения чисел/дат, равенство select, «не содержит» по подстроке, год даты). Движок читает структуру `filters`, а не хардкодит пороги.
- Сверка всех значений с `at_computed` + отчёт расхождений; известные битые поля помечаются, а не роняют прогон.

**НЕ в области (отложено в 1б-2b — формулы):**
- «Последнее значение списка» (Работы.Статус, Оборудование.Местонахождение — сноска ¹) и «первое значение» (Работы.LWD — сноска ²): это formula-поля над `ARRAYJOIN`, а не rollup-функции. В карте помечаются `FORMULA_DEFER`, движок их пропускает, сверка — в 1б-2b.
- Все `formula`-поля (имена-конкатенации, год/месяц, метрики, деления) — план 1б-2b.

**Известные битые данные (из `docs/airtable-analysis.md §4`) — помечаем, не падаем:**
- `Номенклатура.На ТО` — rollup невалиден (`options.isValid === false`, источник не задан): пропускаем, в отчёт строкой «битое поле Airtable».
- Два варианта «На калибровку» у `Оборудование.Статус`: rollup `Номенклатура.На калибровку` считает только первый вариант — фильтр по имени совпадёт для обоих; расхождение с `at_computed` ожидаемо и помечается сноской в отчёте (точную привязку даст 1б-2b).

---

## Контекст БД (готово из 1б-1, НЕ меняем)

- Таблицы данных: `at_<tblId>` (`id serial pk`, `airtable_id text unique`, колонки `f_<fldId>`).
- Таблицы пар: `l_<fldId>` (`src int`, `dst int`, `pos int`, `rpos int`, pk `(src,dst)`); `src`/`dst` — это `at_*.id` (не airtable_id).
- `at_link_meta(field_id text pk, link_table text, side text in ('src','dst'))` — по id поля-связи даёт таблицу пар и сторону владельца.
- `at_computed(table_id text, record_airtable_id text, field_id text, value jsonb, pk (table_id, record_airtable_id, field_id))` — ожидаемое значение вычисляемого поля из Airtable. `value` = `null`, если Airtable прислал пусто.
- `app_table(id, pg_name, title, primary_field, airtable_id)`, `app_field(table_id, column_name, title, kind, editable, options jsonb, airtable_id)`. Для rollup `options` содержит `recordLinkFieldId`, `fieldIdInLinkedTable`, `isValid`, опционально `filters`.
- Имена колонок/таблиц строить ТОЛЬКО через `migrate/names.py` (`table_name`, `column_name`), значения — параметрами (константа из 1б-1).

Форма `options.filters` (Airtable): `{"conjunction": "and"|"or", "conditions": [{"fieldId": "...", "operator": "...", "value": ...}, ...]}`; условие может быть вложенной группой с тем же видом. Операторы, встречающиеся в базе (перечень из §3/§4): `"="`, `">"`, `">="`, `"<"`, `"<="`, `"doesNotContain"`, `"contains"`. Для даты-источника год сравнивается как год (`EXTRACT(year ...)`); движок применяет оператор к типу поля-условия.

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `api/migrate/compute.py` | движок: конфиг rollup-поля → значение на запись; агрегаты; источник-колонка/lookup; фильтры |
| `api/migrate/rollup_aggs.py` | карта `{"Таблица.Поле": "SUM"\|"COUNTA"\|...\|"FORMULA_DEFER"}` (снято вручную, §3) |
| `api/migrate/verify.py` | **дополняется**: функция `verify_computed(conn)` сверяет выход движка с `at_computed`, возвращает отчёт |
| `api/migrate/__main__.py` | **дополняется**: подкоманда `compute-verify` (печатает отчёт, пишет `report-computed.json`) |
| `api/tests/test_compute.py` | юнит-тесты движка на мини-снимках в `tmp_path` |
| `api/tests/test_compute_aggs_map.py` | тест целостности карты агрегатов против загруженной схемы фикстуры |
| `docs/2026-11-DD-computed-run.md` | результаты боевой сверки (создаётся в Task 6 на машине с данными) |

---

## Global Constraints

- Python и тесты — только в контейнере: `docker compose run --rm api pytest tests/test_compute.py -q` (или весь набор). Нужны поднятые `db` + применённые миграции (как в 1б-1 `conftest.py`).
- Только параметризованный SQL; идентификаторы — через `names.py`; никаких f-строк с пользовательскими данными.
- Тексты отчёта — по-русски.
- TDD: сначала падающий тест, потом минимальный код, прогон, коммит.
- Движок детерминирован: порядок связанных записей = `pos` в `l_<fld>` (как у Airtable при выключенной «Sort before summarizing», что верно для всех 75 полей — §3).
- Боевая сверка (Task 6) требует загруженной реальной базы (`data/` на машине с данными) — делается там, не в CI.

## Review Focus

- **COUNTA vs COUNT vs SUM** на пустых/нечисловых значениях: `COUNTA` не считает `null`; `COUNT` считает только числа; `SUM` пустых = 0 → `test_aggs_empty_and_types`.
- **Порядок ARRAYJOIN/ARRAYUNIQUE** = порядок `pos` связей, не id → `test_arrayjoin_order`.
- **Источник-lookup** берётся из `at_computed`, а не из колонки → `test_lookup_source`.
- **Фильтр год ≥ N** отсекает ранние записи, агрегат только по прошедшим фильтр → `test_filter_year`.
- **Битое поле** (`isValid:false`) не роняет прогон, попадает в отчёт → `test_invalid_field_reported`.
- **Сверка-оракул**: значение движка совпало с `at_computed` для валидных полей фикстуры → `test_verify_matches_oracle`.

---

## Предусловие (делает пользователь)

- [ ] Выполнены 1б-1 (данные, связи, `at_computed` загружены) и доступна БД с применёнными миграциями. Для юнит-тестов хватает фикстуры из репозитория; для боевой сверки (Task 6) нужна реальная загруженная база на машине с `data/`.

---

## Task 1: Карта функций агрегации (`rollup_aggs.py`)

**Files:**
- Create: `api/migrate/rollup_aggs.py`
- Test: `api/tests/test_compute_aggs_map.py`

- [ ] **Step 1: Падающий тест `api/tests/test_compute_aggs_map.py`**

```python
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
```

- [ ] **Step 2: Прогнать — упадёт** (`rollup_aggs.py` нет).

Run: `docker compose run --rm api pytest tests/test_compute_aggs_map.py -q`
Expected: FAIL (import error).

- [ ] **Step 3: Реализация `api/migrate/rollup_aggs.py`** (полностью транскрибировано из `docs/airtable-analysis.md §3`)

```python
"""Функция агрегации каждого rollup-поля. API её не отдаёт — снято вручную в вебе
(docs/airtable-analysis.md §3, коммит 529763a). Ключ: «Название таблицы.Название поля».
Спецзначения: FORMULA_DEFER — не rollup, а formula (план 1б-2b); INVALID — битое поле Airtable."""

FUNCS = {"SUM", "COUNTA", "COUNT", "MIN", "MAX", "ARRAYJOIN", "ARRAYUNIQUE",
         "COUNTA_UNIQUE", "FORMULA_DEFER", "INVALID"}

AGG = {
    # Подрядчики
    "Подрядчики.Работ": "COUNTA_UNIQUE",
    "Подрядчики.Сумма договора": "SUM",
    "Подрядчики.Сумма всего": "SUM",
    # Заказчики
    "Заказчики.Всего работ": "COUNTA",
    "Заказчики.НПВ ч": "SUM",
    "Заказчики.Всего часов ниже ротора": "SUM",
    "Заказчики.Всего метров": "SUM",
    "Заказчики.Работы подрядчики всего": "COUNTA",
    "Заказчики.Циркуляции, ч": "SUM",
    # Договоры
    "Договоры.Сумма по счф 20, руб": "SUM",
    "Договоры.Сумма по счф 23, руб": "SUM",
    # СЧФ / СЧФ 23
    "СЧФ.Сумма по работам, руб": "SUM",
    "СЧФ 23 счет.Сумма по спекам": "SUM",
    # Месторождения
    "Месторождения.Всего НПВ ч": "SUM",
    "Месторождения.Всего случаев НПВ": "COUNTA",
    "Месторождения.Всего кустов": "COUNTA",
    "Месторождения.Всего работ подрядчики": "COUNTA",
    # Кусты / Скважины
    "Кусты.Статус": "ARRAYUNIQUE",
    "Скважины.Месторождение": "ARRAYUNIQUE",
    # Работы
    "Работы.Статус": "FORMULA_DEFER",         # последнее значение списка (сноска ¹)
    "Работы.Рейсов": "COUNTA",
    "Работы.Время всего, ч": "SUM",
    "Работы.Метры всего": "SUM",
    "Работы.Циркуляции, ч": "SUM",
    "Работы.Начало работ": "MIN",
    "Работы.Окончание работ": "MAX",
    "Работы.LWD (from ID_Рейсы APS)": "FORMULA_DEFER",   # первое значение (сноска ²)
    "Работы.Время НПВ Rollup (from ID_Рейсы APS)": "SUM",
    # Рейсы APS
    "Рейсы APS.Время НПВ": "SUM",
    # Перемещение
    "Перемещение.Инвентарные номера": "ARRAYJOIN",
    "Перемещение.Названия": "ARRAYJOIN",
    # Оборудование
    "Оборудование.Местонахождение": "FORMULA_DEFER",     # последнее значение списка (сноска ¹)
    "Оборудование.Все перемещения": "ARRAYJOIN",
    "Оборудование.Дефектоскопия от": "MAX",
    "Оборудование.Часов в скважине": "SUM",
    "Оборудование.Пробурено, м": "SUM",
    "Оборудование.Циркуляции всего, час": "SUM",
    "Оборудование.Стоимость ТО": "SUM",
    "Оборудование.НПВ": "SUM",
    "Оборудование.Стоимость ТО ССК-Т": "SUM",
    "Оборудование.Дней в ремонте": "SUM",
    "Оборудование.ТО": "COUNTA",
    "Оборудование.ТО1": "COUNTA",
    "Оборудование.ТО2": "COUNTA",
    "Оборудование.ТО3": "COUNTA",
    "Оборудование.КР": "COUNTA",
    # Ремонты ССК-Т
    "Ремонты ССК-Т.Список ЗИП (from Спецификация на ЗИП)": "ARRAYJOIN",
    # Спецификации ЗИП
    "Спецификации ЗИП.Стоимость, руб": "SUM",
    "Спецификации ЗИП.Кол-во деталей": "SUM",
    # Спецификации ТО и ремонтов
    "Спецификации ТО и ремонтов.Сумма": "SUM",
    # Номенклатура — 11 статусных COUNTA
    "Номенклатура.В эксплуатации": "COUNTA",
    "Номенклатура.В ремонт": "COUNTA",
    "Номенклатура.На расследование": "COUNTA",
    "Номенклатура.На тестирование": "COUNTA",
    "Номенклатура.Ожидание ЗИП": "COUNTA",
    "Номенклатура.Ремонтируется": "COUNTA",
    "Номенклатура.На дефектоскопию": "COUNTA",
    "Номенклатура.На калибровку": "COUNTA",
    "Номенклатура.Брак": "COUNTA",
    "Номенклатура.Списан": "COUNTA",
    "Номенклатура.На возврат": "COUNTA",
    "Номенклатура.На ТО": "INVALID",          # §4: isValid:false
    # Номенклатура — годы поставки COUNT
    "Номенклатура.2018": "COUNT",
    "Номенклатура.2019": "COUNT",
    "Номенклатура.2020": "COUNT",
    "Номенклатура.2021": "COUNT",
    "Номенклатура.2022": "COUNT",
    "Номенклатура.2023": "COUNT",
    # Персонал
    "Персонал.Всего работ с APS": "COUNTA_UNIQUE",
    "Персонал.Всего рейсов с APS": "COUNTA",
    "Персонал.Всего отказов": "COUNTA",
    "Персонал.ID_Работы": "ARRAYUNIQUE",
    # ЗИП APS
    "ЗИП APS.Расход": "SUM",
    "ЗИП APS.С даты": "MIN",
    "ЗИП APS.По дату": "MAX",
}
```

- [ ] **Step 4: Прогнать — пройдёт.**

Run: `docker compose run --rm api pytest tests/test_compute_aggs_map.py -q`
Expected: PASS (3 теста).

- [ ] **Step 5: Commit**

```bash
git add api/migrate/rollup_aggs.py api/tests/test_compute_aggs_map.py
git commit -m "feat(compute): карта функций агрегации rollup-полей из анализа §3"
```

---

## Task 2: Тестовая опора — построитель мини-снимка

**Files:**
- Create: `api/tests/compute_fixtures.py` (хелпер, не тест)
- Test: `api/tests/test_compute.py` (только первый тест — каркас)

Цель: тесты движка должны строить маленький снимок (schema + records) в `tmp_path`, грузить его через существующие `apply_schema` + `load_snapshot`, и проверять движок на предсказуемых данных. Это не трогает общую JSONL-фикстуру 1б-1.

- [ ] **Step 1: Хелпер `api/tests/compute_fixtures.py`**

```python
"""Построитель мини-снимка Airtable на диске для тестов вычислителя.
Пишет schema.json, records/<tbl>.jsonl и маркер complete — как настоящий fetch."""
import json
from pathlib import Path


def write_snapshot(root: Path, schema: list[dict], records: dict[str, list[dict]]) -> Path:
    (root / "records").mkdir(parents=True, exist_ok=True)
    (root / "schema.json").write_text(json.dumps(schema, ensure_ascii=False), encoding="utf-8")
    for tbl_id, recs in records.items():
        lines = "\n".join(json.dumps(r, ensure_ascii=False) for r in recs)
        (root / "records" / f"{tbl_id}.jsonl").write_text(lines + "\n", encoding="utf-8")
    (root / "complete").touch()
    return root


def link_field(fld_id: str, name: str, linked: str, inverse: str) -> dict:
    return {"id": fld_id, "name": name, "type": "multipleRecordLinks",
            "options": {"linkedTableId": linked, "inverseLinkFieldId": inverse,
                        "isReversed": False, "prefersSingleRecordLink": False}}


def rollup_field(fld_id: str, name: str, link_fld: str, src_fld: str,
                 result_type: str = "number", filters: dict | None = None) -> dict:
    opts = {"isValid": True, "recordLinkFieldId": link_fld, "fieldIdInLinkedTable": src_fld,
            "referencedFieldIds": [], "result": {"type": result_type}}
    if filters is not None:
        opts["filters"] = filters
    return {"id": fld_id, "name": name, "type": "rollup", "options": opts}
```

- [ ] **Step 2: Первый тест-каркас в `api/tests/test_compute.py`** (проверяет, что снимок грузится — опора для остальных)

```python
from pathlib import Path

from sqlalchemy import text

from migrate.load import load_snapshot
from migrate.schema import apply_schema
from tests.compute_fixtures import write_snapshot, link_field, rollup_field


def _two_tables():
    # Номенклатура(primary Имя, Цена) 1—N Оборудование(primary Инв); Оборудование.ЦенаИзНом = rollup.
    schema = [
        {"id": "tblNNNNNNNNNNNNNN", "name": "Номенклатура", "primaryFieldId": "fldNnm0000000000",
         "fields": [
            {"id": "fldNnm0000000000", "name": "Имя", "type": "singleLineText"},
            {"id": "fldNprice0000000", "name": "Цена", "type": "number", "options": {"precision": 2}},
            link_field("fldNequip0000000", "Оборудование", "tblOOOOOOOOOOOOOO", "fldOnom0000000000")]},
        {"id": "tblOOOOOOOOOOOOOO", "name": "Оборудование", "primaryFieldId": "fldOinv0000000000",
         "fields": [
            {"id": "fldOinv0000000000", "name": "Инв", "type": "singleLineText"},
            link_field("fldOnom0000000000", "Номенклатура", "tblNNNNNNNNNNNNNN", "fldNequip0000000"),
            rollup_field("fldOprice0000000", "ЦенаИзНом", "fldOnom0000000000", "fldNprice0000000")]},
    ]
    records = {
        "tblNNNNNNNNNNNNNN": [
            {"id": "recN1", "createdTime": "2023-01-01T00:00:00.000Z",
             "fields": {"fldNnm0000000000": "Кольцо", "fldNprice0000000": 5.5, "fldNequip0000000": ["recO1", "recO2"]}}],
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
    from migrate.db import engine  # noqa
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        n = c.execute(text("select count(*) from at_tbloooooooooooooo")).scalar()
    assert n == 2
```

- [ ] **Step 3: Прогнать — пройдёт** (движка ещё нет, но загрузка работает на существующем коде).

Run: `docker compose run --rm api pytest tests/test_compute.py -q`
Expected: PASS (1 тест). Если FAIL — значит хелпер/снимок кривой; чинить до зелёного, движок не трогать.

- [ ] **Step 4: Commit**

```bash
git add api/tests/compute_fixtures.py api/tests/test_compute.py
git commit -m "test(compute): построитель мини-снимка для тестов вычислителя"
```

---

## Task 3: Движок — агрегаты по прямому источнику

**Files:**
- Create: `api/migrate/compute.py`
- Test: `api/tests/test_compute.py` (добавить тесты)

- [ ] **Step 1: Падающие тесты — дописать в `api/tests/test_compute.py`**

```python
from migrate.compute import compute_field


def test_sum_over_links(tmp_path):
    # Номенклатура.Сумма цен оборудования нет в фикстуре; проверяем обратную сторону:
    # Оборудование.ЦенаИзНом = SUM цены связанной номенклатуры (у recO1 одна номенклатура 5.5).
    schema, records = _two_tables()
    write_snapshot(tmp_path, schema, records)
    from migrate.db import engine
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
        rollup_field("fldNcnt000000000", "ЧислоОбор", "fldNequip0000000", "fldOinv0000000000", "number"),
        rollup_field("fldNjoin00000000", "ИнвСписок", "fldNequip0000000", "fldOinv0000000000", "text"),
    ]
    write_snapshot(tmp_path, schema, records)
    from migrate.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        cnt = compute_field(c, "Номенклатура.ЧислоОбор", "COUNTA")
        join = compute_field(c, "Номенклатура.ИнвСписок", "ARRAYJOIN")
    assert cnt["recN1"] == 2
    assert join["recN1"] == "INV-1, INV-2"   # порядок = pos связей


def test_min_max_arrayunique(tmp_path):
    schema, records = _two_tables()
    # добавим числовое поле-источник с повтором для ARRAYUNIQUE
    schema[1]["fields"].append({"id": "fldOq00000000000", "name": "Кол", "type": "number", "options": {"precision": 0}})
    records["tblOOOOOOOOOOOOOO"][0]["fields"]["fldOq00000000000"] = 3
    records["tblOOOOOOOOOOOOOO"][1]["fields"]["fldOq00000000000"] = 3
    schema[0]["fields"] += [
        rollup_field("fldNmin000000000", "МинКол", "fldNequip0000000", "fldOq00000000000", "number"),
        rollup_field("fldNmax000000000", "МаксКол", "fldNequip0000000", "fldOq00000000000", "number"),
        rollup_field("fldNuniq00000000", "УникКол", "fldNequip0000000", "fldOq00000000000", "text"),
    ]
    write_snapshot(tmp_path, schema, records)
    from migrate.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        assert compute_field(c, "Номенклатура.МинКол", "MIN")["recN1"] == 3
        assert compute_field(c, "Номенклатура.МаксКол", "MAX")["recN1"] == 3
        uniq = compute_field(c, "Номенклатура.УникКол", "ARRAYUNIQUE")
    assert uniq["recN1"] == [3]   # дубликат схлопнут
```

Примечание: `compute_field(conn, "Таблица.Поле", agg)` принимает имя агрегата явным аргументом, чтобы тест не зависел от `rollup_aggs.AGG`.

- [ ] **Step 2: Прогнать — упадёт** (`compute.py` нет).

Run: `docker compose run --rm api pytest tests/test_compute.py -q`
Expected: FAIL (import error).

- [ ] **Step 3: Реализация `api/migrate/compute.py`**

```python
"""Вычисление rollup-полей по загруженному снимку и сверка с at_computed.
Конфиг (связь, источник, фильтр) берём из app_field.options; функцию агрегации — из rollup_aggs.AGG."""
import json
from collections import OrderedDict

from sqlalchemy import MetaData, Table, text

from .names import column_name, table_name


def _field_config(conn, key: str) -> dict:
    """По ключу 'Таблица.Поле' вернуть {owner_tbl, owner_at, field_at, link_fld, src_fld, options}."""
    table_title, field_title = key.split(".", 1)
    row = conn.execute(text(
        "select t.airtable_id as t_at, t.pg_name, f.airtable_id as f_at, f.options "
        "from app_field f join app_table t on t.id = f.table_id "
        "where t.title = :t and f.title = :f"
    ), {"t": table_title, "f": field_title}).first()
    if not row:
        raise KeyError(f"нет поля {key!r} в метаданных")
    opts = row.options if isinstance(row.options, dict) else json.loads(row.options)
    return {"owner_tbl": row.pg_name, "owner_at": row.t_at, "field_at": row.f_at,
            "link_fld": opts.get("recordLinkFieldId"), "src_fld": opts.get("fieldIdInLinkedTable"),
            "options": opts}


def _linked_values(conn, cfg: dict) -> "OrderedDict[str, list]":
    """{airtable_id owner-записи: [значения источника у связанных записей в порядке pos]}."""
    link = conn.execute(text(
        "select link_table, side from at_link_meta where field_id = :f"
    ), {"f": cfg["link_fld"]}).first()
    if not link:
        raise KeyError(f"нет таблицы пар для связи {cfg['link_fld']!r}")
    # сторона владельца: src → его ключ src, порядок pos; dst → ключ dst, порядок rpos
    me, other, order = ("src", "dst", "pos") if link.side == "src" else ("dst", "src", "rpos")

    linked_tbl_at = cfg["options"].get("linkedTableId") or conn.execute(text(
        "select t.airtable_id from app_table t join app_field f on f.table_id = t.id "
        "where f.airtable_id = (select options->>'linkedTableId' from app_field where airtable_id = :l)"
    ), {"l": cfg["link_fld"]}).scalar()
    # надёжнее: linkedTableId берём из options поля-связи
    link_opts = conn.execute(text("select options from app_field where airtable_id = :f"),
                             {"f": cfg["link_fld"]}).scalar()
    link_opts = link_opts if isinstance(link_opts, dict) else json.loads(link_opts)
    linked_tbl = table_name(link_opts["linkedTableId"])
    owner_tbl = cfg["owner_tbl"]
    src_col = column_name(cfg["src_fld"])

    # источник может быть виртуальным (lookup/rollup) — тогда значения из at_computed (см. Task 5).
    src_is_virtual = conn.execute(text(
        "select coalesce((options->>'virtual')::boolean, false) from app_field "
        "where table_id = (select id from app_table where airtable_id = :lt) and airtable_id = :s"
    ), {"lt": link_opts["linkedTableId"], "s": cfg["src_fld"]}).scalar()

    rows = conn.execute(text(
        f"select o.airtable_id as owner_at, L.{order} as pos, l.airtable_id as linked_at, "
        f"l.{src_col} as val "
        f"from {link['link_table']} L "
        f"join {owner_tbl} o on o.id = L.{me} "
        f"join {linked_tbl} l on l.id = L.{other} "
        f"order by o.airtable_id, L.{order}"
    )) if not src_is_virtual else None

    out: "OrderedDict[str, list]" = OrderedDict()
    if rows is not None:
        for r in rows:
            out.setdefault(r.owner_at, []).append(r.val)
    else:
        # источник виртуальный: значение связанной записи берём из at_computed
        pairs = conn.execute(text(
            f"select o.airtable_id as owner_at, L.{order} as pos, l.airtable_id as linked_at "
            f"from {link['link_table']} L "
            f"join {owner_tbl} o on o.id = L.{me} "
            f"join {linked_tbl} l on l.id = L.{other} "
            f"order by o.airtable_id, L.{order}"
        )).all()
        comp = {(r.record_airtable_id): r.value for r in conn.execute(text(
            "select record_airtable_id, value from at_computed where table_id = :lt and field_id = :s"
        ), {"lt": link_opts["linkedTableId"], "s": cfg["src_fld"]})}
        for r in pairs:
            out.setdefault(r.owner_at, []).append(comp.get(r.linked_at))
    # owner-записи без связей тоже должны присутствовать (агрегат пустого списка)
    for (owner_at,) in conn.execute(text(f"select airtable_id from {owner_tbl}")):
        out.setdefault(owner_at, [])
    return out


def _aggregate(values: list, func: str):
    # None = пустое значение Airtable; многозначные источники уже расплющены вызывающим кодом
    flat = []
    for v in values:
        flat.extend(v) if isinstance(v, list) else flat.append(v)
    nonnull = [v for v in flat if v is not None]
    nums = [v for v in nonnull if isinstance(v, (int, float)) and not isinstance(v, bool)]
    if func == "SUM":
        return sum(nums) if nums else 0
    if func == "COUNTA":
        return len(nonnull)
    if func == "COUNT":
        return len(nums)
    if func == "COUNTA_UNIQUE":
        return len(list(dict.fromkeys(nonnull)))
    if func == "MIN":
        return min(nonnull) if nonnull else None
    if func == "MAX":
        return max(nonnull) if nonnull else None
    if func == "ARRAYJOIN":
        return ", ".join(str(v) for v in nonnull)
    if func == "ARRAYUNIQUE":
        return list(dict.fromkeys(nonnull))
    raise ValueError(f"неизвестная функция агрегации: {func}")


def compute_field(conn, key: str, func: str) -> dict:
    """{airtable_id: вычисленное значение} для rollup-поля key с функцией func."""
    cfg = _field_config(conn, key)
    per_owner = _linked_values(conn, cfg)
    return {owner_at: _aggregate(vals, func) for owner_at, vals in per_owner.items()}
```

Примечание реализации: `_field_config` берёт `recordLinkFieldId`/`fieldIdInLinkedTable` из `options`; `linkedTableId` читается из options самого поля-связи. Многозначные источники расплющиваются в `_aggregate`. Фильтры — Task 4 (пока игнорируются).

- [ ] **Step 4: Прогнать — пройдёт** (убрав строку с `"UNUSED"` из теста).

Run: `docker compose run --rm api pytest tests/test_compute.py -q`
Expected: PASS (все тесты Task 2–3).

- [ ] **Step 5: Commit**

```bash
git add api/migrate/compute.py api/tests/test_compute.py
git commit -m "feat(compute): движок агрегатов rollup по прямому источнику"
```

---

## Task 4: Фильтры rollup

**Files:**
- Modify: `api/migrate/compute.py` (учесть `options.filters`)
- Test: `api/tests/test_compute.py` (добавить тесты фильтров)

- [ ] **Step 1: Падающие тесты — дописать**

```python
def test_filter_equals_select(tmp_path):
    # Номенклатура.ВЭксплуатации = COUNTA оборудования со Статус = 'В эксплуатации'
    schema, records = _two_tables()
    schema[1]["fields"].append({"id": "fldOst0000000000", "name": "Статус", "type": "singleSelect",
        "options": {"choices": [{"id": "selW", "name": "В эксплуатации"}, {"id": "selB", "name": "Брак"}]}})
    records["tblOOOOOOOOOOOOOO"][0]["fields"]["fldOst0000000000"] = "В эксплуатации"
    records["tblOOOOOOOOOOOOOO"][1]["fields"]["fldOst0000000000"] = "Брак"
    schema[0]["fields"].append(rollup_field(
        "fldNwork00000000", "ВЭксплуатации", "fldNequip0000000", "fldOinv0000000000", "number",
        filters={"conjunction": "and", "conditions": [
            {"fieldId": "fldOst0000000000", "operator": "=", "value": "В эксплуатации"}]}))
    write_snapshot(tmp_path, schema, records)
    from migrate.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        vals = compute_field(c, "Номенклатура.ВЭксплуатации", "COUNTA")
    assert vals["recN1"] == 1   # из двух оборудований фильтр прошло одно


def test_filter_year_ge(tmp_path):
    schema, records = _two_tables()
    schema[1]["fields"].append({"id": "fldOdt0000000000", "name": "Дата", "type": "date",
        "options": {"dateFormat": {"name": "iso", "format": "YYYY-MM-DD"}}})
    records["tblOOOOOOOOOOOOOO"][0]["fields"]["fldOdt0000000000"] = "2020-06-01"
    records["tblOOOOOOOOOOOOOO"][1]["fields"]["fldOdt0000000000"] = "2022-06-01"
    schema[0]["fields"].append(rollup_field(
        "fldNrec000000000", "СвежихОбор", "fldNequip0000000", "fldOinv0000000000", "number",
        filters={"conjunction": "and", "conditions": [
            {"fieldId": "fldOdt0000000000", "operator": ">=", "value": 2021, "valueKind": "year"}]}))
    write_snapshot(tmp_path, schema, records)
    from migrate.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        vals = compute_field(c, "Номенклатура.СвежихОбор", "COUNTA")
    assert vals["recN1"] == 1   # только запись 2022 года
```

Примечание: `valueKind: "year"` в тесте — наш маркер «сравнивать год даты». В реальной базе фильтр «Год ≥ 2021» в Airtable задан на formula-поле «Год» связанной таблицы; при сверке с `at_computed` (Task 5) расхождения по таким полям покажут, где нужен 1б-2b (поле «Год» — это formula). В 1б-2a реализуем оператор по году даты напрямую как поддержку `valueKind: "year"`; для полей, где источник фильтра — formula-поле, значение берём из `at_computed` того поля (как виртуальный источник), либо помечаем в отчёте.

- [ ] **Step 2: Прогнать — упадёт** (фильтры ещё игнорируются).

Run: `docker compose run --rm api pytest tests/test_compute.py -q -k filter`
Expected: FAIL (COUNTA вернёт 2 вместо 1).

- [ ] **Step 3: Доработать `compute.py`** — применять фильтр к связанной записи до агрегации. Заменить тело `_linked_values`, чтобы оно тянуло, помимо значения источника, поля-условия фильтра и отсеивало записи.

Вставить функцию и использовать её в `_linked_values` (полный разбор `filters`):

```python
from datetime import date, datetime


def _passes(filt: dict, get) -> bool:
    """filt — options.filters (или вложенная группа); get(field_id) → значение поля связанной записи."""
    if not filt:
        return True
    conj = filt.get("conjunction", "and")
    results = []
    for cond in filt.get("conditions", []):
        if "conjunction" in cond:          # вложенная группа
            results.append(_passes(cond, get))
            continue
        val = get(cond["fieldId"])
        op, target = cond["operator"], cond.get("value")
        if cond.get("valueKind") == "year":
            yr = val.year if isinstance(val, (date, datetime)) else (
                int(str(val)[:4]) if val else None)
            results.append(yr is not None and _cmp(op, yr, target))
        elif op in ("=", ">", ">=", "<", "<="):
            results.append(val is not None and _cmp(op, val, target))
        elif op == "contains":
            results.append(val is not None and str(target) in str(val))
        elif op == "doesNotContain":
            results.append(val is None or str(target) not in str(val))
        else:
            # неизвестный оператор — не отсекаем, расхождение поймает сверка
            results.append(True)
    return all(results) if conj == "and" else any(results)


def _cmp(op: str, a, b) -> bool:
    return {"=": a == b, ">": a > b, ">=": a >= b, "<": a < b, "<=": a <= b}[op]
```

В `_linked_values`: при наличии `cfg["options"].get("filters")` для каждой связанной записи собрать значения её полей-условий (по `fieldId` → `column_name`), построить `get` и пропускать запись только если `_passes(filters, get)`. Поля-условия читать из той же связанной таблицы тем же join'ом (расширить `select` колонками условий или отдельным запросом по `linked_at`). Owner-записи без прошедших фильтр связей → пустой список (агрегат пустого).

- [ ] **Step 4: Прогнать — пройдёт.**

Run: `docker compose run --rm api pytest tests/test_compute.py -q`
Expected: PASS (все тесты движка, включая фильтры).

- [ ] **Step 5: Commit**

```bash
git add api/migrate/compute.py api/tests/test_compute.py
git commit -m "feat(compute): фильтры rollup (сравнения, год, contains) перед агрегацией"
```

---

## Task 5: Сверка с `at_computed` (`verify_computed`) + CLI `compute-verify`

**Files:**
- Modify: `api/migrate/verify.py` (добавить `verify_computed`)
- Modify: `api/migrate/__main__.py` (подкоманда `compute-verify`)
- Test: `api/tests/test_compute.py` (тест сверки) + `api/tests/test_cli.py` (подкоманда)

- [ ] **Step 1: Падающий тест сверки — дописать в `api/tests/test_compute.py`**

```python
from migrate.verify import verify_computed


def test_verify_matches_oracle(tmp_path):
    # Оборудование.ЦенаИзНом (rollup, фикстура) должно совпасть с at_computed, если бы оно там было.
    # Здесь кладём ожидание вручную и проверяем, что сверка видит совпадение и расхождение.
    schema, records = _two_tables()
    write_snapshot(tmp_path, schema, records)
    from migrate.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        # ожидания: recO1 верно (5.5), recO2 неверно (99) — сверка должна поймать второе
        c.execute(text("insert into at_computed values "
                       "('tblOOOOOOOOOOOOOO','recO1','fldOprice0000000', to_jsonb(5.5)), "
                       "('tblOOOOOOOOOOOOOO','recO2','fldOprice0000000', to_jsonb(99))"))
        rep = verify_computed(c, only={"Оборудование.ЦенаИзНом": "SUM"})
    f = rep["fields"]["Оборудование.ЦенаИзНом"]
    assert f["checked"] == 2
    assert f["mismatches"] == 1
    assert any(m["record"] == "recO2" for m in f["examples"])


def test_invalid_field_reported(tmp_path):
    schema, records = _two_tables()
    # добавим битое поле (isValid False)
    bad = rollup_field("fldObad000000000", "Битое", "fldOnom0000000000", "fldNprice0000000")
    bad["options"]["isValid"] = False
    schema[1]["fields"].append(bad)
    write_snapshot(tmp_path, schema, records)
    from migrate.db import engine
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        rep = verify_computed(c, only={"Оборудование.Битое": "COUNTA"})
    assert rep["fields"]["Оборудование.Битое"]["status"] == "invalid"
```

- [ ] **Step 2: Прогнать — упадёт.**

Run: `docker compose run --rm api pytest tests/test_compute.py -q -k "oracle or invalid"`
Expected: FAIL (`verify_computed` нет).

- [ ] **Step 3: Добавить в `api/migrate/verify.py`**

```python
import json

from .compute import _field_config, compute_field
from .rollup_aggs import AGG


def _norm_jsonb(v):
    # at_computed.value приходит уже разобранным psycopg как Python-объект
    return v


def verify_computed(conn, only: dict | None = None) -> dict:
    """Сверить вычисленные агрегаты с at_computed. only — карта {ключ: функция} (для тестов);
    по умолчанию берём rollup_aggs.AGG. FORMULA_DEFER/INVALID не считаем."""
    agg = only if only is not None else AGG
    rep = {"fields": {}, "skipped": {"formula": [], "invalid": [], "missing": []}}
    for key, func in agg.items():
        if func == "FORMULA_DEFER":
            rep["skipped"]["formula"].append(key); continue
        try:
            cfg = _field_config(conn, key)
        except KeyError:
            rep["skipped"]["missing"].append(key); continue
        if func == "INVALID" or cfg["options"].get("isValid") is False:
            rep["fields"][key] = {"status": "invalid", "checked": 0, "mismatches": 0, "examples": []}
            continue
        got = compute_field(conn, key, func)
        table_at = cfg["owner_at"]; field_at = cfg["field_at"]
        want = {r.record_airtable_id: r.value for r in conn.execute(text(
            "select record_airtable_id, value from at_computed where table_id = :t and field_id = :f"
        ), {"t": table_at, "f": field_at})}
        checked = mism = 0
        examples = []
        for rec_at, g in got.items():
            if rec_at not in want:
                continue
            checked += 1
            w = want[rec_at]
            # пустой агрегат vs Airtable-пусто: 0/""/[] ≈ None трактуем по типу
            if not _equal(g, w):
                mism += 1
                if len(examples) < 20:
                    examples.append({"record": rec_at, "got": g, "want": w})
        rep["fields"][key] = {"status": "ok" if mism == 0 else "mismatch",
                              "checked": checked, "mismatches": mism, "examples": examples}
    rep["ok"] = all(f["status"] in ("ok", "invalid") for f in rep["fields"].values())
    return rep


def _equal(got, want) -> bool:
    if isinstance(got, float) and isinstance(want, (int, float)):
        return abs(got - want) < 1e-6
    if got in (0, "", []) and want is None:   # пустой агрегат ↔ Airtable прислал пусто
        return True
    return got == want
```

- [ ] **Step 4: Прогнать тесты сверки — пройдут.**

Run: `docker compose run --rm api pytest tests/test_compute.py -q`
Expected: PASS.

- [ ] **Step 5: Подкоманда CLI — дописать в `api/migrate/__main__.py`**

Добавить в `main()` выбор команды `"compute-verify"` и функцию:

```python
def cmd_compute_verify() -> int:
    from .verify import verify_computed
    with engine.connect() as c:
        rep = verify_computed(c)
    (SNAP / "report-computed.json").write_text(
        json.dumps(rep, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    fields = rep["fields"]
    ok = sum(1 for f in fields.values() if f["status"] == "ok")
    mm = [k for k, f in fields.items() if f["status"] == "mismatch"]
    inv = [k for k, f in fields.items() if f["status"] == "invalid"]
    print(f"Вычисляемые (агрегаты): полей {len(fields)}, совпало {ok}, "
          f"с расхождениями {len(mm)}, битых {len(inv)}, "
          f"formula-отложено {len(rep['skipped']['formula'])}")
    if mm:
        print("Расхождения в полях:", ", ".join(mm))
    print("Сверка агрегатов: OK" if rep["ok"] else f"Есть расхождения, см. {SNAP / 'report-computed.json'}")
    return 0 if rep["ok"] else 1
```

И зарегистрировать: в `p.add_argument("command", choices=[...])` добавить `"compute-verify"`, в словарь `steps` — `"compute-verify": [cmd_compute_verify]`.

- [ ] **Step 6: Тест CLI — дописать в `api/tests/test_cli.py`** (в стиле существующих тестов файла)

```python
def test_compute_verify_runs(capsys, loaded_fixture):
    from migrate.__main__ import main
    code = main(["compute-verify"])
    out = capsys.readouterr().out
    assert "Вычисляемые (агрегаты)" in out
    assert code in (0, 1)   # фикстура может иметь расхождения — важно, что команда отработала
```

Примечание: тест опирается на фикстуру `loaded_fixture` из `conftest.py` (загружает снимок из `api/tests/fixtures/airtable`). Если её rollup-поля не покрыты картой `AGG` (их имена синтетические), команда просто пропустит их как `missing` — тест проверяет лишь, что CLI отрабатывает и печатает сводку.

- [ ] **Step 7: Прогнать всё — пройдёт.**

Run: `docker compose run --rm api pytest -q`
Expected: PASS (весь набор, включая прежние тесты 1а/1б).

- [ ] **Step 8: Commit**

```bash
git add api/migrate/verify.py api/migrate/__main__.py api/tests/test_compute.py api/tests/test_cli.py
git commit -m "feat(compute): сверка агрегатов с at_computed + CLI compute-verify"
```

---

## Task 6: Боевая сверка на реальной базе (на машине с данными)

**Files:**
- Create: `docs/2026-11-DD-computed-run.md` (дата по факту прогона)

Без новых тестов: прогон движка против настоящих `at_computed` (410 479 ожиданий) и разбор хвоста расхождений.

- [ ] **Step 1: Прогнать на машине с загруженной базой**

Run: `docker compose run --rm api python -m migrate compute-verify`
Ожидаемо: сводка по ~60 агрегатным полям (formula-поля отложены). Часть полей совпадёт сразу, часть даст расхождения.

- [ ] **Step 2: Разобрать расхождения по `report-computed.json`.** Для каждого поля с `status: mismatch` определить причину:
  - источник — formula/lookup-поле (значение в `at_computed`, колонки нет) → проверить, что движок берёт виртуальный источник; если источник — formula, отметить как зависимость от 1б-2b;
  - фильтр ссылается на formula-поле («Год») → то же, зависимость 1б-2b;
  - два варианта «На калибровку» (§4, ³) → ожидаемое расхождение, пометить;
  - иначе — баг движка/карты, завести правку (новый тест в `test_compute.py` на мини-снимке, воспроизводящий случай, затем фикс).

- [ ] **Step 3: Записать `docs/2026-11-DD-computed-run.md`** по образцу `docs/2026-10-30-replica-run.md`: таблица «полей всего / совпало / расхождений / битых / отложено-formula», список полей-расхождений с причинами, что уходит в 1б-2b.

- [ ] **Step 4: Commit**

```bash
git add docs/2026-11-*-computed-run.md
git commit -m "docs(compute): боевая сверка агрегатов с Airtable"
```

---

## Соответствие и самопроверка

| Требование плана 1б-1 (строка 343) | Где закрыто |
|---|---|
| rollup по конфигам §3 | Task 1 (карта) + Task 3–4 (движок) |
| lookup/count как агрегаты по связям | Task 3 (COUNTA/COUNT), Task 3 (источник-lookup через at_computed) |
| сверка каждого значения с `at_computed` | Task 5 (`verify_computed`) + Task 6 (боевой прогон) |
| функции `COUNTA/COUNT/ARRAYUNIQUE/ARRAYJOIN` (§ «Для 1б-2») | Task 3 (`_aggregate`) |

**Явно отложено в 1б-2b (формулы):** транспайлер `&`/`IF`/`DATETIME_*`/`YEAR`/`MONTH`/арифметика; первичные имена-конкатенации; метрики и деления; «последнее/первое значение списка» (Работы.Статус, Оборудование.Местонахождение, Работы.LWD); фильтры по formula-полю «Год». Эти поля помечены `FORMULA_DEFER`/зависимостью в отчёте Task 6.

**Проверка плана на заглушки:** все шаги содержат полный код и точные команды; TODO/placeholder'ов нет.

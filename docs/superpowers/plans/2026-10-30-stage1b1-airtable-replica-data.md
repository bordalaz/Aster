# Этап 1б-1: копия базы Airtable — схема, данные, связи, вложения — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести базу Airtable `appPaeBP8t3Ri5Lfn` один в один — все 27 таблиц со всеми полями (включая мусорные), значениями, связями и вложениями — в PostgreSQL, с повторяемым запуском и отчётом сверки.

**Architecture:** Инструмент `api/migrate/` в контейнере `api`, три шага: `fetch` (Airtable API → снимок на диске: схема, записи JSONL, вложения), `load` (снимок → таблицы PostgreSQL + `app_table`/`app_field`), `verify` (снимок ↔ PostgreSQL → `report.json`). Имена таблиц и колонок — из id Airtable (`at_tbl…`, `f_fld…`), русские названия — в метаданных; так переименование в Airtable и мусорные имена ничего не ломают. Связи — отдельные таблицы пар, вычисляемые поля Airtable (formula/lookup/rollup/count) в этом плане сохраняются как **ожидаемые значения** в `at_computed` для сверки в плане 1б-2.

**Tech Stack:** Python 3.12, httpx 0.28 (уже в requirements), SQLAlchemy 2 Core, Alembic, pytest, PostgreSQL 16.

**Spec:** `specs/aster.md` (R8, R35–R37, E21, Constraints); решение пользователя 2026-10-30: «сначала копия один в один, мусорные поля как есть» (`docs/retro`, memory). Каркас: `docs/superpowers/plans/2026-10-28-stage1a-backend.md`.

## Global Constraints

- Airtable API: не больше **5 запросов/с** на базу; при `429` — пауза **30 с** и повтор.
- Ссылки на вложения живут ~2 ч → качать **сразу** после получения страницы записей.
- Токен Airtable — только из переменной `AIRTABLE_TOKEN`; не пишется в лог, снимок, отчёт, git.
- Снимок и файлы содержат реальные данные (ФИО, email) → каталог `data/` в `.gitignore`.
- Только параметризованный SQL. Идентификаторы (имена таблиц/колонок) собираются только из id Airtable, прошедших проверку `^(tbl|fld)[A-Za-z0-9]{14}$`; иначе — `ValueError`.
- Повторный запуск `load` на непустую базу: обновление по `airtable_id`, дублей нет (E21).
- Python и тесты — только в контейнере: `docker compose run --rm api pytest …`.
- Тексты для пользователя (CLI, отчёт) — по-русски.

## Review Focus

- **Повторный запуск `load`** — ни одной лишней строки записей, связей, вложений; изменённые в Airtable значения обновились → тест `test_load_twice_no_duplicates` (Task 4).
- **429 от Airtable посреди выгрузки** — пауза 30 с и продолжение с той же страницы, без потери записей → `test_retry_on_429` (Task 2).
- **Связь на запись, которой нет в снимке** (удалена/нет доступа) — пропускается и считается в отчёте, загрузка не падает → `test_dangling_link_counted` (Task 4).
- **Запись удалили в Airtable после прошлой загрузки** — в PostgreSQL остаётся, в отчёте «есть у нас, нет в Airtable», ничего не удаляем молча → `test_verify_reports_extra_rows` (Task 5).
- **Поле с пустым значением** (Airtable не присылает пустые поля) — NULL; у checkbox — `false` → `test_missing_checkbox_is_false` (Task 4).

---

## Предусловие (делает пользователь)

- [ ] Выполнен план 1а целиком (compose, БД, вход, метаданные, API записей): Task 4 этого плана правит `api/app/records.py` из 1а.
- [ ] Создан Personal Access Token Airtable: scopes `data.records:read`, `schema.bases:read`, доступ только к базе `appPaeBP8t3Ri5Lfn`. Вписан в `.env` строкой `AIRTABLE_TOKEN=…` (файл в git не попадает). Claude токен не видит и не просит.

## Структура файлов

| Файл | Ответственность |
|---|---|
| `api/migrations/versions/0002_replica.py` | служебные таблицы копии: `attachment`, `at_computed`, `at_link_meta` |
| `api/migrate/names.py` | проверка id Airtable и имена PG (`table_name`, `column_name`, `link_table_name`) |
| `api/migrate/airtable.py` | клиент Airtable: схема, записи постранично, скачивание вложений, лимит 5/с, повтор на 429 |
| `api/migrate/snapshot.py` | `fetch`: снимок на диск (`schema.json`, `records/<tbl>.jsonl`, `files/<att>`) |
| `api/migrate/schema.py` | типы полей → колонки PG; DDL таблиц и связей; заполнение `app_table`/`app_field` |
| `api/migrate/load.py` | `load`: записи, связи, вложения, ожидаемые вычисляемые значения |
| `api/migrate/verify.py` | `verify`: сверка снимка и БД → `report.json` |
| `api/migrate/__main__.py` | CLI `python -m migrate fetch|load|verify|all` |
| `api/tests/fixtures/airtable/` | маленький искусственный снимок: 3 таблицы со всеми типами полей |
| `api/tests/test_migrate_*.py` | тесты по модулям |
| `docker-compose.yml`, `.env.example`, `.gitignore` | том `./data:/data`, `AIRTABLE_TOKEN`, `data/` в игнор |

## Соответствие типов (решение плана)

| Тип Airtable | Хранение в PG | Значение из API → PG |
|---|---|---|
| singleLineText, multilineText, richText, email, url, phoneNumber | `text` | как есть |
| number, currency, percent, rating, duration | `numeric` | как есть (duration — секунды) |
| autoNumber | `integer` | как есть |
| checkbox | `boolean not null default false` | нет в ответе → `false` |
| date | `date` | `YYYY-MM-DD` |
| dateTime, createdTime, lastModifiedTime | `timestamptz` | ISO 8601 |
| singleSelect | `text` | имя варианта; варианты с цветами → `app_field.options.choices` |
| multipleSelects | `text[]` | список имён |
| barcode, createdBy, lastModifiedBy | `jsonb` | объект как есть |
| multipleRecordLinks | таблица пар `l_<fld>` (`src`, `dst`, `pos`), колонки нет | список id записей |
| multipleAttachments | строки в `attachment`, колонки нет | список вложений |
| formula, rollup, multipleLookupValues, count | колонки нет; значение → `at_computed` | как есть (jsonb) — для сверки в 1б-2 |
| button | колонки нет; конфиг → `app_field.options` | — |
| неизвестный тип | `jsonb` + предупреждение в отчёте | как есть |

Связи Airtable двусторонние (поле и его `inverseLinkFieldId`). Таблица пар создаётся **одна на пару**: по полю с меньшим id; второе поле в `app_field` ссылается на ту же таблицу с `options.side = "dst"`. Связь без обратного поля (односторонняя) — своя таблица.

---

### Task 1: Служебные таблицы копии и имена PG

**Files:**
- Create: `api/migrations/versions/0002_replica.py`, `api/migrate/__init__.py`, `api/migrate/names.py`, `api/tests/test_migrate_names.py`
- Modify: `docker-compose.yml` (у `api`: `volumes: [./api:/app, ./data:/data]`, `environment: AIRTABLE_TOKEN: ${AIRTABLE_TOKEN:-}`), `.env.example` (строка `AIRTABLE_TOKEN=`), `.gitignore` (строка `data/`)

**Interfaces:**
- Produces: `check_id(x: str, prefix: Literal["tbl","fld"]) -> str`; `table_name(tbl_id) -> str` (`"at_" + id.lower()`); `column_name(fld_id) -> str` (`"f_" + id.lower()`); `link_table_name(fld_id) -> str` (`"l_" + id.lower()`). Таблицы `attachment(id serial pk, table_id text, record_airtable_id text, field_id text, pos int, airtable_att_id text unique, filename text, mime text, size bigint, path text)`, `at_computed(table_id text, record_airtable_id text, field_id text, value jsonb, primary key (table_id, record_airtable_id, field_id))`, `at_link_meta(field_id text primary key, link_table text not null, side text not null check (side in ('src','dst')))`.

- [ ] **Step 1: Падающие тесты** `api/tests/test_migrate_names.py`

```python
import pytest
from migrate.names import check_id, table_name, column_name, link_table_name

def test_names():
    assert table_name("tbl1ZvKeatrUCpH3s") == "at_tbl1zvkeatrucph3s"
    assert column_name("fldUasUu4p7xcskLH") == "f_flduasuu4p7xcsklh"
    assert link_table_name("fldmGqgYrdh8QXdJ0") == "l_fldmgqgyrdh8qxdj0"

@pytest.mark.parametrize("bad", ["tbl1; drop table x", "fldUasUu4p7xcskLH", "tbl123", "", "tbl1ZvKeatrUCpH3s "])
def test_bad_table_id_rejected(bad):
    with pytest.raises(ValueError):
        check_id(bad, "tbl")

def test_replica_tables_exist():
    from sqlalchemy import inspect
    from app.db import engine
    assert {"attachment", "at_computed", "at_link_meta"} <= set(inspect(engine).get_table_names())
```

- [ ] **Step 2: Запустить — падает**

Run: `docker compose run --rm api pytest -q tests/test_migrate_names.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'migrate'`.

- [ ] **Step 3: Реализовать** `names.py` (regex `^(tbl|fld)[A-Za-z0-9]{14}$`, префикс должен совпасть) и миграцию `0002_replica.py` (`down_revision = "0001"`, три `create table` из Interfaces, `downgrade` — `drop`).

- [ ] **Step 4: Тесты проходят**

Run: `docker compose run --rm api pytest -q`
Expected: все PASS.

- [ ] **Step 5: Commit**

```bash
git add api/migrations/versions/0002_replica.py api/migrate api/tests/test_migrate_names.py docker-compose.yml .env.example .gitignore
git commit -m "feat(migrate): replica service tables and safe PG names"
```

---

### Task 2: Клиент Airtable

**Files:**
- Create: `api/migrate/airtable.py`, `api/tests/test_migrate_airtable.py`

**Interfaces:**
- Produces: `class AirtableClient(token: str, base_id: str, *, rate: float = 5.0, transport: httpx.BaseTransport | None = None, sleep=time.sleep)` с методами `schema() -> list[dict]` (`GET /v0/meta/bases/{base}/tables`, ключ `tables`), `pages(table_id: str) -> Iterator[list[dict]]` (`GET /v0/{base}/{table}?pageSize=100&returnFieldsByFieldId=true&cellFormat=json`, по `offset`), `download(url: str, dest: Path) -> int` (байты; пишет во временный файл и переименовывает). Заголовок `Authorization: Bearer <token>`. Ошибка ≠ 2xx/429 → `RuntimeError` с кодом и путём запроса, **без токена в тексте**.

- [ ] **Step 1: Падающие тесты** — через `httpx.MockTransport`, `sleep` подменяется списком задержек:

```python
def test_pages_follow_offset():          # 2 ответа: {"records":[a], "offset":"x"}, {"records":[b]} → [[a],[b]]; второй запрос содержит offset=x
def test_fields_by_id_requested():       # в запросе returnFieldsByFieldId=true
def test_rate_limit_spacing():           # 6 запросов подряд → сумма задержек sleep ≥ 1.0 с (не больше 5/с)
def test_retry_on_429():                 # ответы 429, затем 200 → одна задержка 30, данные получены, запрос повторён с тем же offset
def test_error_has_no_token():           # ответ 401 → RuntimeError; "secret-token" нет в str(err)
def test_download_atomic(tmp_path):      # ответ b"abc" → файл dest = b"abc", возвращает 3, временных файлов в tmp_path не осталось
```

- [ ] **Step 2: Запустить — падает**

Run: `docker compose run --rm api pytest -q tests/test_migrate_airtable.py`
Expected: FAIL — `ImportError`.

- [ ] **Step 3: Реализовать `AirtableClient`** — интервал между запросами `1 / rate` (учёт времени последнего запроса, `time.monotonic`), один `httpx.Client` на экземпляр.

- [ ] **Step 4: Тесты проходят**

Run: `docker compose run --rm api pytest -q tests/test_migrate_airtable.py`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add api/migrate/airtable.py api/tests/test_migrate_airtable.py
git commit -m "feat(migrate): Airtable client with rate limit and 429 retry"
```

---

### Task 3: Снимок на диск (`fetch`)

**Files:**
- Create: `api/migrate/snapshot.py`, `api/tests/test_migrate_snapshot.py`, `api/tests/fixtures/airtable/schema.json`, `api/tests/fixtures/airtable/records/*.jsonl`

**Interfaces:**
- Consumes: `AirtableClient` (Task 2).
- Produces: `fetch_snapshot(client: AirtableClient, out: Path) -> dict[str, int]` — пишет `out/schema.json` (как вернул `schema()`), `out/records/<tbl>.jsonl` (одна запись — одна строка, `{"id","createdTime","fields"}`), вложения в `out/files/<attId>` (имя файла — **только id вложения**, без исходного имени); возвращает `{tbl_id: число_записей}`. Вложение, у которого файл уже есть с тем же размером, не качается повторно. Вложения качаются сразу после каждой страницы.
- Фикстура (используется Tasks 4–5): 3 таблицы — `tblAAAAAAAAAAAAAA` «Номенклатура» (singleLineText, number, singleSelect с 2 вариантами), `tblBBBBBBBBBBBBBB` «Оборудование» (formula, checkbox, date, dateTime, multipleSelects, multipleAttachments, lastModifiedBy, multipleRecordLinks → A с inverse, rollup), `tblCCCCCCCCCCCCCC` «Рейсы» (number, multipleRecordLinks → B с inverse, button). 2–3 записи в каждой, одна связь B→A на несуществующую запись `recZZZZZZZZZZZZZZ`. Id полей — 17 символов, формат `fld…`.

- [ ] **Step 1: Падающие тесты** — клиент-заглушка (класс с `schema()`, `pages()`, `download()`), без сети:

```python
def test_snapshot_layout(tmp_path):        # schema.json, records/tbl….jsonl — по строке на запись; возвращает {"tbl…": n}
def test_attachment_saved_by_id(tmp_path): # файл out/files/att… есть; имени "photo.jpg" в путях нет
def test_attachment_not_redownloaded(tmp_path):  # второй fetch → download не вызывается для файла того же размера
def test_attachment_downloaded_per_page(tmp_path): # download вызывается до запроса следующей страницы
```

- [ ] **Step 2: Запустить — падает**

Run: `docker compose run --rm api pytest -q tests/test_migrate_snapshot.py`
Expected: FAIL — `ImportError`.

- [ ] **Step 3: Реализовать `fetch_snapshot`** и записать фикстуру снимка (`schema.json` + `records/*.jsonl` + пустой каталог `files/` с одним файлом вложения) по описанию в Interfaces.

- [ ] **Step 4: Тесты проходят**

Run: `docker compose run --rm api pytest -q tests/test_migrate_snapshot.py`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add api/migrate/snapshot.py api/tests/test_migrate_snapshot.py api/tests/fixtures/airtable
git commit -m "feat(migrate): fetch Airtable snapshot to disk"
```

---

### Task 4: Схема и загрузка (`load`)

**Files:**
- Create: `api/migrate/schema.py`, `api/migrate/load.py`, `api/tests/test_migrate_load.py`
- Modify: `api/app/records.py` (`list_records` берёт только поля, у которых есть колонка: `if f.column_name in t.c`), `api/tests/test_records.py` (тест ниже)

**Interfaces:**
- Consumes: `names.*` (Task 1), фикстура (Task 3), `load_table` / `list_records` из плана 1а Task 6.
- Поля без колонки (link, attachment, formula, rollup, lookup, count, button) пишутся в `app_field` с `column_name = f_<fld>` и `options.virtual = true`.
- Produces:
  - `pg_type(field: dict) -> str | None` — по таблице «Соответствие типов»; `None` для link/attachment/formula/rollup/lookup/count/button.
  - `apply_schema(conn, schema: list[dict]) -> list[str]` — создаёт таблицы `at_<tbl>` (`id serial pk`, `airtable_id text unique not null`, `created_at timestamptz`, колонки `f_<fld>`), недостающие колонки добавляет (`add column if not exists`), таблицы пар `l_<fld>` (`src int references at_… on delete cascade`, `dst int references … on delete cascade`, `pos int`, `primary key (src, dst)`), строки `at_link_meta`; upsert `app_table` (`pg_name`, `title` = имя Airtable, `primary_field` = колонка первичного поля или его id для вычисляемого, `airtable_id`) и `app_field` (`column_name`, `title`, `kind` = тип Airtable, `editable` = `pg_type is not None`, `sort_order` = порядок в схеме, `options` = конфиг поля Airtable, `airtable_id`). Возвращает предупреждения (неизвестные типы).
  - `load_snapshot(conn, snap: Path) -> dict` — upsert записей по `airtable_id` (`insert … on conflict (airtable_id) do update`), затем связи (удалить пары этой записи-источника и вставить заново — так правки в Airtable применяются), вложения (upsert по `airtable_att_id`, `path = "files/<attId>"`), вычисляемые значения в `at_computed` (upsert). Возвращает `{"records": {tbl: n}, "links": n, "dangling_links": n, "attachments": n}`.
  - Порядок загрузки: все таблицы → все записи → все связи (чтобы ссылки на ещё не загруженные записи не терялись).

- [ ] **Step 1: Падающие тесты** (БД тестовая, как в 1а; фикстура из Task 3):

```python
def test_tables_and_columns_created():     # at_tblaaaa… есть; у at_tblbbbb… есть f_<checkbox>, нет колонки для formula/link
def test_metadata_filled():                # app_table 3 строки с русскими title; app_field у formula editable=False; options.choices у singleSelect с цветами
def test_one_link_table_per_pair():        # для связи B→A и обратной A→B — одна таблица l_<меньший id>; at_link_meta содержит обе стороны
def test_values_loaded():                  # date, dateTime, multipleSelects (text[]), lastModifiedBy (jsonb) совпадают с фикстурой
def test_missing_checkbox_is_false():      # запись без поля checkbox → false; без текстового поля → NULL
def test_dangling_link_counted():          # связь на recZZZZZZZZZZZZZZ не вставлена; result["dangling_links"] == 1
def test_computed_saved():                 # at_computed содержит значение formula и rollup для каждой записи фикстуры
def test_load_twice_no_duplicates():       # load дважды → количество строк в каждой at_*, l_*, attachment, at_computed не изменилось
def test_reload_applies_changes(tmp_path): # в копии снимка изменили число и убрали одну связь → после load значение новое, пары нет
def test_bad_id_in_schema_rejected():      # схема с id таблицы "tbl1; drop…" → ValueError, в БД ничего не создано (транзакция)
```

В `api/tests/test_records.py`:
```python
def test_records_skip_virtual_fields(logged, loaded_fixture):  # GET /api/tables/<Оборудование>/records → 200; ключей f_<formula>, f_<link> в ответе нет
```
(`loaded_fixture` — фикстура в `conftest.py`: `apply_schema` + `load_snapshot` по `tests/fixtures/airtable`, возвращает `{tbl_id: app_table.id}`.)

- [ ] **Step 2: Запустить — падает**

Run: `docker compose run --rm api pytest -q tests/test_migrate_load.py`
Expected: FAIL — `ImportError`.

- [ ] **Step 3: Реализовать `pg_type`, `apply_schema`** в `schema.py`. DDL — строки из проверенных имён (`names.*`) и фиксированного словаря типов; значения — только параметрами.

- [ ] **Step 4: Реализовать `load_snapshot`** в `load.py`; всё в одной транзакции (`engine.begin()`).

- [ ] **Step 5: Тесты проходят**

Run: `docker compose run --rm api pytest -q tests/test_migrate_load.py tests/test_records.py`
Expected: все PASS.

- [ ] **Step 6: Commit**

```bash
git add api/migrate/schema.py api/migrate/load.py api/tests/test_migrate_load.py api/app/records.py api/tests/test_records.py api/tests/conftest.py
git commit -m "feat(migrate): create replica schema and load snapshot idempotently"
```

---

### Task 5: Сверка (`verify`) и CLI

**Files:**
- Create: `api/migrate/verify.py`, `api/migrate/__main__.py`, `api/tests/test_migrate_verify.py`

**Interfaces:**
- Consumes: `load_snapshot`, `apply_schema`, `fetch_snapshot`, `AirtableClient`.
- Produces:
  - `verify(conn, snap: Path) -> dict` — по каждой таблице: `airtable` (записей в снимке), `db`, `missing` (id есть в снимке, нет в БД), `extra` (есть в БД, нет в снимке), `value_mismatches` (список `{record, field, airtable, db}` по всем хранимым полям, нормализация: даты к ISO, numeric к float, отсутствующее = NULL, checkbox отсутствующий = false), `links` (пар в снимке / в БД), `attachments` (в снимке / в БД / файлов на диске нет). Итог `ok: bool` — истина, если нет missing, mismatches и потерянных файлов (`extra` — предупреждение, не ошибка).
  - CLI: `python -m migrate fetch` (снимок в `/data/snapshot`, вложения в `/data/snapshot/files`), `load`, `verify` (пишет `/data/snapshot/report.json`, печатает сводку по-русски: «Таблиц 27, записей 40 123/40 123, расхождений значений 0, связей …, вложений …»; код выхода 1, если `ok` ложно), `all` = три подряд. Нет `AIRTABLE_TOKEN` при `fetch` → сообщение «Не задан AIRTABLE_TOKEN в .env» и код 2.

- [ ] **Step 1: Падающие тесты**

```python
def test_verify_clean_after_load():        # load фикстуры → verify ok=True, mismatches пусто, airtable==db по всем таблицам
def test_verify_finds_changed_value():     # после load вручную update одной ячейки → mismatch с этим record/field и обоими значениями, ok=False
def test_verify_reports_extra_rows():      # в БД лишняя запись (удалена в снимке) → extra содержит её id, ok=True, запись не удалена
def test_verify_missing_file():            # удалили файл вложения из files/ → attachments.missing_files == 1, ok=False
def test_cli_without_token(capsys, monkeypatch):  # fetch без AIRTABLE_TOKEN → код 2, текст «Не задан AIRTABLE_TOKEN»
```

- [ ] **Step 2: Запустить — падает**

Run: `docker compose run --rm api pytest -q tests/test_migrate_verify.py`
Expected: FAIL — `ImportError`.

- [ ] **Step 3: Реализовать `verify` и `__main__.py`** (argparse, подкоманды из Interfaces).

- [ ] **Step 4: Все тесты проходят**

Run: `docker compose run --rm api pytest -q`
Expected: все PASS.

- [ ] **Step 5: Commit**

```bash
git add api/migrate/verify.py api/migrate/__main__.py api/tests/test_migrate_verify.py
git commit -m "feat(migrate): verify replica against snapshot, CLI"
```

---

### Task 6: Боевой прогон на базе Airtable (с пользователем)

**Files:**
- Create: `docs/2026-10-30-replica-run.md` (итоги прогона: цифры из отчёта, предупреждения, время)

- [ ] **Step 1: Первый прогон**

Run: `docker compose run --rm api python -m migrate all`
Expected: сводка с 27 таблицами; число записей в Airtable и в БД совпадает (≈ 40 тыс.); `расхождений значений 0`; код выхода 0. Время выгрузки — порядка 10–20 мин из-за лимита 5/с.

- [ ] **Step 2: Повторный прогон — идемпотентность**

Run: `docker compose run --rm api python -m migrate all`
Expected: те же числа; `select count(*)` по 3–4 крупным `at_*` до и после совпадает.

- [ ] **Step 3: Выборочная проверка глазами**

Через `docker compose exec db psql -U bd bd`: открыть 3 записи Оборудования по `airtable_id` из Airtable и сравнить 10 полей с карточкой в Airtable; проверить, что мусорные поля («Оборудование 2…6», «ID_Оборудования copy») перенесены; что оба варианта «На калибровку» встречаются как текст.

- [ ] **Step 4: Записать итоги** в `docs/2026-10-30-replica-run.md` (цифры, предупреждения о неизвестных типах, вопросы).

- [ ] **Step 5: Commit**

```bash
git add docs/2026-10-30-replica-run.md
git commit -m "docs: replica run results"
```

---

## Что дальше (отдельные планы, по порядку)

1. **1б-2 — вычисляемые поля.** Переводчик формул Airtable → SQL (функции, которые реально используются в базе: `&`, `IF`, `DATETIME_FORMAT`, `DATETIME_DIFF`, `YEAR`, `MONTH`, арифметика…), lookup и count — представления по таблицам пар; rollup — по 70 конфигам, уже снятым в Claude Desktop 2026-10-30: `docs/airtable-analysis.md` §3 (коммит 529763a; функция, связь, источник, фильтр, сноски про «последнее значение», битое «На ТО», два «На калибровку»). Сверка: каждое значение каждой записи против `at_computed`.
2. **1б-3 — поведение:** 6 активных автоматизаций (в т.ч. счётчик «Циркуляция после ТО» как в Airtable), кнопки, формы, виды (`app_view` из API видов). Перед планом — снять конфиги кнопок и форм.
3. **1в — интерфейс** (сетка Glide + TanStack по прототипу), чтобы увидеть копию глазами.
4. Затем — реализация `specs/aster.md` по шагам.

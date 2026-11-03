"""Автоматизации Airtable (docs/airtable-inventory/automations) — все в одном списке, управляют админы.

Рабочие:
- «Отправка перемещений на почту SupportMWD» — «Отправляем?» отмечено → письмо (получатели — в настройках);
- «Дефектоскопия по истечении 180 дней» — каждый день в 8:00 (Томск): «Срок НК» = «Истёк» / пусто;
- «Автоматическая наработка» — правка рейса APS → «Циркуляция после ТО» оборудования (в той же транзакции);
- «Сборка->примечание» — статус сборки стал «Текущие»/«Разобрали» → тег «WPR <№>» в примечании оборудования.
Заменены кнопками: ЗИП фото / адрес хранения. Выключенные в Airtable — в списке, без логики.

Срабатывание «запись начала подходить под условие» ставит задание в очередь в транзакции правки;
выполняет его worker() после коммита, каждое — в своей транзакции, с записью в журнал запусков."""
import logging
import re
import threading
import time
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from .db import engine

log = logging.getLogger(__name__)
TZ = ZoneInfo("Asia/Tomsk")   # часовой пояс автоматизаций в Airtable
SYSTEM = {"id": None, "login": "automation", "name": "Автоматизация", "role": "superadmin",
          "finance_access": True, "must_change_password": False}

# state: live — работает у нас; buttons — заменена кнопками; off — выключена в Airtable, логика не перенесена
REGISTRY = [
    {"key": "mail_peremeshcheniya", "title": "Отправка перемещений на почту SupportMWD", "state": "live", "table": "Перемещение",
     "trigger": "Запись «Перемещения» начала подходить под условие: «Отправляем?» отмечено (правка или форма).",
     "action": "Письмо «Было выполнено перемещение: №»: создано, перемещение, инвентарные номера, наименования, транспорт, причина.",
     "note": "Выключена, пока Airtable отправляет те же письма: иначе получатели получат их дважды."},
    {"key": "defektoskopiya", "title": "Дефектоскопия по истечении 180 дней", "state": "live", "table": "Оборудование",
     "trigger": "Каждый день в 8:00 (Томск).", "schedule": (8, 0),
     "action": "Если с последней дефектоскопии прошло больше 180 дней — «Срок НК» = «Истёк», иначе поле очищается."},
    {"key": "narabotka", "title": "Автоматическая наработка", "state": "live", "table": "Рейсы APS",
     "trigger": "Правка рейса APS в полях Статус, ID_Оборудования, Циркуляция, час, Обработан.",
     "action": "Рейс «Закончен» и «Обработан» — часы циркуляции прибавляются оборудованию рейса («Циркуляция после ТО»); "
               "статус сняли — откат."},
    {"key": "sborka_primechanie", "title": "Сборка->примечание", "state": "live", "table": "Сборки APS",
     "trigger": "Статус сборки стал «Текущие» или «Разобрали» (правка или форма).",
     "action": "Резистивиметр сборки № N → всему оборудованию сборки тег «WPR N» в начало «Примечания» (Текущие) или убрать (Разобрали)."},
    {"key": "zip_foto", "title": "Cope&Paste photo ЗИП", "state": "buttons", "table": "ЗИП APS",
     "trigger": "Форма «Добавить фотографии ЗИП».", "action": "Фото — в запись ЗИП.",
     "note": "Заменена кнопкой «Фото+»: фото сразу пишется в запись ЗИП."},
    {"key": "zip_adres", "title": "Cope&Paste адрес хранения ЗИП", "state": "buttons", "table": "ЗИП APS",
     "trigger": "Форма «Добавить адрес хранения ЗИП».", "action": "Стеллаж и полка — в запись ЗИП.",
     "note": "Заменена кнопкой «Адрес+»: стеллаж и полка сразу пишутся в запись ЗИП."},
    {"key": "otchet", "title": "Отчет недельный", "state": "off", "table": "Ремонты ССК-Т",
     "trigger": "Каждый день в 20:00 (Томск).", "action": "Правка записи «Ремонтов» + документ Google Docs.",
     "note": "Выключена в Airtable и сломана; логика не перенесена."},
    {"key": "avto_spec", "title": "Авто спецификация ЗИП", "state": "off", "table": "Ремонты ССК-Т",
     "trigger": "Отправлена «Форма для учета ремонтов».", "action": "Создать спецификацию ЗИП на выполненный ремонт.",
     "note": "Выключена в Airtable; логика не перенесена."},
    {"key": "zamena_steiva", "title": "Automation - Замена стейва", "state": "off", "table": "Спецификации ЗИП",
     "trigger": "«Ремонт» заполнен.", "action": "5 записей в «Ведомость ЗИП».",
     "note": "Выключена в Airtable («Fix configuration»); логика не перенесена."},
]
BY_KEY = {a["key"]: a for a in REGISTRY}


def _cols(c, table_id: int) -> dict:
    return dict(c.execute(text("select title, column_name from app_field where table_id = :t"), {"t": table_id}).all())


def _table(c, title: str):
    return c.execute(text("select id, pg_name from app_table where title = :t"), {"t": title}).first()


def enabled(c, key: str) -> bool:
    return bool(c.execute(text("select enabled from app_automation where key = :k"), {"k": key}).scalar())


def _log(c, rows: list):
    """История с автором NULL — показывается как «Автоматизация»."""
    if rows:
        c.execute(text("insert into app_change (table_id, record_id, column_name, old, new, user_id) "
                       "values (:t, :r, :c, :o, :n, null)")
                  .bindparams(bindparam("o", type_=JSONB), bindparam("n", type_=JSONB)), rows)


def _run_log(c, key: str, ok: bool, message: str, table_id=None, record_id=None):
    c.execute(text("insert into app_automation_run (key, ok, message, table_id, record_id) values (:k, :o, :m, :t, :r)"),
              {"k": key, "o": ok, "m": message[:1000], "t": table_id, "r": record_id})


def _set(c, table_id: int, pg: str, rid: int, col: str, old, new) -> dict:
    c.execute(text(f'update {pg} set "{col}" = :v, updated_at = now(), updated_by = null where id = :i'), {"v": new, "i": rid})
    return {"t": table_id, "r": rid, "c": col, "o": old, "n": new}


# --- срабатывания по правке / форме ---

def after_change(c, table_id: int, record_id: int, changes: list[dict]):
    """Из правки записи и отправки формы, внутри их транзакции. changes — [{c, o, n}] реально изменённых полей."""
    title = c.execute(text("select title from app_table where id = :t"), {"t": table_id}).scalar()
    cols = {ch["c"]: ch for ch in changes}
    if title == "Рейсы APS" and enabled(c, "narabotka"):
        _narabotka_hook(c, table_id, record_id, set(cols))
    tc = None
    if title == "Перемещение":
        tc = _cols(c, table_id)
        ch = cols.get(tc.get("Отправляем?"))
        if ch and ch["n"] is True and ch["o"] is not True:      # начала подходить под условие
            _enqueue(c, "mail_peremeshcheniya", table_id, record_id)
    if title == "Сборки APS":
        tc = _cols(c, table_id)
        ch = cols.get(tc.get("Статус"))
        if ch and ch["n"] in ("Текущие", "Разобрали") and ch["o"] != ch["n"]:
            _enqueue(c, "sborka_primechanie", table_id, record_id)


def _enqueue(c, key: str, table_id: int, record_id: int):
    if enabled(c, key):
        c.execute(text("insert into app_automation_job (key, table_id, record_id) values (:k, :t, :r)"),
                  {"k": key, "t": table_id, "r": record_id})


# --- очередь и расписание ---

MAX_ATTEMPTS = 5   # упавшее задание (исключение: SMTP недоступен и т.п.) повторяется: через 1, 2, 4, 8 мин


def process_jobs(limit: int = 50) -> int:
    """Выполнить задания очереди. Задание заблокировано (skip locked), пока выполняется: второй обработчик
    его не возьмёт; удаляется после выполнения. Упало с исключением — повтор позже, до MAX_ATTEMPTS.
    Ошибка-итог (нет получателей, почта не настроена) — не повторяется. Возвращает число выполненных."""
    n = 0
    for _ in range(limit):
        with engine.begin() as c:
            job = c.execute(text("select id, key, table_id, record_id, attempts from app_automation_job "
                                 "where next_at <= now() order by id limit 1 for update skip locked")).first()
            if job is None:
                return n
            _ok, _msg, crashed = _run(job.key, job.table_id, job.record_id)
            if crashed and job.attempts + 1 < MAX_ATTEMPTS:
                c.execute(text("update app_automation_job set attempts = attempts + 1, "
                               "next_at = now() + make_interval(mins => :m) where id = :i"),
                          {"m": 2 ** job.attempts, "i": job.id})
            else:
                c.execute(text("delete from app_automation_job where id = :i"), {"i": job.id})
        n += 1
    return n


def _run(key: str, table_id=None, record_id=None) -> tuple[bool, str, bool]:
    """Выполнить автоматизацию и записать в журнал; ошибка не роняет вызывающего. Третье — упала ли."""
    try:
        with engine.begin() as c:
            ok, msg = JOBS[key](c, table_id, record_id)
            _run_log(c, key, ok, msg, table_id, record_id)
        return ok, msg, False
    except Exception as e:   # noqa: BLE001 — любая ошибка автоматизации — строка журнала, как в Airtable
        log.exception("автоматизация %s упала", key)
        msg = f"Ошибка: {e}"
        with engine.begin() as c:
            _run_log(c, key, False, msg, table_id, record_id)
        return False, msg, True


def run(key: str, table_id=None, record_id=None) -> tuple[bool, str]:
    ok, msg, _ = _run(key, table_id, record_id)
    return ok, msg


def due(now: datetime, hour: int, minute: int) -> bool:
    """Сегодня (по Томску) время планового запуска уже наступило."""
    local = now.astimezone(TZ)
    return (local.hour, local.minute) >= (hour, minute)


def claim(key: str, now: datetime) -> bool:
    """Занять сегодняшний плановый запуск: один update — атомарно, даже при нескольких процессах API."""
    with engine.begin() as c:
        return c.execute(text("update app_automation set last_scheduled = :d where key = :k and enabled "
                              "and (last_scheduled is null or last_scheduled < :d) returning key"),
                         {"d": now.astimezone(TZ).date(), "k": key}).first() is not None


def tick(now: datetime | None = None):
    now = now or datetime.now(TZ)
    process_jobs()
    for a in REGISTRY:
        if a.get("schedule") and due(now, *a["schedule"]) and claim(a["key"], now):
            run(a["key"])


def worker(stop: threading.Event, every: float = 5):
    """Фоновый поток API: очередь — раз в несколько секунд, расписание — по времени."""
    while not stop.wait(every):
        try:
            tick()
        except Exception:   # noqa: BLE001 — поток не должен умирать (БД перезапускается и т.п.)
            log.exception("обработчик автоматизаций")
            time.sleep(every)


# --- «Автоматическая наработка» (дословно, в транзакции правки) ---

TRIPS, EQUIP = "Рейсы APS", "Оборудование"
WATCH = ("Статус", "ID_Оборудования", "Циркуляция, час", "Обработан")
DONE = "Закончен"


def _narabotka_hook(c, table_id: int, record_id: int, changed: set):
    tables = dict(c.execute(text("select title, id from app_table where title in (:a, :b)"), {"a": TRIPS, "b": EQUIP}).all())
    if tables.get(TRIPS) != table_id or EQUIP not in tables:
        return
    tc = _cols(c, table_id)
    if not changed & {tc.get(n) for n in WATCH}:
        return
    msg = _narabotka(c, table_id, tables[EQUIP], record_id, tc)
    if msg:
        _run_log(c, "narabotka", True, msg, table_id, record_id)


def _narabotka(c, trip_table: int, equip_table: int, rid: int, tc: dict) -> str | None:
    t_pg = c.execute(text("select pg_name from app_table where id = :t"), {"t": trip_table}).scalar()
    e_pg = c.execute(text("select pg_name from app_table where id = :t"), {"t": equip_table}).scalar()
    st, circ, ok, added = (tc["Статус"], tc["Циркуляция, час"], tc["Обработан"], tc["Добавлено в оборудование"])
    trip = c.execute(text(f'select "{st}" st, "{circ}" circ, "{ok}" ok, "{added}" added from {t_pg} where id = :i'),
                     {"i": rid}).first()
    link = c.execute(text("select m.link_table, m.side from at_link_meta m join app_field f on f.airtable_id = m.field_id "
                          "where f.table_id = :t and f.title = 'ID_Оборудования'"), {"t": trip_table}).first()
    if not link:
        return None
    mine, other = ("src", "dst") if link.side == "src" else ("dst", "src")
    equip = c.execute(text(f"select {other} from {link.link_table} where {mine} = :i order by {other}"), {"i": rid}).scalars().all()
    if not equip:
        return None

    prev_min = round(float(trip.added or 0) * 60)
    was_booked = prev_min > 0
    if trip.st == DONE and trip.ok and trip.circ is not None:          # A) учёт / пересчёт
        delta, new_added = round(float(trip.circ) * 60) - (prev_min if was_booked else 0), trip.circ
    elif was_booked and (trip.st != DONE or not trip.ok):             # B) откат
        delta, new_added = -prev_min, 0
    else:                                                              # C) условий недостаточно
        return None

    after = _cols(c, equip_table)["Циркуляция после ТО"]
    log_rows = []
    for eid in equip:
        cur = c.execute(text(f'select "{after}" from {e_pg} where id = :i for update'), {"i": eid}).scalar()
        cur_min = round(float(cur or 0) / 60)                          # длительность хранится в секундах
        new = max(0, cur_min + delta) * 60
        c.execute(text(f'update {e_pg} set "{after}" = :v, updated_at = now(), updated_by = null where id = :i'),
                  {"v": new, "i": eid})
        log_rows.append({"t": equip_table, "r": eid, "c": after, "o": None if cur is None else float(cur), "n": new})
    c.execute(text(f'update {t_pg} set "{added}" = :v where id = :i'), {"v": new_added, "i": rid})
    if (float(trip.added) if trip.added is not None else None) != float(new_added):
        log_rows.append({"t": trip_table, "r": rid, "c": added,
                         "o": None if trip.added is None else float(trip.added), "n": float(new_added)})
    _log(c, log_rows)
    return f"Оборудованию ({len(equip)}): {'+' if delta >= 0 else '−'}{abs(delta) / 60:g} ч"


# --- «Сборка->примечание» ---

def wpr_note(note: str, tag: str, status: str) -> str | None:
    """Новое примечание или None — не менять (дословно как скрипт Airtable, вкл. обнуление хвоста без «, »)."""
    note = note or ""
    if status == "Текущие":
        return None if note.startswith(tag) else (f"{tag}, {note}" if note else tag)
    if status == "Разобрали":
        if not note.startswith(tag):
            return None
        rest = note[len(tag):]
        return rest[2:] if rest.startswith(", ") else ""
    return None


def _sborka(c, table_id, record_id):
    from .records import list_records
    rec = (list_records(table_id, ids=str(record_id), user=SYSTEM) or [None])[0]
    if rec is None:
        return True, "Сборки нет — пропуск"
    tc = _cols(c, table_id)
    status, equip = rec.get(tc["Статус"]), rec.get(tc["Оборудование"]) or []
    if status not in ("Текущие", "Разобрали") or not equip:
        return True, "Нет оборудования или статус не тот — пропуск"
    num = next((m.group(1) for e in equip if re.search("резистивиметр", e.get("name") or "", re.I)
                for m in [re.search(r"_№_(\d+)", e.get("name") or "", re.I)] if m), None)
    if not num:
        return True, "В сборке нет резистивиметра — пропуск"
    tag = f"WPR {num}"
    eq = _table(c, EQUIP)
    col = _cols(c, eq.id)["Примечание"]
    rows = []
    for e in equip:
        cur = c.execute(text(f'select "{col}" from {eq.pg_name} where id = :i for update'), {"i": e["id"]}).scalar()
        new = wpr_note(cur, tag, status)
        if new is not None and new != (cur or ""):
            rows.append(_set(c, eq.id, eq.pg_name, e["id"], col, cur, new))
    _log(c, rows)
    return True, f"{status}: «{tag}» — изменено примечаний: {len(rows)}"


# --- «Дефектоскопия по истечении 180 дней» ---

def nk_date(v) -> date | None:
    """Последняя дата дефектоскопии из значения поля: дата, «ДД-ММ-ГГГГ…» или список таких."""
    if isinstance(v, list):
        ds = [d for d in (nk_date(x.get("name") if isinstance(x, dict) else x) for x in v) if d]
        return max(ds) if ds else None
    if not isinstance(v, str):
        return None
    if m := re.match(r"^(\d{2})-(\d{2})-(\d{4})", v):
        d, mo, y = map(int, m.groups())
    elif m := re.match(r"^(\d{4})-(\d{2})-(\d{2})", v):
        y, mo, d = map(int, m.groups())
    else:
        return None
    try:
        return date(y, mo, d)
    except ValueError:
        return None


def _defekt(c, _t, _r):
    from . import computed
    from .records import list_records
    eq = _table(c, EQUIP)
    tc = _cols(c, eq.id)
    src, dst = tc["Дефектоскопия от"], tc["Срок НК"]
    computed.settle(20)
    today = datetime.now(TZ).date()
    rows = []
    for rec in list_records(eq.id, user=SYSTEM):
        d = nk_date(rec.get(src))
        if d is None:
            continue
        new = "Истёк" if (today - d).days > 180 else None
        if rec.get(dst) != new:
            rows.append(_set(c, eq.id, eq.pg_name, rec["id"], dst, rec.get(dst), new))
    _log(c, rows)
    return True, f"Изменено «Срок НК»: {len(rows)}"


# --- «Отправка перемещений на почту SupportMWD» ---

def _mail(c, table_id, record_id):
    from . import computed, mail
    from .records import list_records
    s = c.execute(text("select settings from app_automation where key = 'mail_peremeshcheniya'")).scalar() or {}
    to, cc = s.get("to") or [], s.get("cc") or []
    if not to:
        return False, "Не указаны получатели (настройки автоматизации)"
    cfg = mail.smtp_config()
    if cfg is None:
        return False, "Почта не настроена: нужен почтовый сервер (SMTP_HOST, SMTP_FROM в .env)"
    computed.settle(20)
    rec = (list_records(table_id, ids=str(record_id), user=SYSTEM) or [None])[0]
    if rec is None:
        return False, "Записи нет"
    meta = {r.title: dict(r._mapping) for r in c.execute(text(
        "select column_name, title, kind, options from app_field where table_id = :t"), {"t": table_id})}
    val = lambda title: mail.value_text(meta[title], rec.get(meta[title]["column_name"])) if title in meta else ""  # noqa: E731
    number = val("№")
    lines = [("Создано:", val("Когда")), ("Перемещение (Дата: Откуда>>Куда):", number),
             ("Инвентарные номера оборудования:", val("Инвентарные номера")), ("Наименования:", val("Названия")),
             ("Транспорт:", val("Транспорт")), ("Причина:", val("Причина"))]
    import html as h
    body_html = "".join(f"<p><b>{h.escape(k)}</b> {h.escape(v)}</p>" for k, v in lines)
    body_text = "\n".join(f"{k} {v}" for k, v in lines)
    subject = f"Было выполнено перемещение: {number}"
    mail.smtp_send(cfg, subject, s.get("from_name") or "SSCT-1C AT", to, cc, body_text, body_html)
    return True, f"Письмо отправлено: {', '.join(to + cc)}"


JOBS = {"mail_peremeshcheniya": _mail, "defektoskopiya": _defekt, "sborka_primechanie": _sborka}


# --- экран «Автоматизации» (только админы) ---
from fastapi import APIRouter, Depends, HTTPException   # noqa: E402
from pydantic import BaseModel, ConfigDict, Field, field_validator   # noqa: E402

from .auth import admin_user   # noqa: E402

router = APIRouter(prefix="/api")
EMAIL = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$")


@router.get("/automations")
def list_automations(user: dict = Depends(admin_user)):
    with engine.connect() as c:
        state = {r.key: r for r in c.execute(text("select key, enabled, settings from app_automation"))}
        runs = c.execute(text(
            "select key, at, ok, message, table_id, record_id from ("
            " select *, row_number() over (partition by key order by at desc) n from app_automation_run) x "
            "where n <= 20 order by at desc")).all()
    out = []
    for a in REGISTRY:
        s = state.get(a["key"])
        out.append({k: v for k, v in a.items() if k != "schedule"} | {
            "enabled": bool(s and s.enabled), "settings": s.settings if s else {}, "scheduled": bool(a.get("schedule")),
            "runs": [{"at": r.at, "ok": r.ok, "message": r.message, "table_id": r.table_id, "record_id": r.record_id}
                     for r in runs if r.key == a["key"]]})
    return out


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    to: list[str] = Field(default_factory=list, max_length=15)
    cc: list[str] = Field(default_factory=list, max_length=15)
    from_name: str = Field("", max_length=100)

    @field_validator("to", "cc")
    @classmethod
    def _emails(cls, v):
        v = [x.strip() for x in v if x.strip()]
        if bad := [x for x in v if not EMAIL.match(x)]:
            raise ValueError("Неверный адрес: " + ", ".join(bad))
        return v


class Patch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool | None = None
    settings: Settings | None = None


@router.patch("/automations/{key}")
def patch_automation(key: str, body: Patch, user: dict = Depends(admin_user)):
    a = BY_KEY.get(key)
    if a is None or a["state"] != "live":
        raise HTTPException(404, "Нет такой работающей автоматизации")
    if body.settings is not None and key != "mail_peremeshcheniya":
        raise HTTPException(422, "У этой автоматизации нет настроек")
    with engine.begin() as c:
        if body.enabled is not None:
            c.execute(text("update app_automation set enabled = :e where key = :k"), {"e": body.enabled, "k": key})
        if body.settings is not None:
            c.execute(text("update app_automation set settings = :s where key = :k").bindparams(bindparam("s", type_=JSONB)),
                      {"s": body.settings.model_dump(), "k": key})
    log.info("автоматизация %s изменена: %s %s", key, user["login"], body.model_dump(exclude_none=True))
    return {"ok": True}


@router.post("/automations/{key}/run")
def run_now(key: str, user: dict = Depends(admin_user)):
    """«Запустить сейчас» — для автоматизаций по расписанию."""
    a = BY_KEY.get(key)
    if a is None or a["state"] != "live" or not a.get("schedule"):
        raise HTTPException(404, "Запуск вручную — только у автоматизаций по расписанию")
    ok, msg = run(key)
    log.info("автоматизация %s запущена вручную: %s", key, user["login"])
    return {"ok": ok, "message": msg}

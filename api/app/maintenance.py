"""Регламент ТО на данных базы (spec R16–R21): события из таблиц → рекомендации по каждому прибору.
Считается на каждый запрос сетки Оборудования (ничего не хранится, E9: правка рейса задним числом
сразу меняет наработку). Правила — app_maint_rule, правит админ (R17)."""
import datetime as dt
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from . import computed, links
from .access import table_title
from .auth import ADMINS, active_user
from .db import engine
from .calibration import OFF
from .maintenance_rules import Rule, add_months, evaluate, is_base, pipe_flags

router = APIRouter(prefix="/api")

EQ = "Оборудование"
FINISHED = "Закончен"   # ponytail: галочку «Обработан» не учитываем — у 2153 из 2292 законченных рейсов её нет,
                        # и Airtable сам считает циркуляцию по всем рейсам; если галочку начнут ставить — добавить условие
CAL_MONTHS = 12          # R20: калибровка — год
# Вычисляемые колонки сетки Оборудования (R18а, R18б, R21)
FIELDS = [("_need_to", "Нужное ТО"), ("_last_to", "Последнее ТО"), ("_defect", "Дефектоскопия"),
          ("_defect_mark", "На дефектоскопию"), ("_calib", "Калибровка")]


def _to_event(work: str | None) -> str | None:
    m = re.fullmatch(r"ТО Уровень ([123])", (work or "").strip())
    if m:
        return f"ТО-{m.group(1)}"
    return None   # «ТО» без уровня ставят отдельным модулям по необходимости — в регламент уровней не входит


def _table(c, title):
    return c.execute(text("select id, pg_name, airtable_id from app_table where title = :t"), {"t": title}).first()


def _col(c, table_id, title):
    return c.execute(text("select column_name from app_field where table_id = :t and title = :n "
                          "and (options->>'virtual') is null"), {"t": table_id, "n": title}).scalar()


def rules(c) -> list[Rule]:
    return [Rule(r.match, r.kind, r.level, float(r.hours) if r.hours is not None else None, r.months, r.on_arrival,
                 r.resets, r.id)
            for r in c.execute(text("select * from app_maint_rule order by sort_order, id"))]


def _rows(c, title, *cols):
    """Строки таблицы по названиям колонок; нет таблицы или колонки — пусто (регламент рекомендательный)."""
    t = _table(c, title)
    if t is None:
        return None, []
    names = [_col(c, t.id, x) for x in cols]
    if not all(names):
        return t, []
    return t, c.execute(text(f"select id, {', '.join(names)} from {t.pg_name}")).all()


def compute(c, user, today: dt.date | None = None) -> dict[int, dict]:
    """{id прибора: значения вычисляемых колонок + _tone}."""
    today = today or dt.date.today()
    eq = _table(c, EQ)
    nom = _table(c, "Номенклатура")
    events: dict[int, dict[str, list]] = {}
    add = lambda e, k, d: d and events.setdefault(e, {}).setdefault(k, []).append(d)  # noqa: E731

    # рейсы (R16, E8)
    trips: dict[int, list] = {}
    t, rows = _rows(c, "Рейсы APS", "Статус", "Начало", "Конец", "Циркуляция, час")
    trip = {r[0]: r for r in rows if r[1] == FINISHED and r[4]}
    for tr, e in links.pairs(c, t.id, "ID_Оборудования") if t else []:
        r = trip.get(tr)
        if r:
            start = r[2] or r[3]
            trips.setdefault(e, []).append((start.date() if start else dt.date.min, float(r[4])))
    # ТО и ремонты
    t, rows = _rows(c, "Ремонты ССК-Т", "Наименование работ", "Дата")
    work = {r[0]: (_to_event(r[1]), r[2]) for r in rows}
    for rp, e in links.pairs(c, t.id, "Оборудование_ID") if t else []:
        k, d = work.get(rp, (None, None))
        if k:
            add(e, k, d)
    # дефектоскопия
    t, rows = _rows(c, "Дефектоскопия", "Дефектоскопия от")
    dd = dict(rows)
    for x, e in links.pairs(c, t.id, "ID_Оборудования") if t else []:
        add(e, "дефектоскопия", dd.get(x))
    # поступление на базу (R19): перемещение, у которого «Куда» — база
    t, rows = _rows(c, "Перемещение", "Дата")
    if t:
        kusty = _table(c, "Кусты")
        knames, _ = links.Names(c, {"role": "superadmin"}).of(kusty.airtable_id) if kusty else ({}, {})
        to_base = {m for m, k in links.pairs(c, t.id, "Куда") if is_base(knames.get(k))}
        md = dict(rows)
        for m, e in links.pairs(c, t.id, "ID_Оборудования"):
            if m in to_base:
                add(e, "поступление", md.get(m))
    # калибровки (у МИРа — и у кожуха пары)
    cal_pairs: dict[int, list] = {}
    for e, h, at in c.execute(text("select equipment_id, housing_id, at from app_calibration order by at")):
        add(e, "калибровка", at)
        cal_pairs.setdefault(e, []).append((at, h))
        if h:
            cal_pairs.setdefault(h, []).append((at, e))

    # номенклатура, тип, местонахождение
    nn = _col(c, nom.id, "Наименование") if nom else None
    nom_names = dict(c.execute(text(f"select id, {nn} from {nom.pg_name}")).all()) if nn else {}
    first: dict = {}
    for m, o in links.pairs(c, eq.id, target_at=nom.airtable_id) if nom else []:
        first.setdefault(m, o)
    typ, status = _col(c, eq.id, "Тип"), _col(c, eq.id, "Статус")
    loc_f = c.execute(text("select airtable_id from app_field where table_id = :t and title = 'Местонахождение'"), {"t": eq.id}).scalar()
    locs = computed.values().get(loc_f, {}) if loc_f else {}
    names, _ = links.Names(c, user).of(eq.airtable_id)
    rs = rules(c)

    out = {}
    for r in c.execute(text(f"select id, airtable_id, {typ or 'null'} as typ, {status or 'null'} as st from {eq.pg_name}")):
        if r.st in OFF:   # списанные и оставленные в скважине — без рекомендаций
            continue
        nomen = nom_names.get(first.get(r.id))
        ev = events.get(r.id, {})
        res = evaluate(rs, nomen, r.typ, ev, sorted(trips.get(r.id, [])), today)
        loc = locs.get(r.airtable_id)
        loc = ", ".join(map(str, loc)) if isinstance(loc, list) else loc
        row = {}
        if res["need_to"]:
            row["_need_to"] = {"name": res["need_to"], "tone": "accent", "title": res["need_reason"]}
        elif res["need_reason"]:
            row["_need_to"] = {"name": "нет данных", "tone": "muted", "title": res["need_reason"]}
        tos = [(max(ev[k]), k) for k in ("ТО-1", "ТО-2", "ТО-3") if ev.get(k)]
        if r.typ == "Скважинное" and tos:
            d, k = max(tos)
            row["_last_to"] = {"name": f"{k} · {d}"}
        elif r.typ == "Скважинное" and res["applies"]:
            row["_last_to"] = {"name": "нет данных", "tone": "muted"}
        if res["defect"]:
            row["_defect"] = _due(res["defect"], today)
            flags = pipe_flags(res["defect"], loc) if r.typ == "Трубное" else {"mark": False, "red_row": False}
            if flags["mark"]:
                row["_defect_mark"] = {"name": "На дефектоскопию", "tone": "orange"}
            if flags["red_row"]:
                row["_tone"] = "red"
        if r.id in cal_pairs:   # R21: последняя запись + пара + «+N»
            at, other = cal_pairs[r.id][-1]
            more = len(cal_pairs[r.id]) - 1
            pair = f" · {names.get(other, other)}" if other else ""
            row["_calib"] = {**_due({"last": at, "due_date": add_months(at, CAL_MONTHS),
                                     "overdue": (res["calib"] or {}).get("overdue")}, today),
                             "name": f"{at}{pair}{f' +{more}' if more else ''}"}
        elif res["calib"]:
            row["_calib"] = {"name": "нет данных", "tone": "muted"}
        out[r.id] = row
    return out


def _due(d: dict, today: dt.date) -> dict:
    """R20: срок по дате — ≤ 5 дней оранжевый, прошёл — красный; по часам — красный с причиной (E10)."""
    if d.get("last") is None:
        return {"name": "нет данных", "tone": "muted"}
    if d.get("overdue"):
        return {"name": f"{d['last']} · просрочено {d['overdue']}", "tone": "red"}
    due = d.get("due_date")
    if due is None:
        return {"name": f"{d['last']}", "title": f"{d.get('hours')} ч из {d.get('limit_hours')}"}
    days = (due - today).days
    return {"name": f"{d['last']} · осталось {days} дн.", "tone": "orange" if days <= 5 else None}


# --- правила (R17): смотреть — всем, кто видит Оборудование; править — админам ---

@router.get("/maintenance/rules")
def list_rules(user: dict = Depends(active_user)):
    with engine.connect() as c:
        eq = _table(c, EQ)
        table_title(c, eq.id if eq else 0, user)
        return [{"id": r.id, "match": r.match, "kind": r.kind, "level": r.level, "hours": r.hours, "months": r.months,
                 "on_arrival": r.on_arrival, "resets": r.resets} for r in rules(c)]


class RulePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hours: float | None = Field(None, ge=1, le=100000)
    months: int | None = Field(None, ge=1, le=120)


@router.patch("/maintenance/rules/{rule_id}")
def patch_rule(rule_id: int, body: RulePatch, user: dict = Depends(active_user)):
    """Порог в часах и/или месяцах; null — без порога. ponytail: состав правил (новые модули, события сброса) — пока
    миграцией; экран правит пороги — это то, что меняется на деле."""
    if user["role"] not in ADMINS:
        raise HTTPException(403, "Регламент правят админы")
    with engine.begin() as c:
        n = c.execute(text("update app_maint_rule set hours = :h, months = :m where id = :i and kind <> 'to' or "
                           "id = :i and kind = 'to' and not on_arrival"), {"h": body.hours, "m": body.months, "i": rule_id}).rowcount
        if not n:
            raise HTTPException(404, "Нет такого правила")
    return {"ok": True}

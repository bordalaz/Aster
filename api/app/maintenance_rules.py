"""Регламент ТО (spec R16–R19, E7, E8, E10) — чистая логика без БД.
Наработка не хранится: сумма циркуляции законченных рейсов прибора после события-отсчёта (R16).
Все выводы рекомендательные (R18): ничего не блокируют и не меняют."""
import datetime as dt
from dataclasses import dataclass, field

LEVELS = ["ТО-1", "ТО-1/ТО-2", "ТО-2", "ТО-3"]          # порядок «важности» для «Нужное ТО»
TO_EVENTS = ("ТО-1", "ТО-2", "ТО-3")
PIPE_MARK_H, PIPE_RED_H = 300, 400                        # R18б


@dataclass
class Rule:
    match: list[str]          # префиксы наименования номенклатуры или «тип:Трубное»
    kind: str                 # to | defect | calib
    level: str | None = None  # для kind=to
    hours: float | None = None
    months: int | None = None
    on_arrival: bool = False  # R19: ТО-1 при поступлении на базу
    resets: list[str] = field(default_factory=list)   # события, сбрасывающие отсчёт этого правила
    id: int | None = None

    def applies(self, nomenclature: str | None, typ: str | None) -> bool:
        n = (nomenclature or "").lower()
        return any(m.lower() == f"тип:{(typ or '').lower()}" if m.lower().startswith("тип:") else n.startswith(m.lower())
                   for m in self.match)


def add_months(d: dt.date, months: int) -> dt.date:
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    last = (dt.date(year + (month == 12), month % 12 + 1, 1) - dt.timedelta(days=1)).day
    return dt.date(year, month, min(d.day, last))


def hours_since(trips: list[tuple[dt.date, float]], since: dt.date) -> float:
    """trips — (дата начала, часы) законченных рейсов прибора (E8: прочие сюда не попадают)."""
    return round(sum(h for d, h in trips if d >= since), 2)


def evaluate(rules: list[Rule], nomenclature: str | None, typ: str | None, events: dict[str, list[dt.date]],
             trips: list[tuple[dt.date, float]], today: dt.date) -> dict:
    """events: ТО-1/ТО-2/ТО-3/дефектоскопия/калибровка/поступление → даты. Возвращает рекомендации по прибору."""
    last = {k: max(v) for k, v in events.items() if v}
    out = {"need_to": None, "need_reason": None, "defect": None, "calib": None, "applies": False}
    best = -1
    for r in rules:
        if not r.applies(nomenclature, typ):
            continue
        out["applies"] = True
        if r.kind == "to" and r.on_arrival:
            arrived, last_to = last.get("поступление"), max((last[e] for e in TO_EVENTS if e in last), default=None)
            if arrived and (last_to is None or arrived > last_to) and LEVELS.index(r.level) > best:
                best, out["need_to"], out["need_reason"] = LEVELS.index(r.level), r.level, f"поступил на базу {arrived}"
            continue
        anchors = [last[e] for e in r.resets if e in last]
        since = max(anchors) if anchors else None
        hours = hours_since(trips, since) if since else None
        due_date = add_months(since, r.months) if since and r.months else None
        if r.kind == "to":
            if since is None:   # E7: ни одного ТО — «нет данных», не «пора»; нет только своей точки отсчёта — пропуск
                if out["need_to"] is None and not any(e in last for e in TO_EVENTS):
                    out["need_reason"] = "нет данных о последнем ТО"
                continue
            if r.hours is not None and hours >= r.hours and LEVELS.index(r.level) > best:
                best, out["need_to"], out["need_reason"] = LEVELS.index(r.level), r.level, f"{hours:g} ч после {since}"
        else:
            res = {"last": since, "hours": hours, "limit_hours": r.hours, "due_date": due_date}
            if since is not None:
                by_h = r.hours is not None and hours >= r.hours
                by_d = due_date is not None and today >= due_date
                res["overdue"] = "по часам" if by_h else "по дате" if by_d else None   # E10: причина
            out["defect" if r.kind == "defect" else "calib"] = res
    return out


def pipe_flags(defect: dict | None, location: str | None) -> dict:
    """R18б: «На дефектоскопию» — ≥ 300 ч и на базе; ≥ 400 ч на кусту — светло-красная строка."""
    h = (defect or {}).get("hours")
    if h is None:
        return {"mark": False, "red_row": False}
    base = is_base(location)
    return {"mark": base and h >= PIPE_MARK_H, "red_row": (not base) and bool(location) and h >= PIPE_RED_H}


def is_base(location: str | None) -> bool:
    n = (location or "").lower()
    return any(s in n for s in ("база", "склад", "ремцех", "рем. цех", "рем цех"))


# Начальное наполнение (R17). Правит админ на экране «Регламент».
SEED = [
    Rule(["Пульсатор"], "to", "ТО-1", on_arrival=True),
    Rule(["Пульсатор"], "to", "ТО-2", hours=250, resets=["ТО-2", "ТО-3"]),
    Rule(["Пульсатор"], "to", "ТО-3", hours=500, resets=["ТО-3"]),
    Rule(["LTMC"], "to", "ТО-1", on_arrival=True),
    Rule(["LTMC"], "to", "ТО-2", hours=500, resets=["ТО-2", "ТО-3"]),
    Rule(["LTMC"], "to", "ТО-3", hours=1000, resets=["ТО-3"]),
    *[Rule(["Инклинометр", "Гамма-зонд", "МИР", "УМР", "Корпус батареи", "UTMC"], k, lv, hours=h, months=mo, resets=rs)
      for k, lv, h, mo, rs in [("to", "ТО-1/ТО-2", 500, None, ["ТО-1", "ТО-2", "ТО-3"]),
                               ("to", "ТО-3", 1000, None, ["ТО-3"]),
                               ("calib", None, 1000, 12, ["калибровка"])]],
    Rule(["Резистивиметр"], "to", "ТО-1", hours=500, resets=["дефектоскопия"]),
    Rule(["Резистивиметр"], "to", "ТО-3", hours=1000, resets=["ТО-3"]),
    Rule(["Резистивиметр"], "defect", hours=500, resets=["дефектоскопия"]),
    Rule(["тип:Трубное"], "defect", hours=500, months=6, resets=["дефектоскопия"]),
]

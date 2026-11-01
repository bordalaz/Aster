"""Регламент R17 на тестовых данных (критерий приёмки: внесли рейсы до порога → нужный уровень; внесли ТО →
отсчёт сбросился; у группы «инклинометр…» ТО-3 — свой отсчёт; трубное — 500 ч или 6 мес., E10)."""
import datetime as dt

from app.maintenance_rules import SEED, add_months, evaluate, is_base, pipe_flags

D = dt.date
TODAY = D(2026, 11, 1)


def ev(nom, typ="Скважинное", events=None, trips=None, today=TODAY):
    return evaluate(SEED, nom, typ, events or {}, trips or [], today)


def test_pulsator_levels_and_reset():
    to3 = {"ТО-3": [D(2026, 1, 10)]}
    assert ev("Пульсатор G4", events=to3, trips=[(D(2026, 2, 1), 200)])["need_to"] is None
    r = ev("Пульсатор G4", events=to3, trips=[(D(2026, 2, 1), 200), (D(2026, 3, 1), 60)])
    assert r["need_to"] == "ТО-2" and "260" in r["need_reason"]
    # провели ТО-2 — отсчёт ТО-2 сбросился, ТО-3 считается от ТО-3
    after = {**to3, "ТО-2": [D(2026, 3, 5)]}
    assert ev("Пульсатор", events=after, trips=[(D(2026, 2, 1), 260), (D(2026, 4, 1), 100)])["need_to"] is None
    assert ev("Пульсатор", events=after, trips=[(D(2026, 2, 1), 260), (D(2026, 4, 1), 250)])["need_to"] == "ТО-3"
    assert ev("Пульсатор", events={"ТО-3": [D(2026, 9, 1)]}, trips=[(D(2026, 2, 1), 999)])["need_to"] is None   # ТО-3 сбросил всё


def test_arrival_needs_to1_until_any_to():   # R19
    r = ev("LTMC", events={"ТО-3": [D(2026, 1, 1)], "поступление": [D(2026, 6, 1)]})
    assert r["need_to"] == "ТО-1" and "поступил" in r["need_reason"]
    assert ev("LTMC", events={"ТО-3": [D(2026, 1, 1)], "поступление": [D(2026, 6, 1)], "ТО-1": [D(2026, 6, 3)]})["need_to"] is None
    # наработка важнее «при поступлении»: выше уровень
    r = ev("LTMC", events={"ТО-3": [D(2026, 1, 1)], "поступление": [D(2026, 6, 1)]}, trips=[(D(2026, 3, 1), 600)])
    assert r["need_to"] == "ТО-2"


def test_group_to12_every_500_and_separate_to3_count():
    trips = [(D(2026, 2, 1), 400), (D(2026, 5, 1), 300)]
    ev_ = {"ТО-3": [D(2026, 1, 1)], "ТО-1": [D(2026, 4, 1)]}
    assert ev("Инклинометр", events=ev_, trips=trips)["need_to"] is None          # после ТО-1: 300 ч
    trips.append((D(2026, 6, 1), 350))                                              # с ТО-3: 1050 ч
    assert ev("Инклинометр", events=ev_, trips=trips)["need_to"] == "ТО-3"
    assert ev("Корпус батареи", events={"ТО-2": [D(2026, 1, 1)]}, trips=[(D(2026, 2, 1), 500)])["need_to"] == "ТО-1/ТО-2"


def test_no_data_is_not_overdue():   # E7
    r = ev("Гамма-зонд", trips=[(D(2026, 2, 1), 5000)])
    assert r["need_to"] is None and r["need_reason"] == "нет данных о последнем ТО"
    assert r["calib"] == {"last": None, "hours": None, "limit_hours": 1000, "due_date": None}


def test_calibration_hours_or_year():
    r = ev("МИР", events={"ТО-1": [D(2026, 9, 1)], "калибровка": [D(2025, 10, 1)]}, trips=[(D(2026, 1, 1), 10)])
    assert r["calib"]["overdue"] == "по дате" and r["calib"]["due_date"] == D(2026, 10, 1)
    r = ev("МИР", events={"калибровка": [D(2026, 5, 1)]}, trips=[(D(2026, 6, 1), 1000)])
    assert r["calib"]["overdue"] == "по часам"


def test_pipe_defect_500h_or_6_months_with_reason():   # E10
    r = ev("Pin-Pin 4 3/4\"", "Трубное", {"дефектоскопия": [D(2026, 3, 1)]}, [(D(2026, 4, 1), 120)])
    assert r["defect"]["due_date"] == D(2026, 9, 1) and r["defect"]["overdue"] == "по дате" and r["need_to"] is None
    r = ev("Pin-Pin", "Трубное", {"дефектоскопия": [D(2026, 9, 1)]}, [(D(2026, 9, 2), 510)])
    assert r["defect"]["overdue"] == "по часам" and r["defect"]["hours"] == 510
    assert ev("FlowSUB", "Трубное", {"дефектоскопия": [D(2026, 9, 1)]})["defect"]["overdue"] is None


def test_resistivimeter_to1_with_defectoscopy():
    r = ev('Резистивиметр 4.75"', events={"дефектоскопия": [D(2026, 1, 1)], "ТО-3": [D(2026, 1, 1)]}, trips=[(D(2026, 2, 1), 500)])
    assert r["need_to"] == "ТО-1" and r["defect"]["overdue"] == "по часам"
    assert ev("Аналоговый резистивиметр OFITE", "Наземка")["applies"] is False


def test_pipe_flags_r18b():
    assert pipe_flags({"hours": 300}, "НЮ_База ССК-Т") == {"mark": True, "red_row": False}
    assert pipe_flags({"hours": 350}, "ВК_5") == {"mark": False, "red_row": False}
    assert pipe_flags({"hours": 400}, "ВК_5") == {"mark": False, "red_row": True}
    assert pipe_flags({"hours": None}, "ВК_5") == {"mark": False, "red_row": False}
    assert is_base("НЮ_РемЦех") and is_base("_ННГ_Пелей_база") and not is_base("Возврат_")


def test_add_months_end_of_month():
    assert add_months(D(2026, 8, 31), 6) == D(2027, 2, 28)


def test_no_to3_yet_is_not_no_data():
    """ТО-3 ещё ни разу не было, но ТО-2 было — это не «нет данных»: ТО-1/ТО-2 считается от ТО-2."""
    r = ev("Корпус батареи", events={"ТО-2": [D(2026, 7, 28)]}, trips=[(D(2026, 8, 1), 100)])
    assert r["need_to"] is None and r["need_reason"] is None
    assert ev("Корпус батареи", events={"ТО-2": [D(2026, 7, 28)]}, trips=[(D(2026, 8, 1), 500)])["need_to"] == "ТО-1/ТО-2"


def test_plain_to_is_not_a_level():
    """«ТО» без уровня не сбрасывает отсчёт и не считается ТО-1 (решение владельца)."""
    from app.maintenance import _to_event
    assert _to_event("ТО Уровень 2") == "ТО-2" and _to_event("ТО") is None and _to_event("Осмотр") is None

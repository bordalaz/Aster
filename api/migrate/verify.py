"""verify: снимок ↔ PostgreSQL. Ничего не меняет, только считает расхождения."""
import json
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy import text

from .compute import _field_config, compute_count, compute_field, compute_formula, compute_lookup
from .load import read_records, require_complete
from .names import column_name, table_name
from .rollup_aggs import AGG, KNOWN_DIFF
from .schema import ATTACH, LINK, link_sides, pg_type


def _norm(f: dict, v):
    """Значение к виду, сравнимому между API Airtable и строкой БД."""
    if f["type"] == "checkbox":
        return bool(v)
    if v is None:
        return None
    if isinstance(v, Decimal) or pg_type(f) == "numeric":
        return float(v)
    if isinstance(v, datetime):
        return v
    if pg_type(f) == "timestamptz":
        return datetime.fromisoformat(v)
    if isinstance(v, date):
        return v.isoformat()
    return v


def _show(v):
    return v.isoformat() if isinstance(v, datetime) else v


def verify(conn, snap: Path) -> dict:
    require_complete(snap)
    schema = json.loads((snap / "schema.json").read_text(encoding="utf-8"))
    recs = {t["id"]: read_records(snap, t["id"]) for t in schema}
    rep = {"tables": {}, "links": {}, "attachments": {}}

    for t in schema:
        cols = [f for f in t["fields"] if pg_type(f)]
        db = {r["airtable_id"]: r for r in conn.execute(text(f"select * from {table_name(t['id'])}")).mappings()}
        mism = []
        for r in recs[t["id"]]:
            row = db.get(r["id"])
            if row is None:
                continue
            for f in cols:
                a, d = _norm(f, r["fields"].get(f["id"])), _norm(f, row[column_name(f["id"])])
                if a != d:
                    mism.append({"record": r["id"], "field": f["id"], "airtable": _show(a), "db": _show(d)})
        ids = {r["id"] for r in recs[t["id"]]}
        rep["tables"][t["id"]] = {
            "title": t["name"], "airtable": len(ids), "db": len(db),
            "missing": sorted(ids - db.keys()), "extra": sorted(db.keys() - ids), "value_mismatches": mism,
        }

    # связи: пары из обеих сторон снимка, без ссылок на отсутствующие записи
    sides = link_sides(schema)
    ids = {t["id"]: {r["id"] for r in recs[t["id"]]} for t in schema}
    expected = set()
    for t in schema:
        for f in t["fields"]:
            if f["type"] == LINK:
                lt, side = sides[f["id"]]
                for r in recs[t["id"]]:
                    for target in r["fields"].get(f["id"], []):
                        if target in ids[f["options"]["linkedTableId"]]:
                            expected.add((lt, r["id"], target) if side == "src" else (lt, target, r["id"]))
    db_links = sum(conn.execute(text(f"select count(*) from {lt}")).scalar() for lt in {v[0] for v in sides.values()})
    rep["links"] = {"airtable": len(expected), "db": db_links}

    atts = [a["id"] for t in schema for f in t["fields"] if f["type"] == ATTACH
            for r in recs[t["id"]] for a in r["fields"].get(f["id"], [])]
    rep["attachments"] = {
        "airtable": len(atts),
        "db": conn.execute(text("select count(*) from attachment")).scalar(),
        "missing_files": sum(not (snap / "files" / a).exists() for a in atts),
    }
    # extra — только предупреждение: удалённое в Airtable у нас молча не удаляем
    rep["ok"] = (all(not v["missing"] and not v["value_mismatches"] for v in rep["tables"].values())
                 and rep["links"]["airtable"] == rep["links"]["db"]
                 and rep["attachments"]["airtable"] == rep["attachments"]["db"]
                 and rep["attachments"]["missing_files"] == 0)
    return rep


def verify_computed(conn, only: dict | None = None, known: dict | None = None) -> dict:
    """Сверить вычисленные агрегаты с at_computed. only — карта {ключ: функция} (для тестов);
    по умолчанию берём rollup_aggs.AGG. INVALID не считаем."""
    agg = only if only is not None else AGG
    known = KNOWN_DIFF if known is None else known
    rep = {"fields": {}, "skipped": {"invalid": [], "missing": []}}
    for key, func in agg.items():
        try:
            cfg = _field_config(conn, key)
        except KeyError:
            rep["skipped"]["missing"].append(key)
            continue
        if func == "INVALID" or cfg["options"].get("isValid") is False:
            rep["fields"][key] = _INVALID
            continue
        rep["fields"][key] = _compare(conn, cfg, compute_field(conn, key, func), known.get(key))
    rep["ok"] = all(f["status"] in ("ok", "invalid", "known") for f in rep["fields"].values())
    return rep


def verify_formulas(conn, today: date, known: dict | None = None, kind: str = "formula") -> dict:
    """Сверить все поля типа kind (formula | multipleLookupValues | count) с at_computed.
    today — дата снимка (для TODAY()/NOW())."""
    known = KNOWN_DIFF if known is None else known
    calc = {"formula": lambda c, k: compute_formula(c, k, today),
            "multipleLookupValues": compute_lookup, "count": compute_count}[kind]
    keys = [k for (k,) in conn.execute(text(
        "select t.title || '.' || f.title from app_field f join app_table t on t.id = f.table_id "
        "where f.kind = :k order by t.sort_order, f.sort_order"), {"k": kind})]
    rep = {"fields": {}}
    for key in keys:
        cfg = _field_config(conn, key)
        if cfg["options"].get("isValid") is False:
            rep["fields"][key] = _INVALID
            continue
        try:
            got = calc(conn, key)
        except ValueError as e:   # формула не разобралась — показываем, а не падаем на всей сверке
            rep["fields"][key] = {"status": "error", "checked": 0, "mismatches": 0, "examples": [], "error": str(e)}
            continue
        rep["fields"][key] = _compare(conn, cfg, got, known.get(key))
    rep["ok"] = all(f["status"] in ("ok", "invalid", "known") for f in rep["fields"].values())
    return rep


_INVALID = {"status": "invalid", "checked": 0, "mismatches": 0, "examples": []}


def _compare(conn, cfg: dict, got: dict, known_reason: str | None) -> dict:
    # at_computed.value (jsonb) psycopg отдаёт уже разобранным Python-объектом
    want = {r.record_airtable_id: r.value for r in conn.execute(text(
        "select record_airtable_id, value from at_computed where table_id = :t and field_id = :f"
    ), {"t": cfg["owner_at"], "f": cfg["field_at"]})}
    checked = mism = 0
    examples = []
    for rec_at, g in got.items():
        if rec_at not in want:
            continue
        checked += 1
        w = want[rec_at]
        if not _equal(g, w):
            mism += 1
            if len(examples) < 20:
                examples.append({"record": rec_at, "got": g, "want": w})
    status = "ok" if mism == 0 else "known" if known_reason else "mismatch"
    out = {"status": status, "checked": checked, "mismatches": mism, "examples": examples}
    if status == "known":
        out["reason"] = known_reason
    return out


def _equal(got, want) -> bool:
    if isinstance(got, (int, float)) and isinstance(want, (int, float))             and not isinstance(got, bool) and not isinstance(want, bool):
        return abs(got - want) <= 1e-6 * max(1, abs(want))   # относительный допуск: суммы в рублях большие
    if isinstance(want, list) and want and all(isinstance(w, dict) and "url" in w for w in want):
        want = [w["id"] for w in want]   # вложения — по id: url у Airtable временный
    if isinstance(got, list) and isinstance(want, list) and len(got) == len(want):
        return all(_equal(g, w) for g, w in zip(got, want))   # lookup чисел — с тем же допуском
    if got in (0, "", []) and want is None:   # пустой агрегат <-> Airtable прислал пусто
        return True
    return got == want

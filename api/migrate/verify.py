"""verify: снимок ↔ PostgreSQL. Ничего не меняет, только считает расхождения."""
import json
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy import text

from .load import read_records, require_complete
from .names import column_name, table_name
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

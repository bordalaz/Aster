"""load: снимок на диске → записи, связи, вложения, ожидаемые вычисляемые значения. Повторный запуск — upsert."""
import json
from pathlib import Path

from sqlalchemy import text

from .names import column_name, table_name
from .schema import ATTACH, COMPUTED, LINK, link_sides, pg_type


def require_complete(snap: Path) -> None:
    if not (snap / "complete").exists():
        raise RuntimeError(f"Снимок {snap} не завершён (fetch прервался) — запустите fetch ещё раз")


def read_records(snap: Path, tbl_id: str) -> list[dict]:
    p = snap / "records" / f"{tbl_id}.jsonl"
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x]


def load_snapshot(conn, snap: Path) -> dict:
    require_complete(snap)
    schema = json.loads((snap / "schema.json").read_text(encoding="utf-8"))
    recs = {t["id"]: read_records(snap, t["id"]) for t in schema}
    result = {"records": {}, "links": 0, "dangling_links": 0, "attachments": 0}

    # 1. записи
    for t in schema:
        cols = [f for f in t["fields"] if pg_type(f)]
        names = ["airtable_id", "created_at"] + [column_name(f["id"]) for f in cols]
        binds = [":airtable_id", ":created_at"] + [
            f"cast(:{column_name(f['id'])} as jsonb)" if pg_type(f) == "jsonb" else f":{column_name(f['id'])}"
            for f in cols]
        sets = ", ".join(f"{n} = excluded.{n}" for n in names[1:])
        sql = text(f"insert into {table_name(t['id'])} ({', '.join(names)}) values ({', '.join(binds)}) "
                   f"on conflict (airtable_id) do update set {sets}")
        rows = []
        for r in recs[t["id"]]:
            p = {"airtable_id": r["id"], "created_at": r.get("createdTime")}
            for f in cols:
                v = r["fields"].get(f["id"])
                if f["type"] == "checkbox":
                    v = bool(v)
                elif pg_type(f) == "jsonb" and v is not None:
                    v = json.dumps(v, ensure_ascii=False)
                p[column_name(f["id"])] = v
            rows.append(p)
        if rows:
            conn.execute(sql, rows)
        result["records"][t["id"]] = len(rows)

    pk = {t["id"]: dict(conn.execute(text(f"select airtable_id, id from {table_name(t['id'])}")).all())
          for t in schema}

    # 2. связи: снимок полный, поэтому таблицу пар собираем заново — так правки в Airtable применяются
    pairs: dict[str, dict] = {}
    for t in schema:
        for f in t["fields"]:
            if f["type"] != LINK:
                continue
            lt, side = link_sides(schema)[f["id"]]
            other = pk[f["options"]["linkedTableId"]]
            acc = pairs.setdefault(lt, {})
            for r in recs[t["id"]]:
                for i, target in enumerate(r["fields"].get(f["id"], [])):
                    if target not in other:
                        result["dangling_links"] += 1
                        continue
                    me, it = pk[t["id"]][r["id"]], other[target]
                    key = (me, it) if side == "src" else (it, me)
                    acc.setdefault(key, {"pos": None, "rpos": None})["pos" if side == "src" else "rpos"] = i
    for lt, acc in pairs.items():
        conn.execute(text(f"delete from {lt}"))
        if acc:
            conn.execute(text(f"insert into {lt} (src, dst, pos, rpos) values (:s, :d, :pos, :rpos)"),
                         [{"s": s, "d": d, **v} for (s, d), v in acc.items()])
        result["links"] += len(acc)

    # 3. вложения: одно вложение Airtable бывает в нескольких записях — пересобираем целиком, как связи
    rows = [{"t": t["id"], "r": r["id"], "f": f["id"], "pos": i, "a": a["id"], "fn": a.get("filename"),
             "m": a.get("type"), "sz": a.get("size"), "p": f"files/{a['id']}"}
            for t in schema for f in t["fields"] if f["type"] == ATTACH
            for r in recs[t["id"]] for i, a in enumerate(r["fields"].get(f["id"], []))]
    conn.execute(text("delete from attachment"))
    if rows:
        conn.execute(text(
            "insert into attachment (table_id, record_airtable_id, field_id, pos, airtable_att_id, "
            "filename, mime, size, path) values (:t, :r, :f, :pos, :a, :fn, :m, :sz, :p)"
        ), rows)
    result["attachments"] = len(rows)

    # 4. ожидаемые вычисляемые значения
    for t in schema:
        for f in t["fields"]:
            if f["type"] in COMPUTED:
                # пустое значение Airtable не присылает — храним null: «ожидаем пусто»
                rows = [{"t": t["id"], "r": r["id"], "f": f["id"],
                         "v": json.dumps(r["fields"].get(f["id"]), ensure_ascii=False)}
                        for r in recs[t["id"]]]
                if rows:
                    conn.execute(text(
                        "insert into at_computed values (:t, :r, :f, cast(:v as jsonb)) "
                        "on conflict (table_id, record_airtable_id, field_id) do update set value = excluded.value"
                    ), rows)
    return result

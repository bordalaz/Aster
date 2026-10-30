"""Схема Airtable → таблицы PG и метаданные app_table/app_field.

Имена в DDL — только из names.* (проверенные id), типы — из словаря ниже. Значения — параметрами.
"""
import json

from sqlalchemy import text

from .names import check_id, column_name, link_table_name, table_name

_TYPES = {
    **dict.fromkeys(["singleLineText", "multilineText", "richText", "email", "url", "phoneNumber",
                     "singleSelect"], "text"),
    **dict.fromkeys(["number", "currency", "percent", "rating", "duration"], "numeric"),
    "autoNumber": "integer",
    "checkbox": "boolean not null default false",
    "date": "date",
    **dict.fromkeys(["dateTime", "createdTime", "lastModifiedTime"], "timestamptz"),
    "multipleSelects": "text[]",
    **dict.fromkeys(["barcode", "createdBy", "lastModifiedBy", "singleCollaborator",
                     "multipleCollaborators"], "jsonb"),
}
LINK, ATTACH = "multipleRecordLinks", "multipleAttachments"
COMPUTED = {"formula", "rollup", "multipleLookupValues", "lookup", "count"}
VIRTUAL = COMPUTED | {LINK, ATTACH, "button"}
_PG_NAME = {"timestamptz": "timestamp with time zone"}
# считает сам Airtable — у нас не правится руками
READONLY = {"autoNumber", "createdTime", "lastModifiedTime", "createdBy", "lastModifiedBy"}


def pg_type(field: dict) -> str | None:
    if field["type"] in VIRTUAL:
        return None
    return _TYPES.get(field["type"], "jsonb")


def link_sides(schema: list[dict]) -> dict[str, tuple[str, str]]:
    """{fld: (таблица пар, side)}. Одна таблица на пару полей: по меньшему id, у него side=src."""
    out = {}
    for t in schema:
        for f in t["fields"]:
            if f["type"] == LINK:
                inv = f.get("options", {}).get("inverseLinkFieldId")
                owner = min(f["id"], inv) if inv else f["id"]
                out[f["id"]] = (link_table_name(owner), "src" if owner == f["id"] else "dst")
    return out


def apply_schema(conn, schema: list[dict]) -> list[str]:
    warnings = []
    for t in schema:
        check_id(t["id"], "tbl")
        for f in t["fields"]:
            check_id(f["id"], "fld")
    by_field = {f["id"]: (t, f) for t in schema for f in t["fields"]}
    sides = link_sides(schema)

    for t in schema:
        tn = table_name(t["id"])
        conn.execute(text(
            f"create table if not exists {tn} (id serial primary key, airtable_id text unique not null, "
            "created_at timestamptz, created_by int, "
            "updated_at timestamptz not null default now(), updated_by int)"
        ))
        for f in t["fields"]:
            pt = pg_type(f)
            if pt is None:
                continue
            if f["type"] not in _TYPES:
                warnings.append(f"Неизвестный тип {f['type']!r} у поля {f['id']} ({t['name']}.{f['name']}) — jsonb")
            have = conn.execute(text(
                "select format_type(atttypid, atttypmod) from pg_attribute "
                "where attrelid = cast(:t as regclass) and attname = :c and not attisdropped"
            ), {"t": tn, "c": column_name(f["id"])}).scalar()
            want = _PG_NAME.get(pt.split(" ")[0], pt.split(" ")[0])
            if have and have != want:
                # ponytail: громкая ошибка вместо авто-переделки колонки; переделку — когда случится
                raise RuntimeError(f"У поля {t['name']}.{f['name']} ({f['id']}) сменился тип в Airtable: "
                                   f"колонка {have}, нужно {want}")
            conn.execute(text(f"alter table {tn} add column if not exists {column_name(f['id'])} {pt}"))

    for fld, (lt, side) in sides.items():
        if side == "src":
            t, f = by_field[fld]
            dst_tbl = table_name(f["options"]["linkedTableId"])
            # pos — порядок в поле-источнике, rpos — в обратном поле: у Airtable они свои
            conn.execute(text(
                f"create table if not exists {lt} ("
                f"src int not null references {table_name(t['id'])} on delete cascade, "
                f"dst int not null references {dst_tbl} on delete cascade, "
                "pos int, rpos int, primary key (src, dst))"
            ))
        conn.execute(text(
            "insert into at_link_meta values (:f, :l, :s) "
            "on conflict (field_id) do update set link_table = excluded.link_table, side = excluded.side"
        ), {"f": fld, "l": lt, "s": side})

    for order, t in enumerate(schema):
        tid = conn.execute(text(
            "insert into app_table (pg_name, title, primary_field, sort_order, airtable_id) "
            "values (:p, :t, :pf, :o, :a) on conflict (pg_name) do update set title = excluded.title, "
            "primary_field = excluded.primary_field, sort_order = excluded.sort_order returning id"
        ), {"p": table_name(t["id"]), "t": t["name"], "pf": column_name(t["primaryFieldId"]),
            "o": order, "a": t["id"]}).scalar()
        for fo, f in enumerate(t["fields"]):
            opts = dict(f.get("options") or {})
            if pg_type(f) is None:
                opts["virtual"] = True
            if f["id"] in sides:
                opts["side"] = sides[f["id"]][1]
            conn.execute(text(
                "insert into app_field (table_id, column_name, title, kind, editable, sort_order, options, airtable_id) "
                "values (:t, :c, :ti, :k, :e, :o, cast(:op as jsonb), :a) "
                "on conflict (table_id, column_name) do update set title = excluded.title, kind = excluded.kind, "
                "editable = excluded.editable, sort_order = excluded.sort_order, options = excluded.options"
            ), {"t": tid, "c": column_name(f["id"]), "ti": f["name"], "k": f["type"],
                "e": pg_type(f) is not None and f["type"] not in READONLY, "o": fo,
                "op": json.dumps(opts, ensure_ascii=False), "a": f["id"]})
        # поле удалили в Airtable — убираем из метаданных (колонка с данными остаётся)
        conn.execute(text("delete from app_field where table_id = :t and airtable_id <> all(:ids)"),
                     {"t": tid, "ids": [f["id"] for f in t["fields"]]})
    return warnings

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

"""python -m migrate fetch|load|verify|all — копия базы Airtable в PostgreSQL."""
import argparse
import json
import os
import sys
from pathlib import Path

from app.db import engine

from .airtable import AirtableClient
from .load import load_snapshot
from .schema import apply_schema
from .snapshot import fetch_snapshot
from .verify import verify

BASE = "appPaeBP8t3Ri5Lfn"
SNAP = Path("/data/snapshot")


def cmd_fetch(files: bool = True) -> int:
    token = os.environ.get("AIRTABLE_TOKEN")
    if not token:
        print("Не задан AIRTABLE_TOKEN в .env")
        return 2
    counts = fetch_snapshot(AirtableClient(token, BASE), SNAP, files=files)
    print(f"Снимок: таблиц {len(counts)}, записей {sum(counts.values())} → {SNAP}")
    return 0


def cmd_load() -> int:
    schema = json.loads((SNAP / "schema.json").read_text(encoding="utf-8"))
    with engine.begin() as c:
        warnings = apply_schema(c, schema)
        res = load_snapshot(c, SNAP)
    for w in warnings:
        print("Внимание:", w)
    print(f"Загружено: записей {sum(res['records'].values())}, связей {res['links']} "
          f"(битых ссылок {res['dangling_links']}), вложений {res['attachments']}")
    return 0


def cmd_verify() -> int:
    with engine.connect() as c:
        rep = verify(c, SNAP)
    (SNAP / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    t = rep["tables"].values()
    print(f"Таблиц {len(rep['tables'])}, записей {sum(x['db'] for x in t)}/{sum(x['airtable'] for x in t)}, "
          f"нет у нас {sum(len(x['missing']) for x in t)}, лишних {sum(len(x['extra']) for x in t)}, "
          f"расхождений значений {sum(len(x['value_mismatches']) for x in t)}, "
          f"связей {rep['links']['db']}/{rep['links']['airtable']}, "
          f"вложений {rep['attachments']['db']}/{rep['attachments']['airtable']} "
          f"(нет файлов {rep['attachments']['missing_files']})")
    print("Сверка: OK" if rep["ok"] else f"Сверка: есть расхождения, см. {SNAP / 'report.json'}")
    return 0 if rep["ok"] else 1


def cmd_compute_verify() -> int:
    from .verify import verify_computed
    with engine.connect() as c:
        rep = verify_computed(c)
    (SNAP / "report-computed.json").write_text(
        json.dumps(rep, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    fields = rep["fields"]
    ok = sum(1 for f in fields.values() if f["status"] == "ok")
    mm = [k for k, f in fields.items() if f["status"] == "mismatch"]
    inv = [k for k, f in fields.items() if f["status"] == "invalid"]
    known = [k for k, f in fields.items() if f["status"] == "known"]
    print(f"Вычисляемые (агрегаты): полей {len(fields)}, совпало {ok}, "
          f"с расхождениями {len(mm)}, известных {len(known)}, битых {len(inv)}, "
          f"formula-отложено {len(rep['skipped']['formula'])}")
    if mm:
        print("Расхождения в полях:", ", ".join(mm))
    print("Сверка агрегатов: OK" if rep["ok"] else f"Есть расхождения, см. {SNAP / 'report-computed.json'}")
    return 0 if rep["ok"] else 1


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="python -m migrate", description=__doc__)
    p.add_argument("command", choices=["fetch", "load", "verify", "compute-verify", "all"])
    p.add_argument("--no-files", action="store_true", help="без вложений; докачать — тот же fetch без флага")
    a = p.parse_args(argv)
    fetch = lambda: cmd_fetch(files=not a.no_files)  # noqa: E731
    steps = {"fetch": [fetch], "load": [cmd_load], "verify": [cmd_verify], "compute-verify": [cmd_compute_verify],
             "all": [fetch, cmd_load, cmd_verify]}[a.command]
    for step in steps:
        code = step()
        if code:
            return code
    return 0


if __name__ == "__main__":
    sys.exit(main())

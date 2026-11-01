"""python -m migrate fetch|load|views|verify|all — копия базы Airtable в PostgreSQL."""
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
from .views import load_views

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
        views = SNAP / "views.json"   # свежее, чем схема снимка, если снимали `views` отдельно
        res["views"] = load_views(c, json.loads(views.read_text(encoding="utf-8")) if views.exists() else schema,
                                  _view_filters())
    for w in warnings:
        print("Внимание:", w)
    print(f"Загружено: записей {sum(res['records'].values())}, связей {res['links']} "
          f"(битых ссылок {res['dangling_links']}), вложений {res['attachments']}, видов {res['views']}")
    return 0


def _view_filters() -> dict:
    """Фильтры/сортировки/группировки видов, снятые из веб-клиента Airtable (публичный API их не отдаёт)."""
    p = SNAP / "view_filters.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def cmd_views() -> int:
    """Снять виды (схема с видимыми колонками) и загрузить в app_view; данные не трогает."""
    token = os.environ.get("AIRTABLE_TOKEN")
    if not token:
        print("Не задан AIRTABLE_TOKEN в .env")
        return 2
    schema = AirtableClient(token, BASE).schema()
    (SNAP / "views.json").write_text(json.dumps(schema, ensure_ascii=False), encoding="utf-8")
    with engine.begin() as c:
        n = load_views(c, schema, _view_filters())
    print(f"Видов перенесено: {n} (только grid; фильтры — из {SNAP / 'view_filters.json'}, если он есть)")
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
    from datetime import datetime, timezone

    from .verify import verify_computed, verify_formulas
    # TODAY()/NOW() в Airtable считались в момент выгрузки — берём дату снимка
    today = datetime.fromtimestamp((SNAP / "complete").stat().st_mtime, timezone.utc).date()
    with engine.connect() as c:
        rep = {"aggregates": verify_computed(c), "formulas": verify_formulas(c, today),
               "lookups": verify_formulas(c, today, kind="multipleLookupValues"),
               "counts": verify_formulas(c, today, kind="count"), "today": today}
    parts = (("Агрегаты", "aggregates"), ("Формулы", "formulas"), ("Lookup", "lookups"), ("Count", "counts"))
    rep["ok"] = all(rep[p]["ok"] for _, p in parts)
    (SNAP / "report-computed.json").write_text(
        json.dumps(rep, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    for title, key in parts:
        part = rep[key]
        st = [f["status"] for f in part["fields"].values()]
        print(f"{title}: полей {len(st)}, совпало {st.count('ok')}, с расхождениями {st.count('mismatch')}, "
              f"известных {st.count('known')}, битых {st.count('invalid')}, не разобрано {st.count('error')}")
        bad = [k for k, f in part["fields"].items() if f["status"] in ("mismatch", "error")]
        if bad:
            print("  Расхождения:", ", ".join(bad))
    print("Сверка вычисляемых: OK" if rep["ok"] else f"Есть расхождения, см. {SNAP / 'report-computed.json'}")
    return 0 if rep["ok"] else 1


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="python -m migrate", description=__doc__)
    p.add_argument("command", choices=["fetch", "load", "views", "verify", "compute-verify", "all"])
    p.add_argument("--no-files", action="store_true", help="без вложений; докачать — тот же fetch без флага")
    a = p.parse_args(argv)
    fetch = lambda: cmd_fetch(files=not a.no_files)  # noqa: E731
    steps = {"fetch": [fetch], "load": [cmd_load], "views": [cmd_views], "verify": [cmd_verify], "compute-verify": [cmd_compute_verify],
             "all": [fetch, cmd_load, cmd_verify]}[a.command]
    for step in steps:
        code = step()
        if code:
            return code
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""fetch: схема, записи и вложения Airtable → снимок на диске."""
import json
import re
from pathlib import Path

_ATT = re.compile(r"att[A-Za-z0-9]{14}")


def att_path(files: Path, att_id: str) -> Path:
    # id идёт в имя файла — проверяем, чтобы не вышло за каталог
    if not _ATT.fullmatch(att_id):
        raise ValueError(f"Неверный id вложения: {att_id!r}")
    return files / att_id


def fetch_snapshot(client, out: Path) -> dict[str, int]:
    tables = client.schema()
    (out / "records").mkdir(parents=True, exist_ok=True)
    files = out / "files"
    files.mkdir(exist_ok=True)
    (out / "schema.json").write_text(json.dumps(tables, ensure_ascii=False, indent=1), encoding="utf-8")
    counts = {}
    for t in tables:
        att_fields = [f["id"] for f in t["fields"] if f["type"] == "multipleAttachments"]
        n = 0
        with open(out / "records" / f"{t['id']}.jsonl", "w", encoding="utf-8") as fh:
            for page in client.pages(t["id"]):
                for r in page:
                    fh.write(json.dumps(r, ensure_ascii=False) + "\n")
                    # ссылки на вложения живут ~2 ч — качаем сразу, до следующей страницы
                    for fld in att_fields:
                        for a in r["fields"].get(fld, []):
                            dest = att_path(files, a["id"])
                            if not (dest.exists() and dest.stat().st_size == a.get("size")):
                                client.download(a["url"], dest)
                n += len(page)
        counts[t["id"]] = n
    return counts

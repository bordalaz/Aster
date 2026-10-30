"""fetch: схема, записи и вложения Airtable → снимок на диске."""
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

_ATT = re.compile(r"att[A-Za-z0-9]{14}")
WORKERS = 8  # файлы качаются параллельно: упираемся в скорость отдачи, не в лимит API


def att_path(files: Path, att_id: str) -> Path:
    # id идёт в имя файла — проверяем, чтобы не вышло за каталог
    if not _ATT.fullmatch(att_id):
        raise ValueError(f"Неверный id вложения: {att_id!r}")
    return files / att_id


def fetch_snapshot(client, out: Path, workers: int = WORKERS, files: bool = True) -> dict[str, int]:
    """files=False — только записи; файлы докачает следующий fetch (ссылки берёт свежие)."""
    # маркер: снимок целый. Нет маркера — load/verify откажутся (полуснимок затёр бы связи и вложения)
    done = out / "complete"
    done.unlink(missing_ok=True)
    tables = client.schema()
    (out / "records").mkdir(parents=True, exist_ok=True)
    fdir = out / "files"
    fdir.mkdir(exist_ok=True)
    (out / "schema.json").write_text(json.dumps(tables, ensure_ascii=False, indent=1), encoding="utf-8")
    counts = {}
    pool = ThreadPoolExecutor(workers)
    queued = set()  # одно вложение бывает в нескольких записях — качаем один раз
    for t in tables:
        att_fields = [f["id"] for f in t["fields"] if files and f["type"] == "multipleAttachments"]
        n = 0
        with open(out / "records" / f"{t['id']}.jsonl", "w", encoding="utf-8") as fh:
            for page in client.pages(t["id"]):
                jobs = []
                for r in page:
                    fh.write(json.dumps(r, ensure_ascii=False) + "\n")
                    for fld in att_fields:
                        for a in r["fields"].get(fld, []):
                            dest = att_path(fdir, a["id"])
                            if a["id"] in queued or (dest.exists() and dest.stat().st_size == a.get("size")):
                                continue
                            queued.add(a["id"])
                            jobs.append(pool.submit(client.download, a["url"], dest))
                # ссылки на вложения живут ~2 ч — докачиваем страницу до запроса следующей
                for j in jobs:
                    j.result()
                n += len(page)
        counts[t["id"]] = n
    pool.shutdown()
    done.touch()
    return counts

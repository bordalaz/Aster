"""Клиент Airtable API: не больше rate запросов/с, на 429 — пауза 30 с и повтор."""
import os
import time
from pathlib import Path
from typing import Iterator

import httpx

API = "https://api.airtable.com/v0"
RETRY_429 = 30


class AirtableClient:
    def __init__(self, token: str, base_id: str, *, rate: float = 5.0,
                 transport: httpx.BaseTransport | None = None, sleep=time.sleep, clock=time.monotonic):
        self.base = base_id
        self.interval = 1 / rate
        self.sleep, self.clock = sleep, clock
        self.last = None
        self.auth = {"Authorization": f"Bearer {token}"}
        self.http = httpx.Client(transport=transport, timeout=60)

    def _get(self, url: str, params: dict | None = None) -> httpx.Response:
        while True:
            if self.last is not None:
                wait = self.last + self.interval - self.clock()
                if wait > 0:
                    self.sleep(wait)
            self.last = self.clock()
            r = self.http.get(url, params=params, headers=self.auth)
            if r.status_code == 429:
                self.sleep(RETRY_429)
                continue
            if not r.is_success:
                # только код и путь: в заголовках токен, в тексте ошибки его нет
                raise RuntimeError(f"Airtable ответил {r.status_code} на {r.request.url.path}")
            return r

    def schema(self) -> list[dict]:
        # visibleFieldIds — видимые колонки grid-видов по порядку (для переноса видов)
        return self._get(f"{API}/meta/bases/{self.base}/tables", {"include": "visibleFieldIds"}).json()["tables"]

    def pages(self, table_id: str) -> Iterator[list[dict]]:
        params = {"pageSize": 100, "returnFieldsByFieldId": "true", "cellFormat": "json"}
        while True:
            data = self._get(f"{API}/{self.base}/{table_id}", params).json()
            yield data["records"]
            if "offset" not in data:
                return
            params = {**params, "offset": data["offset"]}

    def download(self, url: str, dest: Path) -> int:
        """Вызывается из нескольких потоков: лимит 5/с — для API, на файлы не действует; токен не шлём."""
        while True:
            r = self.http.get(url)
            if r.status_code != 429:
                break
            self.sleep(RETRY_429)
        if not r.is_success:
            raise RuntimeError(f"Airtable ответил {r.status_code} на скачивание вложения")
        body = r.content
        tmp = dest.with_name(dest.name + ".part")
        tmp.write_bytes(body)
        os.replace(tmp, dest)
        return len(body)

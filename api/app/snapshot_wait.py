"""snapshot-api: ждать, пока backup откроет снимок (база bd_snapshot), — без падений и перезапусков по кругу."""
import os
import time

from sqlalchemy import create_engine, text

e = create_engine(os.environ["DATABASE_URL"])
while True:
    try:
        with e.connect() as c:
            c.execute(text("select 1"))
        break
    except Exception:   # noqa: BLE001 — базы снимка ещё нет
        time.sleep(5)

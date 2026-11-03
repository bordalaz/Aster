import os
from contextlib import asynccontextmanager
import threading

from fastapi import FastAPI
from sqlalchemy import text

from . import attachments, auth, automations, calibration, forms, mail, meta, pages, records, trash, users, views
from .db import engine

@asynccontextmanager
async def lifespan(_app):
    # очередь и расписание автоматизаций; в тестах TestClient без «with» lifespan не запускается
    stop = threading.Event()
    if os.environ.get("AUTOMATIONS_WORKER", "1") == "1":
        threading.Thread(target=automations.worker, args=(stop,), daemon=True, name="automations").start()
    yield
    stop.set()


app = FastAPI(title="БД гидроканал", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(meta.router)
app.include_router(records.router)
app.include_router(users.router)
app.include_router(views.router)
app.include_router(forms.router)
app.include_router(attachments.router)
app.include_router(calibration.router)
app.include_router(pages.router)
app.include_router(mail.router)
app.include_router(trash.router)
app.include_router(automations.router)


@app.get("/api/health")
def health():
    with engine.connect() as c:
        c.execute(text("select 1"))
    return {"ok": True}

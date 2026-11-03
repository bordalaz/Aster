import os
from contextlib import asynccontextmanager
import threading

from fastapi import Depends, FastAPI, Request
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import JSONResponse
from sqlalchemy import text

from . import attachments, auth, automations, calibration, forms, mail, meta, pages, records, snapshots, trash, users, views
from .db import SNAPSHOT, engine

@asynccontextmanager
async def lifespan(_app):
    # очередь и расписание автоматизаций; в тестах TestClient без «with» lifespan не запускается
    stop = threading.Event()
    if os.environ.get("AUTOMATIONS_WORKER", "1") == "1":
        threading.Thread(target=automations.worker, args=(stop,), daemon=True, name="automations").start()
    if os.environ.get("SNAPSHOT_WATCH", "1") == "1":   # откат базы / новый открытый снимок → перезапуск
        threading.Thread(target=snapshots.watch, args=(stop,), daemon=True, name="snapshot-watch").start()
    yield
    stop.set()


# схема API — не всем: /docs и /openapi.json выключены, админам — /api/docs (схема по сессии)
app = FastAPI(title="БД гидроканал", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

SECURE = {"X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin"}


@app.middleware("http")
async def snapshot_read_only(request: Request, call_next):
    """Экземпляр снимка — только просмотр: менять нечего (и БД запись не примет)."""
    if SNAPSHOT and request.method not in ("GET", "HEAD", "OPTIONS"):
        return JSONResponse({"detail": "Это снимок — только просмотр"}, status_code=405)
    return await call_next(request)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Заголовки защиты на каждый ответ: не встраивать во фрейм (clickjacking), не угадывать тип, HSTS за https."""
    resp = await call_next(request)
    for k, v in SECURE.items():
        resp.headers.setdefault(k, v)
    csp = resp.headers.get("content-security-policy")
    if csp is None and not request.url.path.startswith("/api/docs"):
        resp.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"   # API отдаёт JSON и файлы
    elif csp is not None and "frame-ancestors" not in csp:
        resp.headers["Content-Security-Policy"] = csp + "; frame-ancestors 'none'"
    if os.environ.get("COOKIE_SECURE", "1") != "0":
        resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    return resp
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
app.include_router(snapshots.router)


@app.get("/api/health")
def health():
    with engine.connect() as c:
        c.execute(text("select 1"))
    return {"ok": True}


@app.get("/api/openapi.json", include_in_schema=False)
def openapi(user: dict = Depends(auth.admin_user)):
    return app.openapi()


@app.get("/api/docs", include_in_schema=False)
def docs(user: dict = Depends(auth.admin_user)):
    return get_swagger_ui_html(openapi_url="/api/openapi.json", title="API — БД гидроканал")

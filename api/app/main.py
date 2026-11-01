from fastapi import FastAPI
from sqlalchemy import text

from . import attachments, auth, calibration, forms, maintenance, meta, records, users, views
from .db import engine

app = FastAPI(title="БД гидроканал")
app.include_router(auth.router)
app.include_router(meta.router)
app.include_router(records.router)
app.include_router(users.router)
app.include_router(views.router)
app.include_router(forms.router)
app.include_router(attachments.router)
app.include_router(calibration.router)
app.include_router(maintenance.router)


@app.get("/api/health")
def health():
    with engine.connect() as c:
        c.execute(text("select 1"))
    return {"ok": True}

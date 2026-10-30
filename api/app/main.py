from fastapi import FastAPI
from sqlalchemy import text

from . import auth, meta, records
from .db import engine

app = FastAPI(title="БД гидроканал")
app.include_router(auth.router)
app.include_router(meta.router)
app.include_router(records.router)


@app.get("/api/health")
def health():
    with engine.connect() as c:
        c.execute(text("select 1"))
    return {"ok": True}

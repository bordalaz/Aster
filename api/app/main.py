from fastapi import FastAPI
from sqlalchemy import text

from .db import engine

app = FastAPI(title="БД гидроканал")


@app.get("/api/health")
def health():
    with engine.connect() as c:
        c.execute(text("select 1"))
    return {"ok": True}

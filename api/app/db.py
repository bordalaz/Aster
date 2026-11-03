import os

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

# SNAPSHOT_MODE=1 — экземпляр «Открыть снимок» (сервис snapshot-api): та же программа на базе снимка,
# любая запись запрещена самой БД
SNAPSHOT = os.environ.get("SNAPSHOT_MODE") == "1"
engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True,
                       connect_args={"options": "-c default_transaction_read_only=on"} if SNAPSHOT else {})
# служебная база снимков (её ведёт контейнер backup): список снимков, задания, состояние — откат bd её не трогает
ops = create_engine(os.environ.get("OPS_DATABASE_URL") or make_url(os.environ["DATABASE_URL"]).set(database="bd_ops"),
                    pool_pre_ping=True)

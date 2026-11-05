"""Индекс по второй стороне таблиц связей (dst): «кто связан с этой записью» с обратной стороны и удаление
записи (каскад по dst) не читают всю таблицу пар. Первичный ключ (src, dst) покрывает только сторону src."""
from alembic import op
from sqlalchemy import text

revision = "0020"
down_revision = "0019"


def _link_tables():
    c = op.get_bind()
    if not c.execute(text("select to_regclass('at_link_meta')")).scalar():
        return []
    return [r[0] for r in c.execute(text("select distinct link_table from at_link_meta"))]


def upgrade():
    for lt in _link_tables():
        op.execute(f"create index if not exists {lt}_dst on {lt} (dst)")


def downgrade():
    for lt in _link_tables():
        op.execute(f"drop index if exists {lt}_dst")

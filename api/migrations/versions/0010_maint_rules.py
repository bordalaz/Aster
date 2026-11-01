"""app_maint_rule: регламент ТО (R17) — правит админ; начальное наполнение из таблицы спеки"""
import json

from alembic import op
from sqlalchemy import text

revision = "0010"
down_revision = "0009"


def upgrade():
    from app.maintenance_rules import SEED
    op.execute("""create table app_maint_rule (
        id serial primary key,
        match jsonb not null,          -- префиксы наименования номенклатуры или «тип:Трубное»
        kind text not null check (kind in ('to', 'defect', 'calib')),
        level text,                    -- ТО-1 | ТО-1/ТО-2 | ТО-2 | ТО-3 (для kind = to)
        hours numeric,
        months int,
        on_arrival boolean not null default false,
        resets jsonb not null default '[]',
        sort_order int not null default 0
    )""")
    conn = op.get_bind()
    for i, r in enumerate(SEED):
        conn.execute(text(
            "insert into app_maint_rule (match, kind, level, hours, months, on_arrival, resets, sort_order) "
            "values (cast(:m as jsonb), :k, :l, :h, :mo, :a, cast(:r as jsonb), :o)"),
            {"m": json.dumps(r.match, ensure_ascii=False), "k": r.kind, "l": r.level, "h": r.hours, "mo": r.months,
             "a": r.on_arrival, "r": json.dumps(r.resets, ensure_ascii=False), "o": i})


def downgrade():
    op.execute("drop table app_maint_rule")

"""Габарит кожуха 190/203 → 8 (решение владельца 2026-11-01, R26)"""
from alembic import op

revision = "0011"
down_revision = "0010"


def upgrade():
    op.execute("insert into app_housing_size values ('190/203', '8') on conflict (pattern) do nothing")


def downgrade():
    op.execute("delete from app_housing_size where pattern = '190/203'")

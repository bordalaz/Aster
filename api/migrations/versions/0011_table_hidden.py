"""Скрытые таблицы — как «N hidden tables» в Airtable (общий для базы признак)"""
from alembic import op

revision = "0011"
down_revision = "0010"


def upgrade():
    op.execute("alter table app_table add column hidden boolean not null default false")


def downgrade():
    op.execute("alter table app_table drop column hidden")

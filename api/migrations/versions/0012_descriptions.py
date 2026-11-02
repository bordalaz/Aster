"""Описания таблиц и полей — ⓘ в Airtable"""
from alembic import op

revision = "0012"
down_revision = "0011"


def upgrade():
    op.execute("alter table app_table add column description text")
    op.execute("alter table app_field add column description text")


def downgrade():
    op.execute("alter table app_field drop column description")
    op.execute("alter table app_table drop column description")

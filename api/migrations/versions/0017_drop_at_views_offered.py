"""Личные виды Airtable — всем админам, без предложения автору (решение владельца): отметка не нужна."""
from alembic import op

revision = "0017"
down_revision = "0016"


def upgrade():
    op.execute("alter table app_user drop column at_views_offered")


def downgrade():
    op.execute("alter table app_user add column at_views_offered boolean not null default false")

"""app_user: must_change_password, blocked; one superadmin"""
from alembic import op

revision = "0004"
down_revision = "0003"


def upgrade():
    op.execute("alter table app_user add column must_change_password boolean not null default false")
    op.execute("alter table app_user add column blocked boolean not null default false")
    op.execute("create unique index app_user_one_superadmin on app_user (role) where role = 'superadmin'")


def downgrade():
    op.execute("drop index app_user_one_superadmin")
    op.execute("alter table app_user drop column blocked")
    op.execute("alter table app_user drop column must_change_password")

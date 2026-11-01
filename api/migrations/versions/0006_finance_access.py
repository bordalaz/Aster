"""app_user.finance_access: доступ к финансовым таблицам на просмотр (выдаёт суперадмин)"""
from alembic import op

revision = "0006"
down_revision = "0005"


def upgrade():
    op.execute("alter table app_user add column finance_access boolean not null default false")


def downgrade():
    op.execute("alter table app_user drop column finance_access")

"""Автоматизации: плановый запуск помечается в app_automation (не по журналу), повторы заданий очереди."""
from alembic import op

revision = "0019"
down_revision = "0018"


def upgrade():
    # день последнего планового запуска (по Томску): ручной «Запустить сейчас» его не трогает
    op.execute("alter table app_automation add column last_scheduled date")
    op.execute("""update app_automation a set last_scheduled = (
        select max((r.at at time zone 'Asia/Tomsk')::date) from app_automation_run r where r.key = a.key)""")
    op.execute("alter table app_automation_job add column attempts int not null default 0, "
               "add column next_at timestamptz not null default now()")


def downgrade():
    op.execute("alter table app_automation_job drop column attempts, drop column next_at")
    op.execute("alter table app_automation drop column last_scheduled")

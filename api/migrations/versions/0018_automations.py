"""Автоматизации: состояние (вкл/выкл, настройки), очередь заданий, журнал запусков.

Задание ставится в той же транзакции, что и правка записи (выполнится только закоммиченное);
фоновый обработчик (app.automations.worker) выполняет очередь и расписание."""
from alembic import op

revision = "0018"
down_revision = "0017"


def upgrade():
    op.execute("""create table app_automation (
        key text primary key,
        enabled boolean not null,
        settings jsonb not null default '{}'
    )""")
    # как в Airtable: включены рабочие; письмо — выключено, пока Airtable шлёт то же самое (иначе дубли)
    op.execute("""insert into app_automation (key, enabled) values
        ('mail_peremeshcheniya', false), ('defektoskopiya', true), ('narabotka', true), ('sborka_primechanie', true)""")
    op.execute("""create table app_automation_job (
        id serial primary key,
        key text not null,
        table_id int,
        record_id int,
        created_at timestamptz not null default now()
    )""")
    op.execute("""create table app_automation_run (
        id serial primary key,
        key text not null,
        at timestamptz not null default now(),
        ok boolean not null,
        message text not null default '',
        table_id int,
        record_id int
    )""")
    op.execute("create index app_automation_run_key on app_automation_run (key, at desc)")


def downgrade():
    op.execute("drop table app_automation_run")
    op.execute("drop table app_automation_job")
    op.execute("drop table app_automation")

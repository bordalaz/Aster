"""app_form: формы ввода (R12); app_form_submit: ключ отправки → запись (E6)"""
from alembic import op

revision = "0007"
down_revision = "0006"


def upgrade():
    op.execute("""create table app_form (
        id serial primary key,
        table_id int not null references app_table on delete cascade,
        title text not null,
        after_message text,
        fields jsonb not null,              -- [{col, required, help}] по порядку
        sort_order int not null default 0,
        airtable_id text unique
    )""")
    op.execute("""create table app_form_submit (
        key text primary key,               -- ключ отправки с клиента: повтор → та же запись
        form_id int not null references app_form on delete cascade,
        record_id int not null,
        user_id int references app_user,
        at timestamptz not null default now()
    )""")


def downgrade():
    op.execute("drop table app_form_submit")
    op.execute("drop table app_form")

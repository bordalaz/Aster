"""app_change: история изменений записей (кто, когда, поле, было -> стало)"""
from alembic import op

revision = "0005"
down_revision = "0004"


def upgrade():
    op.execute("""create table app_change (
        id bigserial primary key,
        table_id int not null references app_table on delete cascade,
        record_id int not null,
        column_name text not null,
        old jsonb,
        new jsonb,
        user_id int references app_user,   -- null = система (spec A2)
        at timestamptz not null default now()
    )""")
    op.execute("create index app_change_record on app_change (table_id, record_id, at desc)")


def downgrade():
    op.execute("drop table app_change")

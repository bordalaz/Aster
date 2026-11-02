"""app_trash: корзина удалённых записей — строка и её связи целиком, восстановление с тем же id"""
from alembic import op

revision = "0015"
down_revision = "0014"


def upgrade():
    op.execute("""create table app_trash (
        id serial primary key,
        table_id int not null references app_table(id) on delete cascade,
        record_id int not null,
        title text not null default '',
        data jsonb not null,              -- {"row": {...}, "links": [{"table": l_..., "rows": [...]}]}
        deleted_at timestamptz not null default now(),
        deleted_by int references app_user(id)
    )""")
    op.execute("create index app_trash_table on app_trash (table_id, record_id)")
    op.execute("create index app_trash_deleted on app_trash (deleted_at)")


def downgrade():
    op.execute("drop table app_trash")

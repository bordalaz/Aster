"""app_comment: комментарии к записям — правая панель карточки, как в Airtable"""
from alembic import op

revision = "0013"
down_revision = "0012"


def upgrade():
    op.execute("""create table app_comment (
        id bigserial primary key,
        table_id int not null references app_table on delete cascade,
        record_id int not null,
        user_id int not null references app_user,
        text text not null check (length(text) between 1 and 10000),
        at timestamptz not null default now()
    )""")
    op.execute("create index app_comment_record on app_comment (table_id, record_id, at)")


def downgrade():
    op.execute("drop table app_comment")

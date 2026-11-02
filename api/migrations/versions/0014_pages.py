"""app_page: страницы интерфейсов Airtable (дашборды)"""
from alembic import op

revision = "0014"
down_revision = "0013"


def upgrade():
    op.execute("""create table app_page (
        id serial primary key,
        title text not null,
        config jsonb not null,
        sort_order int not null default 0,
        airtable_id text unique
    )""")


def downgrade():
    op.execute("drop table app_page")

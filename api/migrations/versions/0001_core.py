"""core tables: users, sessions, metadata"""
from alembic import op

revision = "0001"
down_revision = None

STATEMENTS = [
    """create table app_user (
        id serial primary key,
        login text unique not null,
        name text not null,
        password_hash text not null,
        role text not null default 'user' check (role in ('superadmin', 'admin', 'storekeeper', 'user')),
        created_at timestamptz not null default now()
    )""",
    """create table app_session (
        token text primary key,
        user_id int not null references app_user on delete cascade,
        expires_at timestamptz not null
    )""",
    """create table app_table (
        id serial primary key,
        pg_name text unique not null,
        title text not null,
        primary_field text not null,
        sort_order int not null default 0,
        airtable_id text unique
    )""",
    """create table app_field (
        id serial primary key,
        table_id int not null references app_table on delete cascade,
        column_name text not null,
        title text not null,
        kind text not null,
        editable boolean not null default true,
        sort_order int not null default 0,
        options jsonb not null default '{}',
        airtable_id text,
        unique (table_id, column_name)
    )""",
    """create table app_view (
        id serial primary key,
        table_id int not null references app_table on delete cascade,
        title text not null,
        kind text not null default 'grid',
        owner_id int references app_user on delete cascade,
        config jsonb not null default '{}',
        sort_order int not null default 0,
        airtable_id text unique
    )""",
]


def upgrade():
    for s in STATEMENTS:
        op.execute(s)


def downgrade():
    for t in ("app_view", "app_field", "app_table", "app_session", "app_user"):
        op.execute(f"drop table {t}")

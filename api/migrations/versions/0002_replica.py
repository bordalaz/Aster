"""replica service tables: attachments, expected computed values, link metadata"""
from alembic import op

revision = "0002"
down_revision = "0001"

STATEMENTS = [
    """create table attachment (
        id serial primary key,
        table_id text not null,
        record_airtable_id text not null,
        field_id text not null,
        pos int not null,
        airtable_att_id text unique not null,
        filename text,
        mime text,
        size bigint,
        path text
    )""",
    """create table at_computed (
        table_id text not null,
        record_airtable_id text not null,
        field_id text not null,
        value jsonb,
        primary key (table_id, record_airtable_id, field_id)
    )""",
    """create table at_link_meta (
        field_id text primary key,
        link_table text not null,
        side text not null check (side in ('src', 'dst'))
    )""",
]


def upgrade():
    for s in STATEMENTS:
        op.execute(s)


def downgrade():
    for t in ("at_link_meta", "at_computed", "attachment"):
        op.execute(f"drop table {t}")

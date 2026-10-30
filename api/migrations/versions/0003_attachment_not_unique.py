"""attachment: one Airtable attachment id can sit in several records"""
from alembic import op

revision = "0003"
down_revision = "0002"


def upgrade():
    op.execute("alter table attachment drop constraint attachment_airtable_att_id_key")
    op.execute("create index attachment_airtable_att_id on attachment (airtable_att_id)")


def downgrade():
    op.execute("drop index attachment_airtable_att_id")
    op.execute("alter table attachment add constraint attachment_airtable_att_id_key unique (airtable_att_id)")

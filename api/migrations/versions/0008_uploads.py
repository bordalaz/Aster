"""attachment: загрузки из приложения — кто/когда; до привязки к записи поля записи пустые"""
from alembic import op

revision = "0008"
down_revision = "0007"


def upgrade():
    for col in ("table_id", "record_airtable_id", "field_id", "pos", "airtable_att_id"):
        op.execute(f"alter table attachment alter column {col} drop not null")
    op.execute("alter table attachment add column uploaded_by int references app_user")
    op.execute("alter table attachment add column uploaded_at timestamptz not null default now()")
    op.execute("create index attachment_record on attachment (table_id, record_airtable_id)")


def downgrade():
    op.execute("drop index attachment_record")
    op.execute("alter table attachment drop column uploaded_at")
    op.execute("alter table attachment drop column uploaded_by")

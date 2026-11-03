"""Личные виды Airtable: автор вида (at_owner) и отметка, что пользователю уже предложили взять свои виды.

at_owner задан и owner_id пуст — личный вид Airtable, ещё ничей: видят админы и суперадмин;
пользователь, чьё имя совпало с автором, получает их на выбор (копии становятся его личными видами)."""
from alembic import op

revision = "0016"
down_revision = "0015"


def upgrade():
    op.execute("alter table app_view add column at_owner jsonb")        # {"id": "usr…", "name": "Юрий Чернов", "email": …}
    op.execute("alter table app_user add column at_views_offered boolean not null default false")


def downgrade():
    op.execute("alter table app_user drop column at_views_offered")
    op.execute("alter table app_view drop column at_owner")

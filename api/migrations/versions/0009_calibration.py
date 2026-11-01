"""app_calibration: калибровки (R22, R23); app_housing_size: габарит кожуха по номенклатуре (R26);
attachment.original_name: исходное имя переименованного файла (R25)"""
from alembic import op

revision = "0009"
down_revision = "0008"


def upgrade():
    op.execute("""create table app_calibration (
        id serial primary key,
        at date not null,
        equipment_id int not null,          -- МИР или одиночный прибор (запись Оборудования)
        housing_id int,                     -- кожух — только у МИРа
        note text,
        created_by int references app_user,
        created_at timestamptz not null default now(),
        submit_key text unique              -- повторная отправка → та же запись (E6)
    )""")
    op.execute("create index app_calibration_eq on app_calibration (equipment_id)")
    op.execute("create index app_calibration_h on app_calibration (housing_id)")
    op.execute("create table app_housing_size (pattern text primary key, size text not null)")
    op.execute("insert into app_housing_size values ('121/130', '4.75'), ('166/181', '6.75'), ('190/213', '8')")
    op.execute("alter table attachment add column original_name text")


def downgrade():
    op.execute("alter table attachment drop column original_name")
    op.execute("drop table app_housing_size")
    op.execute("drop table app_calibration")

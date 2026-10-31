"""Права на таблицы по ролям (spec R3–R5, R8)."""
from fastapi import HTTPException
from sqlalchemy import text

from .auth import ADMINS

# ponytail: группы — по названию таблицы; если таблицы начнут переименовывать — колонка в app_table
FINANCE = {"Договоры", "СЧФ", "СЧФ 23 счет", "Подрядчики", "Работы подрядчики"}
ZIP = {"ЗИП APS", "Ведомость ЗИП", "Спецификации ЗИП"}
SERVICE = {"AddDataToZIP", "AddAdressToZIP"}   # служебные Airtable, не переносятся (R8)


def can_read(user: dict, title: str) -> bool:
    if title in SERVICE:
        return False
    return user["role"] in ADMINS or title not in FINANCE


def can_edit(user: dict, title: str) -> bool:
    if not can_read(user, title):
        return False
    return user["role"] in ADMINS or (user["role"] == "storekeeper" and title in ZIP)


def table_title(c, table_id: int, user: dict) -> str:
    """Название видимой пользователю таблицы; невидимая — 404, как несуществующая."""
    title = c.execute(text("select title from app_table where id = :t"), {"t": table_id}).scalar()
    if title is None or not can_read(user, title):
        raise HTTPException(404, "Нет такой таблицы")
    return title

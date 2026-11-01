"""Права на таблицы по ролям (spec R3–R5, R8)."""
from fastapi import HTTPException
from sqlalchemy import text

from .auth import ADMINS

# ponytail: группы — по названию таблицы; если таблицы начнут переименовывать — колонка в app_table
FINANCE = {"Договоры", "СЧФ", "СЧФ 23 счет", "Подрядчики", "Работы подрядчики"}
ZIP = {"ЗИП APS", "Ведомость ЗИП", "Спецификации ЗИП"}
SERVICE = {"AddDataToZIP", "AddAdressToZIP"}   # служебные Airtable, не переносятся (R8)


def sees_finance(user: dict) -> bool:
    """Финансы видят админы и те, кому суперадмин выдал доступ (только просмотр: can_edit — по роли)."""
    return user["role"] in ADMINS or bool(user.get("finance_access"))


def can_read(user: dict, title: str) -> bool:
    if title in SERVICE:
        return False
    return title not in FINANCE or sees_finance(user)


def hidden_columns(c, user: dict, table_id: int) -> set[str]:
    """Колонки таблицы, чьи данные идут из финансов: ссылки на финансовые таблицы, rollup/lookup/count
    через них и формулы/rollup поверх таких полей — по цепочке. Для тех, кто финансы видит, — пусто."""
    if sees_finance(user):
        return set()
    rows = c.execute(text(
        "select f.table_id, f.column_name, f.airtable_id, f.options, t.title, "
        "f.column_name = t.primary_field as is_primary from app_field f "
        "join app_table t on t.id = f.table_id")).all()
    fin_tables = set(c.execute(text("select airtable_id from app_table where title = any(:f)"), {"f": list(FINANCE)}).scalars())
    hidden = {r.airtable_id for r in rows if r.title in FINANCE}
    hidden |= {r.airtable_id for r in rows if (r.options or {}).get("linkedTableId") in fin_tables}
    # ponytail: первичное поле не скрываем никогда — без него таблица и ссылки на неё не работают
    deps = {r.airtable_id: {(r.options or {}).get("recordLinkFieldId"), (r.options or {}).get("fieldIdInLinkedTable"),
                            *((r.options or {}).get("referencedFieldIds") or [])} for r in rows if not r.is_primary}
    hidden.discard(None)
    for d in deps.values():
        d.discard(None)
    grew = True
    while grew:   # ponytail: простой фикспойнт по всем полям базы (~сотни) на запрос
        new = {f for f, d in deps.items() if f not in hidden and d & hidden}
        hidden |= new
        grew = bool(new)
    return {r.column_name for r in rows if r.table_id == table_id and r.airtable_id in hidden}


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

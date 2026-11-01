"""Признаки таблиц из веб-клиента Airtable (at_base_schema.json): скрытые таблицы."""
from sqlalchemy import text


def apply_hidden(conn, base: dict) -> int:
    """isHiddenFromSwitcher → app_table.hidden; возвращает число найденных у нас таблиц."""
    n = 0
    for t in base["tableSchemas"]:
        n += conn.execute(text("update app_table set hidden = :h where airtable_id = :a"),
                          {"h": bool(t.get("isHiddenFromSwitcher")), "a": t["id"]}).rowcount
    return n

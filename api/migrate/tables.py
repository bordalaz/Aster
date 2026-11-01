"""Признаки таблиц из веб-клиента Airtable (at_base_schema.json): скрытые таблицы."""
from sqlalchemy import text


def apply_hidden(conn, base: dict) -> int:
    """isHiddenFromSwitcher → app_table.hidden; возвращает число найденных у нас таблиц."""
    n = 0
    for t in base["tableSchemas"]:
        n += conn.execute(text("update app_table set hidden = :h where airtable_id = :a"),
                          {"h": bool(t.get("isHiddenFromSwitcher")), "a": t["id"]}).rowcount
    return n


def apply_descriptions(conn, schemas: list[dict]) -> int:
    """Описания таблиц и полей (схемы таблиц из обхода веб-клиента) → app_table/app_field.description."""
    n = 0
    for t in schemas:
        conn.execute(text("update app_table set description = :d where airtable_id = :a"),
                     {"d": t.get("description") or None, "a": t["id"]})
        for col in t.get("columns", []):
            n += conn.execute(text("update app_field set description = :d where airtable_id = :a"),
                              {"d": col.get("description") or None, "a": col["id"]}).rowcount
    return n

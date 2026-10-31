"""Виды Airtable → app_view. API отдаёт только название, тип и видимые колонки grid-видов;
фильтров и сортировок в нём нет — вид помечается source=airtable, сетка об этом предупреждает."""
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB


def load_views(c, schema: list[dict]) -> int:
    """Общие grid-виды (личные и прочие типы — вне v1). Повторный запуск обновляет по airtable_id."""
    tables = dict(c.execute(text("select airtable_id, id from app_table")).all())
    cols = dict(c.execute(text("select airtable_id, column_name from app_field where airtable_id is not null")).all())
    n = 0
    for t in schema:
        tid = tables.get(t["id"])
        if tid is None:
            continue
        for order, v in enumerate(t.get("views", [])):
            if v["type"] != "grid" or v.get("personalForUserId"):
                continue
            config = {"source": "airtable"}
            if "visibleFieldIds" in v:   # в старых снимках колонок нет — тогда видны все
                config["columns"] = [cols[f] for f in v["visibleFieldIds"] if f in cols]
            c.execute(text(
                "insert into app_view (table_id, title, kind, config, sort_order, airtable_id) "
                "values (:t, :n, 'grid', :c, :o, :a) "
                "on conflict (airtable_id) do update set title = excluded.title, config = excluded.config, "
                "sort_order = excluded.sort_order"
            ).bindparams(bindparam("c", type_=JSONB)), {"t": tid, "n": v["name"], "c": config, "o": order, "a": v["id"]})
            n += 1
    return n

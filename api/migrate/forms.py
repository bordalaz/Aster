"""Формы Airtable → app_form. Публичный API форм не отдаёт: состав снят из редактора форм
веб-клиента (data/snapshot/forms_airtable.jsonl): {view, table, after, fields: [{id, req, lines}]}."""
import re

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from app.access import SERVICE

# строки блока поля в редакторе, которые не подсказка
_UI = {"Required", "*", "Add", "Select an option", "Attach file", "Drop files here", "Conditional field", "Submit"}
_UI_PREFIX = ("Format:", "Date format", "Time format")


def _help(lines: list[str], name: str) -> str | None:
    extra = [s for s in lines[1:] if s not in _UI and s != name and not s.startswith(_UI_PREFIX)]
    return " ".join(extra) or None


def load_forms(c, forms: list[dict], titles: dict) -> int:
    """titles — {id вида: название формы} из схемы. Повторно — обновление по airtable_id."""
    tables = {a: (i, t) for a, i, t in c.execute(text("select airtable_id, id, title from app_table")).all()}
    cols = dict(c.execute(text("select airtable_id, column_name from app_field where airtable_id is not null")).all())
    seen, n = set(), 0
    # из дублей оставляем форму с осмысленным названием, а не «Form 2»
    generic = lambda f: bool(re.fullmatch(r"Form( \d+)?", titles.get(f["view"], "")))  # noqa: E731
    for order, f in sorted(enumerate(forms), key=lambda p: generic(p[1])):
        if f["table"] not in tables or tables[f["table"]][1] in SERVICE:
            continue
        fields = [{"col": cols[x["id"]], "required": x["req"], "help": _help(x["lines"], x["lines"][0])}
                  for x in f["fields"] if x["id"] in cols]
        sig = (f["table"], tuple(x["col"] for x in fields))
        if sig in seen:   # форма-дубль той же таблицы с тем же набором полей
            continue
        seen.add(sig)
        c.execute(text(
            "insert into app_form (table_id, title, after_message, fields, sort_order, airtable_id) "
            "values (:t, :n, :m, :f, :o, :a) on conflict (airtable_id) do update set table_id = excluded.table_id, "
            "title = excluded.title, after_message = excluded.after_message, fields = excluded.fields, "
            "sort_order = excluded.sort_order"
        ).bindparams(bindparam("f", type_=JSONB)),
            {"t": tables[f["table"]][0], "n": titles.get(f["view"], f["view"]), "m": f.get("after"),
             "f": fields, "o": order, "a": f["view"]})
        n += 1
    return n

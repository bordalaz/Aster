"""Поля-кнопки Airtable → app_field.options: подпись, цвет, действие.

Действия (решение владельца для служебных форм):
- форма обычной таблицы → {"kind": "form", "form": id вида-формы, "prefill": [{"col", "from"|"value"|"record"}]}
  — открывается наша форма с подставленными значениями (как ?prefill_ в ссылке Airtable);
- форма служебной таблицы (AddDataToZIP/AddAdressToZIP: там автоматизация переносила данные в запись)
  → {"kind": "edit", "fields": [{"col", "required", "help"}]} — окно правки этих полей прямо в записи;
- скрипт (openBlock) → {"kind": "script"}: скрипты Airtable не перенесены, кнопка неактивна."""
import re
from urllib.parse import unquote

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from app.access import SERVICE

# два вида ссылок с предзаполнением: конструктор Airtable и написанная руками формула
_BUILDER = re.compile(r'prefill_" & ENCODE_URL_COMPONENT\("([^"]+)"\),\s*"=" & ENCODE_URL_COMPONENT\('
                      r'(?:\{column_value_(fld\w+)\} & ""|"([^"]*)")\)')
_HAND = re.compile(r"prefill_([^=']+)='\s*&\s*(?:(RECORD_ID\(\))|ENCODE_URL_COMPONENT\(\{column_value_(fld\w+)\}\))")


def prefills(formula: str) -> list[tuple[str, str]]:
    """[(название поля формы, источник)], источник — 'fld…' (поле записи), 'record' или '=значение'."""
    out = [(n, f or "=" + v) for n, f, v in _BUILDER.findall(formula)]
    out += [(unquote(n), "record" if r else f) for n, r, f in _HAND.findall(formula)]
    return out


def load_buttons(c, schema: dict, view_lines: list[dict]) -> int:
    share = {s: (x["tableId"], x["view"]["id"], x["viewData"]) for x in view_lines
             for s in (x["viewData"].get("sharesById") or {})}
    tables = {t["id"]: t for t in schema["tableSchemas"]}
    cols = dict(c.execute(text("select airtable_id, column_name from app_field where airtable_id is not null")).all())
    n = 0
    for t in tables.values():
        for f in t["columns"]:
            if f["type"] != "button" or f["id"] not in cols:
                continue
            to = f["typeOptions"]
            opts = {"label": to["label"].get("staticText") or f["name"], "variant": to["variant"].get("staticVariant")}
            formula = to.get("formulaTextParsed") or ""
            sh = re.search(r"shr\w{14}", formula)
            if to.get("actionType") == "openBlock":
                opts["action"] = {"kind": "script"}
            elif sh and sh.group() in share:
                form_table, form_view, vd = share[sh.group()]
                ft = tables[form_table]
                by_name = {x["name"]: x["id"] for x in ft["columns"]}
                pre = prefills(formula)
                if ft["name"] in SERVICE:
                    # поля формы, которые заполняет человек, — те же по названию в этой таблице
                    own = {x["name"]: x["id"] for x in t["columns"]}
                    meta = ((vd.get("metadata") or {}).get("form") or {}).get("fieldsByColumnId") or {}
                    filled = {name for name, _ in pre}
                    fields = []
                    for o in vd.get("columnOrder", []):
                        name = next((x["name"] for x in ft["columns"] if x["id"] == o["columnId"]), None)
                        if o.get("visibility") and name not in filled and own.get(name) in cols:
                            m = meta.get(o["columnId"]) or {}
                            fields.append({"col": cols[own[name]], "required": bool(m.get("required")), "help": m.get("description")})
                    opts["action"] = {"kind": "edit", "fields": fields}
                else:
                    items = []
                    for name, src in pre:
                        if by_name.get(name) not in cols:
                            continue
                        item = {"col": cols[by_name[name]]}
                        if src == "record":
                            item["record"] = True
                        elif src.startswith("="):
                            item["value"] = src[1:]
                        elif src in cols:
                            item["from"] = cols[src]
                        else:
                            continue
                        items.append(item)
                    opts["action"] = {"kind": "form", "form": form_view, "prefill": items}
            c.execute(text("update app_field set options = options || :o where airtable_id = :a")
                      .bindparams(bindparam("o", type_=JSONB)), {"o": opts, "a": f["id"]})
            n += 1
    return n

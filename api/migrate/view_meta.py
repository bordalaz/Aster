"""Полные настройки видов из веб-клиента Airtable (at_view_datas.jsonl, по строке на вид) → app_view.config.

Сверх load_views: ширины колонок, закреплённые колонки, высота строк, итоги внизу, цвет строк,
признак «вид закреплён», ручной порядок записей там, где сортировка в Airtable выключена
(shouldAutoSort = false — тогда Airtable показывает сохранённый порядок, а не сортирует)."""
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB

from .views import _filters, _record_names, convert_view, load_views

# Обложки галерей (Customize cards → Image field; везде Crop) — в снимках видов их нет, сняты из живого
# Airtable 2026-11-02, только чтение. Нет в словаре — без обложки.
COVERS = {"viwmuaVVgwHwQtGjN": "Вложения", "viwENZaTKU2ZiTgJ4": "Вложения", "viwKrdc09ARSmmwcj": "Attachments",
          "viw4TFdJq1QC0n22o": "Attachments", "viwZIsbMfWhbE71Lw": "Фото", "viw423cnrJ2mDKShH": "Фото"}


def compact(fs: dict | None) -> dict:
    """Фильтры веб-клиента {conjunction, filterSet} → формат load_views {c, f}."""
    if not fs:
        return {}
    out = []
    for x in fs.get("filterSet", []):
        if x.get("type") == "nested":
            out.append(compact(x))
        else:
            out.append([x["columnId"], x["operator"], x.get("value")])
    return {"c": fs.get("conjunction", "and"), "f": out}


def _raw(vd: dict) -> dict:
    s = vd.get("lastSortsApplied") or {}
    return {
        "f": compact(vd.get("filters")),
        "s": [[x["columnId"], x["ascending"]] for x in s.get("sortSet", [])] if s.get("shouldAutoSort") else [],
        "g": [[x["columnId"], x.get("order")] for x in vd.get("groupLevels") or []],
    }


def load_view_meta(c, lines: list[dict]) -> int:
    """Общие grid-виды: базовый перенос (load_views) + дополнительные настройки. Возвращает число видов."""
    schema, raw, by_table = {}, {}, {}
    for x in lines:
        v, vd = x["view"], x["viewData"]
        t = schema.setdefault(x["tableId"], {"id": x["tableId"], "name": x.get("table"), "views": []})
        visible = [o["columnId"] for o in vd.get("columnOrder", []) if o.get("visibility")]
        t["views"].append({**v, "visibleFieldIds": visible})
        raw[v["id"]] = _raw(vd)
        by_table[v["id"]] = x["tableId"]
    n = load_views(c, list(schema.values()), raw)

    cols = dict(c.execute(text("select airtable_id, column_name from app_field where airtable_id is not null")).all())
    recs = _record_names(c, {k: r for k, r in raw.items()})
    ids_cache: dict[str, dict] = {}

    def rec_ids(table_at: str) -> dict:
        if table_at not in ids_cache:
            pg = c.execute(text("select pg_name from app_table where airtable_id = :a"), {"a": table_at}).scalar()
            ids_cache[table_at] = dict(c.execute(text(f"select airtable_id, id from {pg}")).all()) if pg else {}
        return ids_cache[table_at]

    for x in lines:
        v, vd = x["view"], x["viewData"]
        if v["type"] != "grid":
            continue
        meta = (vd.get("metadata") or {}).get("grid", {})
        extra = {
            "widths": {cols[o["columnId"]]: o["width"] for o in vd.get("columnOrder", [])
                       if o.get("width") and o["columnId"] in cols and o.get("visibility")},
            "frozen": vd.get("frozenColumnCount", 1),
        }
        if meta.get("rowHeight"):
            extra["rowHeight"] = meta["rowHeight"]
        summary = {cols[k]: s["aggregationFunction"] for k, s in (meta.get("summaryBarConfigsByColumnId") or {}).items()
                   if k in cols and s.get("aggregationFunction") not in (None, "none")}
        if summary:
            extra["summary"] = summary
        cc = vd.get("colorConfig") or {}
        if cc.get("type") == "selectColumn" and cc.get("selectColumnId") in cols:
            extra["color"] = {"kind": "select", "col": cols[cc["selectColumnId"]]}
        elif cc.get("type") == "colorDefinitions":
            rules = []
            for d in cc.get("colorDefinitions") or []:
                problems = []
                f = _filters(compact(d), cols, recs, problems)
                if f and not problems:
                    rules.append({"color": d["color"], "filters": f})
            if rules:
                extra["color"] = {"kind": "rules", "rules": rules}
        if vd.get("lock"):
            extra["locked"] = True
        s = vd.get("lastSortsApplied") or {}
        if not s.get("shouldAutoSort") and vd.get("rowOrder"):
            ids = rec_ids(by_table[v["id"]])
            extra["rowOrder"] = [ids[r["rowId"]] for r in vd["rowOrder"] if r["rowId"] in ids]
        c.execute(text("update app_view set config = config || :e where airtable_id = :a")
                  .bindparams(bindparam("e", type_=JSONB)), {"e": extra, "a": v["id"]})
    return n + load_galleries(c, lines, raw, cols, recs, rec_ids) + load_kanbans(c, lines, raw, cols, recs, rec_ids) + load_calendars(c, lines, raw, cols, recs) + load_timelines(c, lines, raw, cols, recs, rec_ids) + load_lists(c, lines, cols, recs)


def _owner(v: dict) -> dict | None:
    """Личный вид Airtable — ничей, с автором (имя — tag_personal): иначе он стал бы общим."""
    u = v.get("personalForUserId")
    return {"id": u, "name": u} if u else None


def _color(cc: dict, cols, recs) -> dict | None:
    """colorConfig вида → наш цвет (по полю выбора или правилам), как у таблицы."""
    if cc.get("type") == "selectColumn" and cc.get("selectColumnId") in cols:
        return {"kind": "select", "col": cols[cc["selectColumnId"]]}
    if cc.get("type") == "colorDefinitions":
        rules = []
        for d in cc.get("colorDefinitions") or []:
            bad = []
            f = _filters(compact(d), cols, recs, bad)
            if f and not bad:
                rules.append({"color": d["color"], "filters": f})
        if rules:
            return {"kind": "rules", "rules": rules}
    return None


def load_lists(c, lines, cols, recs) -> int:
    """Виды «List» (levels) → app_view kind='list': уровни сверху вниз — таблица, связь с уровнем выше,
    колонки, ширины, фильтр уровня; последний уровень — эта таблица (leafLevel)."""
    tables = dict(c.execute(text("select airtable_id, id from app_table")).all())
    order: dict[str, int] = {}
    n = 0
    for x in lines:
        v, vd = x["view"], x["viewData"]
        i = order[x["tableId"]] = order.get(x["tableId"], -1) + 1
        tid = tables.get(x["tableId"])
        lc = ((vd.get("metadata") or {}).get("levels") or {}).get("levelsConfig") or {}
        if v["type"] != "levels" or tid is None or not lc.get("leafLevel"):
            continue
        levels, bad = [], []
        for lv in [*lc.get("orderedParentLevels", []), {**lc["leafLevel"], "tableId": x["tableId"]}]:
            if lv["tableId"] not in tables:
                bad.append(lv["tableId"])
                continue
            item = {"table": tables[lv["tableId"]],
                    "columns": [cols[f] for f in lv.get("allOrderedDisplayColumnIds", []) if f in cols],
                    "widths": {cols[f]: w for f, w in (lv.get("widthsByColumnId") or {}).items() if f in cols}}
            if lv.get("parentLinkedRecordColumnId") in cols:
                item["link"] = cols[lv["parentLinkedRecordColumnId"]]   # связь этого уровня с уровнем выше
            problems = []
            if lv.get("filters") and (f := _filters(compact(lv["filters"]), cols, recs, problems)) and not problems:
                item["filters"] = f
            levels.append(item)
        if bad:
            print(f"List «{x.get('table')} / {v['name']}»: нет таблиц {bad} — не перенесён")
            continue
        config = {"source": "airtable", "levels": levels}
        if lc.get("shouldHideEmptyParents"):
            config["hideEmpty"] = True
        c.execute(text(
            "insert into app_view (table_id, title, kind, config, sort_order, airtable_id, at_owner) "
            "values (:t, :n, 'list', :c, :o, :a, :w) "
            "on conflict (airtable_id) do update set title = excluded.title, kind = excluded.kind, "
            "config = excluded.config, sort_order = excluded.sort_order, at_owner = coalesce(app_view.at_owner, excluded.at_owner)"
        ).bindparams(bindparam("c", type_=JSONB), bindparam("w", type_=JSONB(none_as_null=True))),
            {"t": tid, "n": v["name"], "c": config, "o": i, "a": v["id"], "w": _owner(v)})
        n += 1
    return n


# Gantt Airtable (вид type='block'): его настройки (поля дат, подпись) живут в самом расширении и в снимок
# не попадают — сняты из «Gantt settings» в живом Airtable 2026-11-03 (личный «Юрий's Gantt» закрыт —
# поля как у «Ремонты ССК-Т / Timeline», цвет тот же). ponytail: новые Gantt'ы — дописать сюда.
GANTT = {
    "viweAEG5zF6sF8CUK": ("fldLE0FcT2JGCDb1i", "fldQu52mUc5Ye8tli", "fldULn7kqt8VtI5Lg"),   # Рейсы APS / График
    "viwMOPYTmvkMQ8BdD": ("fldLE0FcT2JGCDb1i", "fldQu52mUc5Ye8tli", "fldULn7kqt8VtI5Lg"),   # Рейсы APS / График с LWD
    "viwTd6Wr3xIviqvgW": ("fldXiAoCxgy8Eh1cS", "fldi7XBR7u7AjJHWW", "fldQffgFpKviZHJvC"),   # Работы / График
    "viwnfynOionSugbXN": ("fldkVKgfn2ox4k0W2", "fldAZVZJjHG9fwuDw", "fldT7uFHs45KRdMt0"),   # Ремонты ССК-Т / Юрий's Gantt
}


def load_timelines(c, lines, raw, cols, recs, rec_ids=None) -> int:
    """Общие таймлайны → app_view kind='timeline': start/end, подпись — видимые поля со стилем
    (labelConfigByColumnId), группировка (groupLevels[0], порядок, скрытие пустых), layoutMode=stacked,
    нижняя строка «Всего» (summaryBarsConfig: число записей по дням, цвет по порогам)."""
    tables = dict(c.execute(text("select airtable_id, id from app_table")).all())
    order: dict[str, int] = {}
    n = 0
    for x in lines:
        v, vd = x["view"], x["viewData"]
        i = order[x["tableId"]] = order.get(x["tableId"], -1) + 1
        tid = tables.get(x["tableId"])
        t = (vd.get("metadata") or {}).get("timeline") or {}
        rng = (t.get("dateColumnRanges") or [{}])[0]
        gantt = v["type"] == "block" and v["id"] in GANTT
        if gantt:
            rng = dict(zip(("startColumnId", "endColumnId", "label"), GANTT[v["id"]]))
        elif v["type"] != "timeline":
            continue
        if tid is None or rng.get("startColumnId") not in cols:
            continue
        config = {"source": "airtable", "start": cols[rng["startColumnId"]],
                  "columns": [cols[o["columnId"]] for o in vd.get("columnOrder", []) if o.get("visibility") and o["columnId"] in cols]}
        if gantt:   # строка на запись, подпись справа от полосы, масштаб «Квартал», ручной порядок
            config |= {"gantt": True, "columns": [cols[rng["label"]]] if rng["label"] in cols else [], "scale": "quarter"}
            s = vd.get("lastSortsApplied") or {}
            if rec_ids and not s.get("shouldAutoSort") and vd.get("rowOrder"):
                ids = rec_ids(x["tableId"])
                config["rowOrder"] = [ids[r["rowId"]] for r in vd["rowOrder"] if r["rowId"] in ids]
        if rng.get("endColumnId") in cols:
            config["end"] = cols[rng["endColumnId"]]
        extra, problems = convert_view(raw[v["id"]], cols, recs)
        config |= {k: val for k, val in extra.items() if k in ("filters", "sort")}
        for p in problems:
            print(f"Таймлайн «{x.get('table')} / {v['name']}»: фильтры не перенесены — {p}")
        if t.get("layoutMode") == "stacked":
            config["layout"] = "stacked"
        g = (vd.get("groupLevels") or [{}])[0]
        if g.get("columnId") in cols:
            config["group"] = [cols[g["columnId"]]]
            if g.get("order") == "descending":
                config["groupDesc"] = True
            if g.get("emptyGroupState") == "hidden":
                config["hideEmpty"] = True
        style = {cols[k]: {s: True for s, on in (("bold", st.get("isBold")), ("italic", st.get("isItalic")), ("underline", st.get("isUnderlined"))) if on}
                 for k, st in (t.get("labelConfigByColumnId") or {}).items() if k in cols}
        if style := {k: s for k, s in style.items() if s}:
            config["labelStyle"] = style
        sb = t.get("summaryBarsConfig") or {}
        if sb.get("shouldShowOnBottomSummaryBar") and sb.get("aggregationFunction") == "count":
            totals = {"label": (sb.get("label") or {}).get("customName") or "Всего"}
            rules = [{"op": d["filterSet"][0]["operator"], "value": d["filterSet"][0]["value"], "color": d["color"]}
                     for d in ((sb.get("color") or {}).get("colorDefinitions") or []) if len(d.get("filterSet") or []) == 1]
            if rules:
                totals["rules"] = rules
            config["totals"] = totals
        if color := _color(vd.get("colorConfig") or {}, cols, recs):
            config["color"] = color
        c.execute(text(
            "insert into app_view (table_id, title, kind, config, sort_order, airtable_id, at_owner) "
            "values (:t, :n, 'timeline', :c, :o, :a, :w) "
            "on conflict (airtable_id) do update set title = excluded.title, kind = excluded.kind, "
            "config = excluded.config, sort_order = excluded.sort_order, at_owner = coalesce(app_view.at_owner, excluded.at_owner)"
        ).bindparams(bindparam("c", type_=JSONB), bindparam("w", type_=JSONB(none_as_null=True))), {"t": tid, "n": v["name"], "c": config, "o": i, "a": v["id"], "w": _owner(v)})
        n += 1
    return n


def load_calendars(c, lines, raw, cols, recs) -> int:
    """Общие календари → app_view kind='calendar': start/end — metadata.calendar.dateColumnRanges[0],
    подпись — видимые поля (columnOrder), фильтр, цвет (colorConfig, как у таблицы)."""
    tables = dict(c.execute(text("select airtable_id, id from app_table")).all())
    order: dict[str, int] = {}
    n = 0
    for x in lines:
        v, vd = x["view"], x["viewData"]
        i = order[x["tableId"]] = order.get(x["tableId"], -1) + 1
        tid = tables.get(x["tableId"])
        rng = (((vd.get("metadata") or {}).get("calendar") or {}).get("dateColumnRanges") or [{}])[0]
        if v["type"] != "calendar" or tid is None or rng.get("startColumnId") not in cols:
            continue
        config = {"source": "airtable", "start": cols[rng["startColumnId"]],
                  "columns": [cols[o["columnId"]] for o in vd.get("columnOrder", []) if o.get("visibility") and o["columnId"] in cols]}
        if rng.get("endColumnId") in cols:
            config["end"] = cols[rng["endColumnId"]]
        extra, problems = convert_view(raw[v["id"]], cols, recs)
        config |= {k: val for k, val in extra.items() if k in ("filters", "sort")}
        for p in problems:
            print(f"Календарь «{x.get('table')} / {v['name']}»: фильтры не перенесены — {p}")
        cc = vd.get("colorConfig") or {}
        if cc.get("type") == "selectColumn" and cc.get("selectColumnId") in cols:
            config["color"] = {"kind": "select", "col": cols[cc["selectColumnId"]]}
        elif cc.get("type") == "colorDefinitions":
            rules = []
            for d in cc.get("colorDefinitions") or []:
                bad = []
                f = _filters(compact(d), cols, recs, bad)
                if f and not bad:
                    rules.append({"color": d["color"], "filters": f})
            if rules:
                config["color"] = {"kind": "rules", "rules": rules}
        c.execute(text(
            "insert into app_view (table_id, title, kind, config, sort_order, airtable_id, at_owner) "
            "values (:t, :n, 'calendar', :c, :o, :a, :w) "
            "on conflict (airtable_id) do update set title = excluded.title, kind = excluded.kind, "
            "config = excluded.config, sort_order = excluded.sort_order, at_owner = coalesce(app_view.at_owner, excluded.at_owner)"
        ).bindparams(bindparam("c", type_=JSONB), bindparam("w", type_=JSONB(none_as_null=True))), {"t": tid, "n": v["name"], "c": config, "o": i, "a": v["id"], "w": _owner(v)})
        n += 1
    return n


def load_kanbans(c, lines, raw, cols, recs, rec_ids) -> int:
    """Общие канбаны → app_view kind='kanban': колонки — по полю группировки (stack, одиночный выбор),
    emptyGroupState=hidden — пустые колонки не показывать; обложка — metadata.kanban.coverColumnId."""
    tables = dict(c.execute(text("select airtable_id, id from app_table")).all())
    order: dict[str, int] = {}
    n = 0
    for x in lines:
        v, vd = x["view"], x["viewData"]
        i = order[x["tableId"]] = order.get(x["tableId"], -1) + 1
        tid = tables.get(x["tableId"])
        g = (vd.get("groupLevels") or [{}])[0]
        if v["type"] != "kanban" or tid is None or g.get("columnId") not in cols:
            continue
        config = {"source": "airtable", "stack": cols[g["columnId"]],
                  "columns": [cols[o["columnId"]] for o in vd.get("columnOrder", []) if o.get("visibility") and o["columnId"] in cols]}
        if g.get("emptyGroupState") == "hidden":
            config["hideEmpty"] = True
        extra, problems = convert_view(raw[v["id"]], cols, recs)
        config |= {k: val for k, val in extra.items() if k != "group"}
        for p in problems:
            print(f"Канбан «{x.get('table')} / {v['name']}»: фильтры не перенесены — {p}")
        if (cover := ((vd.get("metadata") or {}).get("kanban") or {}).get("coverColumnId")) in cols:
            config["cover"] = cols[cover]
        s = vd.get("lastSortsApplied") or {}
        if not s.get("shouldAutoSort") and vd.get("rowOrder"):
            ids = rec_ids(x["tableId"])
            config["rowOrder"] = [ids[r["rowId"]] for r in vd["rowOrder"] if r["rowId"] in ids]
        c.execute(text(
            "insert into app_view (table_id, title, kind, config, sort_order, airtable_id, at_owner) "
            "values (:t, :n, 'kanban', :c, :o, :a, :w) "
            "on conflict (airtable_id) do update set title = excluded.title, kind = excluded.kind, "
            "config = excluded.config, sort_order = excluded.sort_order, at_owner = coalesce(app_view.at_owner, excluded.at_owner)"
        ).bindparams(bindparam("c", type_=JSONB), bindparam("w", type_=JSONB(none_as_null=True))), {"t": tid, "n": v["name"], "c": config, "o": i, "a": v["id"], "w": _owner(v)})
        n += 1
    return n


def load_galleries(c, lines, raw, cols, recs, rec_ids) -> int:
    """Общие галереи → app_view kind='gallery': поля карточки (видимые, первое — заголовок), фильтр,
    сортировка, ручной порядок, обложка (COVERS, по названию поля таблицы)."""
    tables = dict(c.execute(text("select airtable_id, id from app_table")).all())
    order: dict[str, int] = {}
    n = 0
    for x in lines:
        v, vd = x["view"], x["viewData"]
        i = order[x["tableId"]] = order.get(x["tableId"], -1) + 1   # место вида в таблице, как у load_views
        tid = tables.get(x["tableId"])
        if v["type"] != "gallery" or tid is None:
            continue
        config = {"source": "airtable",
                  "columns": [cols[o["columnId"]] for o in vd.get("columnOrder", []) if o.get("visibility") and o["columnId"] in cols]}
        extra, problems = convert_view(raw[v["id"]], cols, recs)
        config |= {k: val for k, val in extra.items() if k != "group"}   # в галерее групп нет
        for p in problems:
            print(f"Галерея «{x.get('table')} / {v['name']}»: фильтры не перенесены — {p}")
        if cover := COVERS.get(v["id"]):
            col = c.execute(text("select column_name from app_field where table_id = :t and title = :n and kind = 'multipleAttachments'"),
                            {"t": tid, "n": cover}).scalar()
            if col:
                config["cover"] = col
        s = vd.get("lastSortsApplied") or {}
        if not s.get("shouldAutoSort") and vd.get("rowOrder"):
            ids = rec_ids(x["tableId"])
            config["rowOrder"] = [ids[r["rowId"]] for r in vd["rowOrder"] if r["rowId"] in ids]
        c.execute(text(
            "insert into app_view (table_id, title, kind, config, sort_order, airtable_id, at_owner) "
            "values (:t, :n, 'gallery', :c, :o, :a, :w) "
            "on conflict (airtable_id) do update set title = excluded.title, kind = excluded.kind, "
            "config = excluded.config, sort_order = excluded.sort_order, at_owner = coalesce(app_view.at_owner, excluded.at_owner)"
        ).bindparams(bindparam("c", type_=JSONB), bindparam("w", type_=JSONB(none_as_null=True))), {"t": tid, "n": v["name"], "c": config, "o": i, "a": v["id"], "w": _owner(v)})
        n += 1
    return n


def collaborators(schema: dict) -> dict:
    """{usr…: {id, name, email}} — участники базы из снимка веб-клиента."""
    out = {}
    def walk(o):
        if isinstance(o, dict):
            if str(o.get("id", "")).startswith("usr") and "email" in o:
                name = " ".join(x for x in (o.get("firstName"), o.get("lastName")) if x) or o.get("name") or o["email"]
                out[o["id"]] = {"id": o["id"], "name": name, "email": o["email"]}
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(schema)
    return out


def tag_personal(c, lines: list[dict], schema: dict) -> int:
    """Личные виды Airtable: owner_id пуст, at_owner — автор (решение владельца: видят админы,
    автору предлагаются на выбор). Чьи-то копии (owner_id задан) не трогаем."""
    people = collaborators(schema)
    n = 0
    for x in lines:
        u = x["view"].get("personalForUserId")
        if not u:
            continue
        who = people.get(u) or {"id": u, "name": u, "email": None}
        n += c.execute(text("update app_view set at_owner = :o where airtable_id = :a and owner_id is null")
                       .bindparams(bindparam("o", type_=JSONB)), {"o": who, "a": x["view"]["id"]}).rowcount
    return n

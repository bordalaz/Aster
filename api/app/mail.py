"""Отправка записей письмом — «Отправить запись» Airtable (Send record).

Письмо собирается на сервере из базы с правами отправителя: видны только его таблицы и поля,
подменить содержимое из браузера нельзя. Почтовый сервер — из окружения (SMTP_*); не настроен — 503.
"""
import html
import logging
import os
import re
import smtplib
import ssl
from datetime import datetime
from email.message import EmailMessage
from email.utils import formataddr

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text

from .access import table_title
from .auth import active_user
from .db import engine
from .records import list_records

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

EMAIL = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$")
MAX_TO = 15   # как в Airtable


class SendBody(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=100)
    columns: list[str] = Field(min_length=1, max_length=300)   # поля и их порядок — как в виде отправителя
    to: list[str] = Field(min_length=1, max_length=MAX_TO)
    subject: str = Field(min_length=1, max_length=200)
    message: str = Field("", max_length=5000)
    grid: bool = False   # «Табличный вид»: записи строками таблицы, иначе — поле под полем

    @field_validator("to")
    @classmethod
    def _emails(cls, v):
        bad = [x for x in v if not EMAIL.match(x.strip())]
        if bad:
            raise ValueError("Неверный адрес: " + ", ".join(bad))
        return [x.strip() for x in v]

    @field_validator("subject")
    @classmethod
    def _one_line(cls, v):   # перевод строки в теме — подстановка заголовков письма
        return " ".join(v.split())


def smtp_config() -> dict | None:
    host = os.environ.get("SMTP_HOST")
    if not host or not os.environ.get("SMTP_FROM"):
        return None
    return {"host": host, "port": int(os.environ.get("SMTP_PORT", "587")), "user": os.environ.get("SMTP_USER"),
            "password": os.environ.get("SMTP_PASSWORD"), "from": os.environ["SMTP_FROM"],
            "ssl": os.environ.get("SMTP_SSL", "0") == "1",            # 465 — сразу TLS
            "starttls": os.environ.get("SMTP_STARTTLS", "1") == "1"}  # 587 — STARTTLS; внутренний релей на 25 — 0


def smtp_send(cfg: dict, subject: str, sender: str, to: list, cc: list, text_body: str, html_body: str) -> None:
    """Письмо через SMTP из окружения; ошибки сервера — исключением (OSError / SMTPException)."""
    m = EmailMessage()
    m["Subject"], m["From"], m["To"] = subject, formataddr((sender, cfg["from"])), ", ".join(to)
    if cc:
        m["Cc"] = ", ".join(cc)
    m.set_content(text_body)
    m.add_alternative(html_body, subtype="html")
    if cfg["ssl"]:
        s = smtplib.SMTP_SSL(cfg["host"], cfg["port"], context=ssl.create_default_context(), timeout=20)
    else:
        s = smtplib.SMTP(cfg["host"], cfg["port"], timeout=20)
        if cfg["starttls"]:
            s.starttls(context=ssl.create_default_context())
    with s:
        if cfg["user"]:
            s.login(cfg["user"], cfg["password"] or "")
        s.send_message(m)


# --- значение поля → текст, как его показывает сетка ---
def _opts(f) -> dict:   # у формул и подстановок формат — в options.result.options
    o = f["options"] or {}
    return ((o.get("result") or {}).get("options") or {}) if "result" in o else o


def _kind(f) -> str:
    o = f["options"] or {}
    return (o.get("result") or {}).get("type") or f["kind"]


def value_text(f, v) -> str:
    if v is None or v == "" or v == []:
        return ""
    if isinstance(v, list):
        return ", ".join(t for t in (value_text(f, x) for x in v) if t)
    if isinstance(v, dict):
        return str(v.get("name") or v.get("filename") or v.get("error") or v.get("specialValue") or "")
    if isinstance(v, bool):
        return "✓" if v else ""
    kind, o = _kind(f), _opts(f)
    if isinstance(v, (int, float)):
        if kind == "duration":
            m = int(round(v / 60))
            return f"{m // 60}:{m % 60:02d}"
        p = o.get("precision")
        if kind == "currency":
            return f"{o.get('symbol') or ''}{v:,.{p if p is not None else 2}f}"
        return f"{v:.{p}f}" if p is not None else (str(int(v)) if float(v).is_integer() else str(v))
    s = str(v)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return datetime.strptime(s, "%Y-%m-%d").strftime("%d.%m.%Y")
    if re.match(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", s):
        return datetime.fromisoformat(s.replace("Z", "+00:00")).strftime("%d.%m.%Y %H:%M")
    return s


# --- плашки вариантов выбора, цветами Airtable (как web/src/grid/renderers.js) ---
HUES = {
    "blue": ["#cfdfff", "#9cc7ff", "#2d7ff9", "#2750ae"], "cyan": ["#d0f0fd", "#77d1f3", "#18bfff", "#0b76b7"],
    "teal": ["#c2f5e9", "#72ddc3", "#20d9d2", "#06a09b"], "green": ["#d1f7c4", "#93e088", "#20c933", "#338a17"],
    "yellow": ["#ffeab6", "#ffd66e", "#fcb400", "#b87503"], "orange": ["#fee2d5", "#ffa981", "#ff6f2c", "#d74d26"],
    "red": ["#ffdce5", "#ff9eb7", "#f82b60", "#ba1e45"], "pink": ["#ffdaf6", "#f99de2", "#ff08c2", "#b2158b"],
    "purple": ["#ede2fe", "#cdb0ff", "#8b46ff", "#6b1cb0"], "gray": ["#eeeeee", "#cccccc", "#666666", "#444444"],
}
SHADE = {"Light2": 0, "Light1": 1, "Bright": 2, "Dark1": 3}


def _choice_color(name: str | None) -> tuple[str, str]:
    m = re.fullmatch(r"([a-z]+)(Light2|Light1|Bright|Dark1)", name or "")
    if not m or m[1] not in HUES:
        return "#eeeeee", "#1d1f25"
    shade = SHADE[m[2]]
    return HUES[m[1]][shade], "#ffffff" if shade >= 2 and m[1] != "yellow" else "#1d1f25"


def value_html(f, v) -> str:
    """Значение для письма: у полей выбора — цветные плашки, как в сетке; остальное — текстом."""
    choices = _opts(f).get("choices") or (f["options"] or {}).get("choices")
    if choices and v not in (None, "", []):
        color = {c["name"]: c.get("color") for c in choices}
        out = []
        for x in (v if isinstance(v, list) else [v]):
            bg, fg = _choice_color(color.get(str(x)))
            out.append(f'<span style="display:inline-block;padding:1px 8px;margin:0 4px 2px 0;border-radius:999px;'
                       f'background:{bg};color:{fg};font-size:12px;line-height:18px">{html.escape(str(x))}</span>')
        return "".join(out)
    return html.escape(value_text(f, v))


# --- письмо ---
FONT = "-apple-system,'Segoe UI',Roboto,Arial,sans-serif"


def render(table: str, sender: str, message: str, fields: list, recs: list[dict], grid: bool) -> tuple[str, str]:
    """→ (html, текст). Аккуратная карточка в духе Airtable: подпись поля серым, значение под ней."""
    e = html.escape
    msg_html = "<br>".join(e(line) for line in message.splitlines()) if message.strip() else ""
    if grid:
        head = "".join(f'<th style="text-align:left;padding:8px 10px;border-bottom:1px solid #e1e3e8;color:#616670;'
                       f'font-weight:500;font-size:12px;white-space:nowrap">{e(f["title"])}</th>' for f in fields)
        rows = "".join("<tr>" + "".join(
            f'<td style="padding:8px 10px;border-bottom:1px solid #f0f1f3;font-size:13px;color:#1d1f25;vertical-align:top">'
            f'{value_html(f, r.get(f["column_name"]))}</td>' for f in fields) + "</tr>" for r in recs)
        body = (f'<div style="overflow-x:auto"><table cellspacing="0" cellpadding="0" style="border-collapse:collapse;'
                f'width:100%;background:#fff;border:1px solid #e1e3e8;border-radius:8px">'
                f'<thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table></div>')
    else:
        cards = []
        for r in recs:
            title, *rest = fields
            items = "".join(
                f'<tr><td style="padding:10px 0 2px;font-size:12px;color:#616670">{e(f["title"])}</td></tr>'
                f'<tr><td style="padding:0 0 4px;font-size:14px;color:#1d1f25;white-space:pre-wrap">'
                f'{value_html(f, r.get(f["column_name"])) or "<span style='color:#a0a4ab'>—</span>"}</td></tr>'
                for f in rest)
            cards.append(
                f'<table cellspacing="0" cellpadding="0" style="width:100%;background:#fff;border:1px solid #e1e3e8;'
                f'border-radius:8px;margin:0 0 16px"><tr><td style="padding:16px 20px">'
                f'<div style="font-size:12px;color:#616670">{e(title["title"])}</div>'
                f'<div style="font-size:20px;font-weight:600;color:#1d1f25;margin:2px 0 6px">'
                f'{e(value_text(title, r.get(title["column_name"]))) or "Без названия"}</div>'
                f'<table cellspacing="0" cellpadding="0" style="width:100%;border-top:1px solid #f0f1f3">{items}</table>'
                f'</td></tr></table>')
        body = "".join(cards)
    n = len(recs)
    html_out = (
        f'<!doctype html><html><body style="margin:0;padding:0;background:#f5f6f8">'
        f'<div style="max-width:{960 if grid else 640}px;margin:0 auto;padding:24px 16px;font-family:{FONT}">'
        f'<div style="font-size:13px;color:#616670;margin-bottom:12px">{e(sender)} · таблица «{e(table)}» · '
        f'{n} {_plural(n)}</div>'
        + (f'<div style="font-size:14px;color:#1d1f25;line-height:1.5;margin:0 0 16px">{msg_html}</div>' if msg_html else "")
        + body
        + '<div style="font-size:11px;color:#a0a4ab;margin-top:16px">Отправлено из рабочего пространства «Гидроканал».</div>'
        '</div></body></html>')
    lines = [message.strip(), ""] if message.strip() else []
    for r in recs:
        lines += [f"{f['title']}: {value_text(f, r.get(f['column_name'])) or '—'}" for f in fields] + ["", "—" * 20, ""]
    return html_out, "\n".join(lines)


def _plural(n: int) -> str:
    a, b = n % 10, n % 100
    return "запись" if a == 1 and b != 11 else "записи" if 2 <= a <= 4 and not 12 <= b <= 14 else "записей"


@router.get("/mail/status")
def mail_status(user: dict = Depends(active_user)):
    """Настроена ли почта — окно «Отправить» предупреждает заранее."""
    return {"configured": smtp_config() is not None}


@router.post("/tables/{table_id}/send")
def send_records(table_id: int, body: SendBody, user: dict = Depends(active_user)):
    cfg = smtp_config()
    if cfg is None:
        raise HTTPException(503, "Почта не настроена: нужен почтовый сервер (SMTP_HOST, SMTP_FROM в .env)")
    with engine.connect() as c:
        table = table_title(c, table_id, user)
        meta = {r.column_name: dict(r._mapping) for r in c.execute(text(
            "select column_name, title, kind, options from app_field where table_id = :t"), {"t": table_id})}
    recs = list_records(table_id, ids=",".join(map(str, body.ids)), user=user)   # права и скрытые поля — как в сетке
    if not recs:
        raise HTTPException(404, "Нет таких записей")
    visible = set(recs[0])
    fields = [meta[c] for c in dict.fromkeys(body.columns) if c in meta and c in visible]
    if not fields:
        raise HTTPException(422, "Нет полей для отправки")
    order = {i: n for n, i in enumerate(body.ids)}
    recs.sort(key=lambda r: order.get(r["id"], 0))
    sender = user.get("name") or user["login"]
    html_body, text_body = render(table, sender, body.message, fields, recs, body.grid)
    try:
        smtp_send(cfg, body.subject, sender, body.to, [], text_body, html_body)
    except (OSError, smtplib.SMTPException) as e:
        log.warning("письмо не отправлено: %s → %s: %s", user["login"], body.to, e)
        raise HTTPException(502, "Почтовый сервер не принял письмо — попробуйте позже")
    log.info("записи отправлены: %s, таблица %s, %d зап. → %s", user["login"], table_id, len(recs), body.to)
    return {"ok": True, "sent": len(recs)}

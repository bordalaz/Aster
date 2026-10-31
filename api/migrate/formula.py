"""Формулы Airtable: разбор в дерево и вычисление с семантикой Airtable (числа как в JS, BLANK, даты по UTC).
Поддержано ровно то, что есть в базе (план 1б-2b): незнакомая функция — ошибка разбора, а не тихий ноль."""
import calendar
import math
import re
from datetime import date, datetime, timezone
from decimal import Decimal

_TOKEN = re.compile(r"""\s*(?:
    (?P<num>\d+(?:\.\d+)?)
  | (?P<str>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')
  | (?P<ref>\{[^}]*\})
  | (?P<name>[A-Za-z_][A-Za-z_0-9]*)
  | (?P<op><=|>=|!=|=|<|>|&|\+|-|\*|/|\(|\)|,)
)""", re.X)

# приоритет бинарных операторов: сравнения < & < + - < * /
_PREC = {"=": 1, "!=": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4}

FUNCS = {"BLANK", "IF", "OR", "SWITCH", "CONCATENATE", "LEFT", "YEAR", "MONTH", "DATETIME_FORMAT",
         "SET_LOCALE", "DATETIME_DIFF", "TODAY", "NOW", "ROUNDUP"}

RU_MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь",
             "Октябрь", "Ноябрь", "Декабрь"]


def _tokens(src: str) -> list:
    out, pos, src = [], 0, src.rstrip()
    while pos < len(src):
        m = _TOKEN.match(src, pos)
        if not m or m.end() == pos:
            raise ValueError(f"не разобрать формулу с позиции {pos}: {src[pos:pos + 20]!r}")
        out.append((m.lastgroup, m.group(m.lastgroup)))
        pos = m.end()
    return out


def parse(src: str):
    """Текст формулы → дерево: ("num", v) ("str", s) ("ref", поле) ("call", ИМЯ, [арг]) ("op", оп, a, b) ("neg", a)."""
    toks = _tokens(src)
    i = 0

    def peek():
        return toks[i] if i < len(toks) else (None, None)

    def take(val=None):
        nonlocal i
        tok = peek()
        if val is not None and tok[1] != val:
            raise ValueError(f"ожидалось {val!r}, а не {tok[1]!r} в {src!r}")
        i += 1
        return tok

    def atom():
        kind, val = take()
        if kind == "num":
            return ("num", float(val) if "." in val else int(val))
        if kind == "str":
            return ("str", re.sub(r"\\(.)", r"\1", val[1:-1]))
        if kind == "ref":
            return ("ref", val[1:-1])
        if val == "-":
            return ("neg", expr(5))
        if val == "(":
            e = expr(0)
            take(")")
            return e
        if kind == "name":
            name = val.upper()
            if name not in FUNCS:
                raise ValueError(f"функция {val} не поддержана")
            take("(")
            args = []
            if peek()[1] != ")":
                args.append(expr(0))
                while peek()[1] == ",":
                    take()
                    args.append(expr(0))
            take(")")
            return ("call", name, args)
        raise ValueError(f"неожиданное {val!r} в {src!r}")

    def expr(min_prec):
        left = atom()
        while peek()[0] == "op" and _PREC.get(peek()[1], 0) > min_prec:
            op = take()[1]
            left = ("op", op, left, expr(_PREC[op]))
        return left

    tree = expr(0)
    if i != len(toks):
        raise ValueError(f"лишнее {toks[i][1]!r} в {src!r}")
    return tree


# --- значения: None (пусто), int/float, str, date/datetime, list (lookup/связь) ---

class LinkCell(list):
    """Значение поля-связи: первичные имена связанных записей. В ARRAYJOIN rollup — одна ячейка «x, y»,
    в строке формулы имена с кавычкой берутся в кавычки."""


class _Error(Exception):
    """#ERROR! Airtable: прерывает вычисление всей формулы."""


class _ErrorValue:
    def __repr__(self):
        return "#ERROR!"


ERROR = _ErrorValue()
_SPECIAL = {"NaN": math.nan, "Infinity": math.inf, "-Infinity": -math.inf}


def _input(v):
    """Значение поля из базы → значение формулы: {"specialValue"} — число, {"error"} — ошибка."""
    if isinstance(v, dict):
        if v.get("specialValue") in _SPECIAL:
            return _SPECIAL[v["specialValue"]]
        raise _Error()
    if isinstance(v, list):
        return type(v)(_input(x) for x in v)
    return v


def _one(v):
    """lookup из одного значения ведёт себя как это значение."""
    return v[0] if isinstance(v, list) and len(v) == 1 else v


def num(v) -> float:
    v = _one(v)
    if v is None or v == "" or v == []:
        return 0
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v)
        except ValueError:
            return math.nan
    return math.nan


def text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, LinkCell):
        # имя с кавычкой — в кавычках, кавычки удвоены (как CSV); ponytail: имена с запятой в базе не встречены
        return ", ".join(f'"{t.replace(chr(34), chr(34) * 2)}"' if '"' in t else t
                         for t in (text(x) for x in v if x is not None))
    if isinstance(v, list):
        return ", ".join(text(x) for x in v if x is not None)
    if isinstance(v, Decimal):
        v = float(v)
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        if math.isnan(v):
            return "NaN"
        if math.isinf(v):
            return "Infinity" if v > 0 else "-Infinity"
        return str(int(v)) if float(v).is_integer() else repr(float(v))   # как Number#toString в JS
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, _Loc):
        return text(v.dt)
    return str(v)


def _blank(v) -> bool:
    v = _one(v)
    return v is None or v == "" or v == [] or (isinstance(v, (int, float)) and v == 0)


def _truthy(v) -> bool:
    v = _one(v)
    if isinstance(v, float) and math.isnan(v):
        return False
    return not _blank(v)


def _eq(a, b) -> bool:
    if b is None:
        return _blank(a)
    if a is None:
        return _blank(b)
    a, b = _one(a), _one(b)
    if isinstance(a, (int, float, Decimal)) or isinstance(b, (int, float, Decimal)):
        return num(a) == num(b)
    return text(a) == text(b)


class _Loc:
    """Дата с локалью (SET_LOCALE) — влияет только на названия месяцев в DATETIME_FORMAT."""
    def __init__(self, dt, locale):
        self.dt, self.locale = dt, locale


def to_dt(v):
    """Значение → datetime в UTC или None. Дата без времени — полночь UTC."""
    if isinstance(v, list) and len(v) > 1:
        raise _Error()   # дата из многозначного lookup — ошибка Airtable
    v = _one(v)
    if isinstance(v, _Loc):
        return to_dt(v.dt)
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc) if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day, tzinfo=timezone.utc)
    if isinstance(v, str) and v:
        for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%m-%d-%Y"):
            try:
                return datetime.strptime(v, fmt).replace(tzinfo=timezone.utc)
            except ValueError:
                pass
    return None


def _fmt(v, pattern: str):
    d = to_dt(v)
    if d is None:
        raise _Error()   # DATETIME_FORMAT от пустого — #ERROR!
    ru = isinstance(_one(v), _Loc) and _one(v).locale == "ru"
    tokens = {"YYYY": f"{d.year:04d}", "GGGG": f"{d.isocalendar()[0]:04d}", "YY": f"{d.year % 100:02d}",
              "MMMM": RU_MONTHS[d.month - 1] if ru else calendar.month_name[d.month],
              "MM": f"{d.month:02d}", "DD": f"{d.day:02d}"}
    return re.sub("YYYY|GGGG|MMMM|YY|MM|DD", lambda m: tokens[m.group()], pattern)


def _diff(a, b, unit: str):
    """DATETIME_DIFF как в moment.js: целое число единиц, отбрасывая дробь к нулю."""
    a, b = to_dt(a), to_dt(b)
    if a is None or b is None:
        return math.nan
    unit = unit.lower()
    if unit in ("month", "months", "m"):
        months = (a.year - b.year) * 12 + a.month - b.month
        # неполный последний месяц не считается
        if months > 0 and (a.day, a.time()) < (b.day, b.time()):
            months -= 1
        elif months < 0 and (a.day, a.time()) > (b.day, b.time()):
            months += 1
        return months
    sec = {"seconds": 1, "minutes": 60, "hours": 3600, "days": 86400, "weeks": 604800}[unit]
    return math.trunc((a - b).total_seconds() / sec)


def _roundup(x, digits):
    x, f = num(x), 10 ** int(num(digits))
    r = math.copysign(math.ceil(abs(x) * f), x) / f
    return int(r) if f == 1 else r


def evaluate(node, get, today: date):
    """get(ссылка) → значение поля текущей записи; today — дата «сегодня» (для сверки — дата снимка)."""
    def ev(n):
        kind = n[0]
        if kind in ("num", "str"):
            return n[1]
        if kind == "ref":
            return _input(get(n[1]))
        if kind == "neg":
            return -num(ev(n[1]))
        if kind == "op":
            op, a, b = n[1], ev(n[2]), ev(n[3])
            if op == "&":
                return text(a) + text(b)
            if op == "=":
                return _eq(a, b)
            if op == "!=":
                return not _eq(a, b)
            x, y = num(a), num(b)
            if op == "/":
                if y == 0:
                    return math.nan if x == 0 or math.isnan(x) else math.copysign(math.inf, x)
                return x / y
            return {"+": lambda: x + y, "-": lambda: x - y, "*": lambda: x * y, ">": lambda: x > y,
                    "<": lambda: x < y, ">=": lambda: x >= y, "<=": lambda: x <= y}[op]()
        name, args = n[1], n[2]
        if name == "IF":
            return ev(args[1]) if _truthy(ev(args[0])) else (ev(args[2]) if len(args) > 2 else None)
        if name == "SWITCH":
            v = ev(args[0])
            rest = args[1:]
            for k in range(0, len(rest) - 1, 2):
                if _eq(v, ev(rest[k])):
                    return ev(rest[k + 1])
            return ev(rest[-1]) if len(rest) % 2 else None
        vals = [ev(a) for a in args]
        if name == "BLANK":
            return None
        if name == "OR":
            return any(_truthy(v) for v in vals)
        if name == "CONCATENATE":
            return "".join(text(v) for v in vals)
        if name == "LEFT":
            return text(vals[0])[:int(num(vals[1]))]
        if name in ("YEAR", "MONTH"):
            d = to_dt(vals[0])
            return math.nan if d is None else (d.year if name == "YEAR" else d.month)
        if name == "SET_LOCALE":
            return _Loc(vals[0], text(vals[1]).lower())
        if name == "DATETIME_FORMAT":
            return _fmt(vals[0], text(vals[1]) if len(vals) > 1 else "M/D/YYYY")
        if name == "DATETIME_DIFF":
            return _diff(vals[0], vals[1], text(vals[2]) if len(vals) > 2 else "seconds")
        if name == "TODAY":
            return today
        if name == "NOW":
            return datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
        if name == "ROUNDUP":
            return _roundup(vals[0], vals[1] if len(vals) > 1 else 0)
        raise ValueError(f"функция {name} не поддержана")
    try:
        return ev(node)
    except _Error:
        return ERROR


NUMERIC = {"number", "currency", "percent", "duration", "rating"}


def to_api(v, result_type: str | None):
    """Результат формулы → вид API Airtable (так он лежит в at_computed)."""
    if v is ERROR:
        return {"error": "#ERROR!"}
    if isinstance(v, _Loc):
        v = v.dt
    if v is None:
        return None
    if result_type in NUMERIC:
        x = num(v) if not isinstance(v, (int, float)) or isinstance(v, bool) else v
        if math.isnan(x):
            return {"specialValue": "NaN"}
        if math.isinf(x):
            return {"specialValue": "Infinity" if x > 0 else "-Infinity"}
        return x
    if result_type == "date":
        d = to_dt(v)
        return d.date().isoformat() if d else None
    if result_type == "dateTime":
        d = to_dt(v)
        return text(d) if d else None
    return v if isinstance(v, str) else text(v)

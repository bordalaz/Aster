"""Имена таблиц и колонок PG из id Airtable. Только проверенные id попадают в SQL."""
import re
from typing import Literal

_ID = re.compile(r"(tbl|fld)[A-Za-z0-9]{14}")


def check_id(x: str, prefix: Literal["tbl", "fld"]) -> str:
    m = _ID.fullmatch(x)
    if not m or m.group(1) != prefix:
        raise ValueError(f"Неверный id Airtable: {x!r}")
    return x


def table_name(tbl_id: str) -> str:
    return "at_" + check_id(tbl_id, "tbl").lower()


def column_name(fld_id: str) -> str:
    return "f_" + check_id(fld_id, "fld").lower()


def link_table_name(fld_id: str) -> str:
    return "l_" + check_id(fld_id, "fld").lower()

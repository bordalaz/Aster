"""python -m app.cli create-user <login> <ФИО> <superadmin|admin|storekeeper|user>"""
import getpass
import sys

from sqlalchemy import text

from .auth import hash_password
from .db import engine


def create_user(login: str, name: str, role: str, password: str) -> None:
    with engine.begin() as c:
        c.execute(
            text("insert into app_user (login, name, role, password_hash) values (:l, :n, :r, :h)"),
            {"l": login, "n": name, "r": role, "h": hash_password(password)},
        )


if __name__ == "__main__":
    if len(sys.argv) != 5 or sys.argv[1] != "create-user":
        sys.exit(__doc__)
    create_user(*sys.argv[2:5], getpass.getpass("Пароль: "))

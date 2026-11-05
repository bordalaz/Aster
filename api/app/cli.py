"""python -m app.cli create-user <login> <ФИО> <superadmin|admin|storekeeper|user>
python -m app.cli sort-links — стопки связей-событий (перемещения, рейсы…) по дате события"""
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


def sort_links() -> int:
    """Один раз после переноса из Airtable: у каждой записи связанные события — по дате события, старые раньше
    (в Airtable — по времени добавления); без даты — в конце, равные даты — в прежнем порядке.
    Конец списка — самое свежее: на нём стоят формулы «последнего» (местонахождение). → сколько списков изменено."""
    from .links import event_date
    n = 0
    with engine.begin() as c:
        sides = c.execute(text(
            "select m.link_table, m.side, lt.id as tid, lt.pg_name from at_link_meta m join app_field f on f.airtable_id = m.field_id "
            "join app_table lt on lt.airtable_id = f.options->>'linkedTableId'")).all()
        for s in sides:
            far = event_date(c, s.pg_name, s.tid)
            if not far:
                continue
            me, other, pos = ("src", "dst", "pos") if s.side == "src" else ("dst", "src", "rpos")
            rows = c.execute(text(f'select p.{me}, p.{other}, x."{far[1]}" from {s.link_table} p join {s.pg_name} x on x.id = p.{other} '
                                  f"order by p.{me}, p.{pos} nulls last, p.{other}")).all()
            lists: dict = {}
            for m, o, d in rows:
                lists.setdefault(m, []).append((o, d))
            for m, items in lists.items():
                want = [o for o, _ in sorted(items, key=lambda it: (it[1] is None, it[1] or 0))]
                if want != [o for o, _ in items]:
                    n += 1
                    for k, o in enumerate(want):
                        c.execute(text(f"update {s.link_table} set {pos} = :k where {me} = :m and {other} = :o"), {"k": k, "m": m, "o": o})
    return n


if __name__ == "__main__":
    if sys.argv[1:] == ["sort-links"]:
        print("изменено списков:", sort_links())
    elif len(sys.argv) == 5 and sys.argv[1] == "create-user":
        create_user(*sys.argv[2:5], getpass.getpass("Пароль: "))
    else:
        sys.exit(__doc__)

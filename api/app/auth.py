import hashlib
import hmac
import ipaddress
import os
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from .db import engine

COOKIE = "session"
SESSION_DAYS = 30
_SCRYPT = dict(n=2**14, r=8, p=1)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    return salt.hex() + ":" + hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT).hex()


def check_password(password: str, stored: str) -> bool:
    salt, digest = stored.split(":")
    actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), **_SCRYPT).hex()
    return hmac.compare_digest(actual, digest)


# Хеш для несуществующего логина: scrypt считается всегда, чтобы ответ был
# за то же время, что и при реальном пользователе — иначе логины перебираются по таймингу.
_DUMMY_HASH = hash_password(secrets.token_hex(16))


ADMINS = ("superadmin", "admin")
_PRIVATE = "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8,::1/128"
OUTSIDE = "Вход вне офиса доступен только администраторам"


def in_office(host: str | None) -> bool:
    """R7. ponytail: адрес — прямой клиент; за обратным прокси (NAS, этап 3) брать доверенный X-Forwarded-For."""
    try:
        ip = ipaddress.ip_address(host or "")
    except ValueError:
        return False
    nets = os.environ.get("OFFICE_NETS") or _PRIVATE
    return any(ip in ipaddress.ip_network(n.strip()) for n in nets.split(",") if n.strip())


def check_office(request: Request, role: str) -> None:
    if role not in ADMINS and not in_office(request.client and request.client.host):
        raise HTTPException(403, OUTSIDE)


def current_user(request: Request) -> dict:
    """Вошедший незаблокированный пользователь; вне офиса — только админы (R7, проверка на каждом запросе)."""
    token = request.cookies.get(COOKIE)
    if token:
        with engine.connect() as c:
            u = c.execute(
                text(
                    "select u.id, u.login, u.name, u.role, u.must_change_password from app_session s "
                    "join app_user u on u.id = s.user_id "
                    "where s.token = :t and s.expires_at > now() and not u.blocked"
                ),
                {"t": token},
            ).first()
        if u:
            check_office(request, u.role)
            return u._asdict()
    raise HTTPException(401, "Нужен вход")


def active_user(user: dict = Depends(current_user)) -> dict:
    """Для данных: пока временный пароль не сменён — доступа нет (E3)."""
    if user["must_change_password"]:
        raise HTTPException(403, "Смените временный пароль")
    return user


def admin_user(user: dict = Depends(active_user)) -> dict:
    if user["role"] not in ADMINS:
        raise HTTPException(403, "Только для администраторов")
    return user


router = APIRouter(prefix="/api/auth")


class LoginBody(BaseModel):
    login: str
    password: str


# ponytail: без ограничения попыток входа — внутренняя сеть, ~50 человек; добавить, если откроем доступ снаружи (В1)
@router.post("/login")
def login(body: LoginBody, request: Request, response: Response):
    with engine.begin() as c:
        u = c.execute(
            text("select id, role, blocked, password_hash from app_user where login = :l"), {"l": body.login}
        ).first()
        # scrypt гоняем в обеих ветках (константное время против энумерации логинов)
        ok = check_password(body.password, u.password_hash if u else _DUMMY_HASH)
        if not u or not ok or u.blocked:
            raise HTTPException(401, "Неверный логин или пароль")
        check_office(request, u.role)   # после пароля: роль не раскрываем подбором
        token = secrets.token_urlsafe(32)
        c.execute(text("delete from app_session where expires_at < now()"))
        c.execute(
            text("insert into app_session values (:t, :u, now() + make_interval(days => :d))"),
            {"t": token, "u": u.id, "d": SESSION_DAYS},
        )
    response.set_cookie(
        COOKIE, token, httponly=True, samesite="lax",
        secure=os.environ.get("COOKIE_SECURE", "1") != "0", max_age=SESSION_DAYS * 86400,
    )
    return {"ok": True}


@router.post("/logout")
def logout(request: Request, response: Response):
    with engine.begin() as c:
        c.execute(text("delete from app_session where token = :t"), {"t": request.cookies.get(COOKIE)})
    response.delete_cookie(COOKIE)
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return user


class PasswordBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    old: str
    new: str = Field(min_length=8, max_length=200)


@router.post("/password")
def change_password(body: PasswordBody, user: dict = Depends(current_user)):
    """R6: сменить свой пароль; снимает флаг временного пароля."""
    with engine.begin() as c:
        stored = c.execute(text("select password_hash from app_user where id = :i"), {"i": user["id"]}).scalar()
        if not check_password(body.old, stored):
            raise HTTPException(403, "Текущий пароль неверный")
        c.execute(
            text("update app_user set password_hash = :h, must_change_password = false where id = :i"),
            {"h": hash_password(body.new), "i": user["id"]},
        )
    return {"ok": True}

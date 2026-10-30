import hashlib
import hmac
import os
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
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


def current_user(request: Request) -> dict:
    token = request.cookies.get(COOKIE)
    if token:
        with engine.connect() as c:
            u = c.execute(
                text(
                    "select u.id, u.login, u.name, u.role from app_session s "
                    "join app_user u on u.id = s.user_id "
                    "where s.token = :t and s.expires_at > now()"
                ),
                {"t": token},
            ).first()
        if u:
            return u._asdict()
    raise HTTPException(401, "Нужен вход")


router = APIRouter(prefix="/api/auth")


class LoginBody(BaseModel):
    login: str
    password: str


# ponytail: без ограничения попыток входа — внутренняя сеть, ~50 человек; добавить, если откроем доступ снаружи (В1)
@router.post("/login")
def login(body: LoginBody, response: Response):
    with engine.begin() as c:
        u = c.execute(
            text("select id, password_hash from app_user where login = :l"), {"l": body.login}
        ).first()
        if not u or not check_password(body.password, u.password_hash):
            raise HTTPException(401, "Неверный логин или пароль")
        token = secrets.token_urlsafe(32)
        c.execute(text("delete from app_session where expires_at < now()"))
        c.execute(
            text("insert into app_session values (:t, :u, now() + make_interval(days => :d))"),
            {"t": token, "u": u.id, "d": SESSION_DAYS},
        )
    response.set_cookie(
        COOKIE, token, httponly=True, samesite="lax",
        secure=os.environ.get("COOKIE_SECURE") == "1", max_age=SESSION_DAYS * 86400,
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

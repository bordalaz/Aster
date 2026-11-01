"""Управление пользователями (spec R2, R3, R6, E1). Удаления нет — блокировка сохраняет авторство в истории."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from .auth import admin_user, hash_password
from .db import engine

router = APIRouter(prefix="/api/users")

Password = Field(min_length=8, max_length=200)
Role = Literal["admin", "storekeeper", "user"]   # суперадмина через API не создать и не назначить (R2)


def check_target_role(actor: dict, role: str) -> None:
    """Админов назначает, снимает и меняет только суперадмин (R2)."""
    if role == "admin" and actor["role"] != "superadmin":
        raise HTTPException(403, "Администраторами управляет только суперадмин")


@router.get("")
def list_users(actor: dict = Depends(admin_user)):
    with engine.connect() as c:
        rows = c.execute(text(
            "select id, login, name, role, blocked, must_change_password, finance_access, created_at from app_user order by login"
        ))
        return [r._asdict() for r in rows]


class NewUser(BaseModel):
    model_config = ConfigDict(extra="forbid")
    login: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    role: Role | Literal["superadmin"]
    password: str = Password   # временный: при первом входе сменить (E3)


@router.post("")
def create_user(body: NewUser, actor: dict = Depends(admin_user)):
    if body.role == "superadmin":
        raise HTTPException(403, "Суперадмин один")
    check_target_role(actor, body.role)
    try:
        with engine.begin() as c:
            uid = c.execute(text(
                "insert into app_user (login, name, role, password_hash, must_change_password) "
                "values (:l, :n, :r, :h, true) returning id"
            ), {"l": body.login, "n": body.name, "r": body.role, "h": hash_password(body.password)}).scalar()
    except IntegrityError:
        raise HTTPException(409, "Такой логин уже есть")
    return {"id": uid}


class UserPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(None, min_length=1, max_length=200)
    role: Role | Literal["superadmin"] | None = None
    blocked: bool | None = None
    password: str | None = Field(None, min_length=8, max_length=200)   # сброс: снова временный
    finance_access: bool | None = None   # просмотр финансов — выдаёт только суперадмин


@router.patch("/{user_id}")
def patch_user(user_id: int, body: UserPatch, actor: dict = Depends(admin_user)):
    with engine.begin() as c:
        target = c.execute(text("select role from app_user where id = :i"), {"i": user_id}).scalar()
        if target is None:
            raise HTTPException(404, "Нет такого пользователя")
        if target == "superadmin":
            raise HTTPException(403, "Суперадмина изменить нельзя")   # E1 — даже самому суперадмину через этот API
        if body.role == "superadmin":
            raise HTTPException(403, "Суперадмин один")
        check_target_role(actor, target)
        if body.finance_access is not None and actor["role"] != "superadmin":
            raise HTTPException(403, "Доступ к финансам выдаёт только суперадмин")
        if body.role:
            check_target_role(actor, body.role)
        sets, params = [], {"i": user_id}
        for col in ("name", "role", "blocked", "finance_access"):
            if getattr(body, col) is not None:
                sets.append(f"{col} = :{col}")   # col — из фиксированного списка, не из запроса
                params[col] = getattr(body, col)
        if body.password is not None:
            sets += ["password_hash = :h", "must_change_password = true"]
            params["h"] = hash_password(body.password)
        if sets:
            c.execute(text(f"update app_user set {', '.join(sets)} where id = :i"), params)
        if body.blocked or body.password is not None:
            c.execute(text("delete from app_session where user_id = :i"), {"i": user_id})
    return {"ok": True}

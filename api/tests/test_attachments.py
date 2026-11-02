"""Вложения (R27, R28, R37): показ в записи, загрузка до 50 МБ, привязка из карточки и формы,
скачивание под исходным именем, предпросмотр только безопасных типов по содержимому."""
import shutil

import pytest
from sqlalchemy import text

from app import attachments, computed
from app.db import engine
from tests.conftest import FIXTURE
from tests.test_access import as_user
from tests.test_forms import setup_form

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32
PHOTO = "f_fldbphoto00000000"


@pytest.fixture
def root(tmp_path, monkeypatch):
    shutil.copytree(FIXTURE / "files", tmp_path / "files")
    monkeypatch.setattr(attachments, "ROOT", tmp_path)
    return tmp_path


def upload(c, data=PNG, name="фото 1.png", ctype="application/octet-stream"):
    return c.post(f"/api/uploads?name={name}", content=data, headers={"Content-Type": ctype})


def b_rows(c, t):
    return {r["id"]: r for r in c.get(f"/api/tables/{t['tblBBBBBBBBBBBBBB']}/records").json()}


def test_record_shows_airtable_attachment_and_download(loaded_fixture, root):
    computed.reset()
    u = as_user("u", "user")
    r = next(x for x in b_rows(u, loaded_fixture).values() if x[PHOTO])
    att = r[PHOTO][0]
    assert att["name"] == "photo.jpg" and att["size"] == 3
    d = u.get(f"/api/attachments/{att['id']}")
    assert d.status_code == 200 and d.content == (FIXTURE / "files" / "attAAAAAAAAAAAAAA").read_bytes()
    assert d.headers["content-disposition"].startswith("attachment")
    assert "photo.jpg" in d.headers["content-disposition"]
    assert d.headers["x-content-type-options"] == "nosniff"
    # не картинка по содержимому (3 байта) — inline не даём, хоть имя .jpg (R37)
    assert u.get(f"/api/attachments/{att['id']}?inline=1").headers["content-disposition"].startswith("attachment")


def test_upload_limits_and_csrf_guard(loaded_fixture, root, monkeypatch):
    u = as_user("u", "user")
    assert upload(u, ctype="text/plain").status_code == 415          # простой запрос с чужого сайта не пройдёт
    monkeypatch.setattr(attachments, "MAX", 10)
    assert upload(u).status_code == 413
    assert not list((root / "uploads").glob("*")) if (root / "uploads").exists() else True   # обрывок не остаётся
    assert as_user("x", "user").get("/api/attachments/999999").status_code == 404


def test_card_attach_preview_and_detach(loaded_fixture, root):
    computed.reset()
    t = loaded_fixture
    adm = as_user("a", "admin")
    up = upload(adm).json()
    rid = next(iter(b_rows(adm, t)))
    other = as_user("o", "user")
    assert other.get(f"/api/attachments/{up['id']}").status_code == 404     # не привязанное — только загрузившему
    assert upload(other).status_code == 200
    stranger = upload(other).json()["id"]
    url = f"/api/tables/{t['tblBBBBBBBBBBBBBB']}/records/{rid}/attachments"
    assert adm.post(url, json={"column": PHOTO, "ids": [stranger]}).status_code == 422   # чужую загрузку не привязать
    assert other.post(url, json={"column": PHOTO, "ids": [up["id"]]}).status_code == 403  # пользователь не правит
    before = b_rows(adm, t)[rid]["updated_at"]
    assert adm.post(url, json={"column": PHOTO, "ids": [up["id"]]}).status_code == 200
    assert b_rows(adm, t)[rid]["updated_at"] != before   # версия записи сдвинулась
    names = [a["name"] for a in b_rows(adm, t)[rid][PHOTO]]
    assert names[-1] == "фото 1.png"
    p = other.get(f"/api/attachments/{up['id']}?inline=1")                  # теперь видно всем, кто видит таблицу
    assert p.status_code == 200 and p.headers["content-type"] == "image/png" and p.headers["content-disposition"].startswith("inline")
    assert adm.delete(f"{url}/{up['id']}").status_code == 200
    assert "фото 1.png" not in [a["name"] for a in b_rows(adm, t)[rid][PHOTO]]
    hist = adm.get(f"/api/tables/{t['tblBBBBBBBBBBBBBB']}/records/{rid}/history").json()
    assert [h["column_name"] for h in hist[:2]] == [PHOTO, PHOTO]


def test_form_with_attachment(loaded_fixture, root):
    computed.reset()
    _, fid = setup_form(loaded_fixture, fields=[
        {"id": "fldBinv0000000000", "req": True, "lines": ["Инвентарный номер", "Required"]},
        {"id": "fldBphoto00000000", "req": True, "lines": ["Фото", "Required"]}])
    u = as_user("u", "user")
    assert [f["kind"] for f in u.get(f"/api/forms/{fid}").json()["fields"]] == ["singleLineText", "multipleAttachments"]
    a = upload(u).json()["id"]
    r = u.post(f"/api/forms/{fid}/submit", json={"key": "k-att-00001", "values": {"f_fldbinv0000000000": "МИР 9", PHOTO: [a]}})
    assert r.status_code == 200, r.text
    rec = b_rows(as_user("adm", "admin"), loaded_fixture)[r.json()["id"]]
    assert [x["name"] for x in rec[PHOTO]] == ["фото 1.png"]
    # повторно ту же загрузку не привязать (уже занята)
    r2 = u.post(f"/api/forms/{fid}/submit", json={"key": "k-att-00002", "values": {"f_fldbinv0000000000": "МИР 10", PHOTO: [a]}})
    assert r2.status_code == 422


def test_download_all_zip(loaded_fixture, root):
    """«Скачать все»: ZIP всех файлов поля; одинаковые имена не затирают друг друга; без прав/файлов — 404."""
    import io
    import zipfile
    computed.reset()
    t = loaded_fixture
    adm = as_user("a", "admin")
    rid, row = next((i, r) for i, r in b_rows(adm, t).items() if r[PHOTO])
    url = f"/api/tables/{t['tblBBBBBBBBBBBBBB']}/records/{rid}/attachments"
    ids = [upload(adm, name="photo.jpg").json()["id"], upload(adm, name="../../etc/x.png").json()["id"]]
    assert adm.post(url, json={"column": PHOTO, "ids": ids}).status_code == 200
    z = as_user("u", "user").get(f"{url}/{PHOTO}/zip")
    assert z.status_code == 200 and z.headers["content-type"] == "application/zip"
    assert "filename*=UTF-8''" in z.headers["content-disposition"]
    names = zipfile.ZipFile(io.BytesIO(z.content)).namelist()
    assert names == ["photo.jpg", "photo (2).jpg", "x.png"]   # путь из имени отброшен
    assert adm.get(f"{url}/f_nosuchfield/zip").status_code == 404
    empty = next(i for i, r in b_rows(adm, t).items() if not r[PHOTO])
    assert adm.get(f"/api/tables/{t['tblBBBBBBBBBBBBBB']}/records/{empty}/attachments/{PHOTO}/zip").status_code == 404
    assert adm.get(f"/api/tables/999999/records/{rid}/attachments/{PHOTO}/zip").status_code == 404

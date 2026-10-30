import json
from pathlib import Path

from migrate.snapshot import fetch_snapshot

FIX = Path(__file__).parent / "fixtures" / "airtable"


class StubClient:
    """Отдаёт фикстуру как Airtable: по одной записи на страницу. Пишет события в log."""

    def __init__(self):
        self.schema_ = json.loads((FIX / "schema.json").read_text(encoding="utf-8"))
        self.log = []

    def schema(self):
        return self.schema_

    def pages(self, table_id):
        for line in (FIX / "records" / f"{table_id}.jsonl").read_text(encoding="utf-8").splitlines():
            self.log.append(("page", table_id))
            yield [json.loads(line)]

    def download(self, url, dest):
        self.log.append(("download", url))
        dest.write_bytes(b"abc")
        return 3


def test_snapshot_layout(tmp_path):
    counts = fetch_snapshot(StubClient(), tmp_path)
    assert counts == {"tblAAAAAAAAAAAAAA": 2, "tblBBBBBBBBBBBBBB": 2, "tblCCCCCCCCCCCCCC": 2}
    assert json.loads((tmp_path / "schema.json").read_text(encoding="utf-8"))[0]["id"] == "tblAAAAAAAAAAAAAA"
    lines = (tmp_path / "records" / "tblBBBBBBBBBBBBBB.jsonl").read_text(encoding="utf-8").splitlines()
    assert [json.loads(x)["id"] for x in lines] == ["recB1000000000000", "recB2000000000000"]


def test_attachment_saved_by_id(tmp_path):
    fetch_snapshot(StubClient(), tmp_path)
    assert (tmp_path / "files" / "attAAAAAAAAAAAAAA").read_bytes() == b"abc"
    assert not any("photo" in str(p) for p in tmp_path.rglob("*"))


def test_attachment_not_redownloaded(tmp_path):
    fetch_snapshot(StubClient(), tmp_path)
    c = StubClient()
    fetch_snapshot(c, tmp_path)
    assert not [e for e in c.log if e[0] == "download"]


def test_attachment_downloaded_per_page(tmp_path):
    c = StubClient()
    fetch_snapshot(c, tmp_path)
    b = [e for e in c.log if e[0] == "download" or e[1] == "tblBBBBBBBBBBBBBB"]
    assert b[:3] == [("page", "tblBBBBBBBBBBBBBB"), ("download", "https://v5.airtableusercontent.com/x/photo.jpg"),
                     ("page", "tblBBBBBBBBBBBBBB")]


def test_page_attachments_downloaded_in_parallel(tmp_path):
    import threading

    barrier = threading.Barrier(2, timeout=5)  # пройдёт, только если два скачивания идут одновременно

    class TwoAtt(StubClient):
        def schema(self):
            return [{"id": "tblBBBBBBBBBBBBBB", "fields": [{"id": "fldBphoto00000000", "type": "multipleAttachments"}]}]

        def pages(self, table_id):
            yield [{"id": f"recP{i}000000000000", "fields": {"fldBphoto00000000": [
                {"id": f"attP{i}000000000000", "url": f"u{i}", "size": 3}]}} for i in (1, 2)]

        def download(self, url, dest):
            barrier.wait()
            return super().download(url, dest)

    fetch_snapshot(TwoAtt(), tmp_path)
    assert len(list((tmp_path / "files").iterdir())) == 2


def test_no_files_skips_download(tmp_path):
    c = StubClient()
    counts = fetch_snapshot(c, tmp_path, files=False)
    assert counts["tblBBBBBBBBBBBBBB"] == 2
    assert not [e for e in c.log if e[0] == "download"]


def test_interrupted_fetch_not_loadable(tmp_path):
    import pytest
    from migrate.load import load_snapshot

    fetch_snapshot(StubClient(), tmp_path)
    assert (tmp_path / "complete").exists()

    class Dies(StubClient):
        def pages(self, table_id):
            if table_id == "tblBBBBBBBBBBBBBB":
                raise RuntimeError("обрыв")
            yield from super().pages(table_id)

    with pytest.raises(RuntimeError):
        fetch_snapshot(Dies(), tmp_path)
    assert not (tmp_path / "complete").exists()
    with pytest.raises(RuntimeError, match="не завершён"):
        load_snapshot(None, tmp_path)


def test_same_attachment_twice_on_page_downloaded_once(tmp_path):
    class Dup(StubClient):
        def schema(self):
            return [{"id": "tblBBBBBBBBBBBBBB", "fields": [{"id": "fldBphoto00000000", "type": "multipleAttachments"}]}]

        def pages(self, table_id):
            att = {"id": "attDUP00000000000", "url": "u", "size": 3}
            yield [{"id": f"recD{i}000000000000", "fields": {"fldBphoto00000000": [att]}} for i in (1, 2)]

    c = Dup()
    fetch_snapshot(c, tmp_path)
    assert len([e for e in c.log if e[0] == "download"]) == 1

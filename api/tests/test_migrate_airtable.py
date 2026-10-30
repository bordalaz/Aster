import httpx
import pytest

from migrate.airtable import AirtableClient


class FakeTime:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def sleep(self, s):
        self.sleeps.append(s)
        self.now += s

    def clock(self):
        return self.now


def make(responses, seen=None):
    """Клиент, отвечающий по очереди ответами (status, json|bytes); запросы — в seen."""
    queue = list(responses)
    t = FakeTime()

    def handler(request):
        if seen is not None:
            seen.append(request)
        status, body = queue.pop(0)
        if isinstance(body, bytes):
            return httpx.Response(status, content=body)
        return httpx.Response(status, json=body)

    c = AirtableClient("secret-token", "appPaeBP8t3Ri5Lfn", transport=httpx.MockTransport(handler),
                       sleep=t.sleep, clock=t.clock)
    return c, t


def test_pages_follow_offset():
    seen = []
    c, _ = make([(200, {"records": [{"id": "a"}], "offset": "x"}), (200, {"records": [{"id": "b"}]})], seen)
    assert list(c.pages("tbl1ZvKeatrUCpH3s")) == [[{"id": "a"}], [{"id": "b"}]]
    assert "offset" not in seen[0].url.params
    assert seen[1].url.params["offset"] == "x"


def test_fields_by_id_requested():
    seen = []
    c, _ = make([(200, {"records": []})], seen)
    list(c.pages("tbl1ZvKeatrUCpH3s"))
    assert seen[0].url.params["returnFieldsByFieldId"] == "true"
    assert seen[0].headers["Authorization"] == "Bearer secret-token"


def test_rate_limit_spacing():
    c, t = make([(200, {"tables": []})] * 6)
    for _ in range(6):
        c.schema()
    assert sum(t.sleeps) >= 1.0


def test_retry_on_429():
    seen = []
    c, t = make([(200, {"records": [{"id": "a"}], "offset": "x"}), (429, {}),
                 (200, {"records": [{"id": "b"}]})], seen)
    assert list(c.pages("tbl1ZvKeatrUCpH3s")) == [[{"id": "a"}], [{"id": "b"}]]
    assert 30 in t.sleeps
    assert seen[1].url.params["offset"] == seen[2].url.params["offset"] == "x"


def test_error_has_no_token():
    c, _ = make([(401, {"error": "AUTHENTICATION_REQUIRED"})])
    with pytest.raises(RuntimeError) as e:
        c.schema()
    assert "401" in str(e.value)
    assert "secret-token" not in str(e.value)


def test_download_atomic(tmp_path):
    c, _ = make([(200, b"abc")])
    dest = tmp_path / "attX"
    assert c.download("https://dl.airtable.com/f", dest) == 3
    assert dest.read_bytes() == b"abc"
    assert [p.name for p in tmp_path.iterdir()] == ["attX"]


def test_download_sends_no_token(tmp_path):
    seen = []
    c, _ = make([(200, b"x")], seen)
    c.download("https://v5.airtableusercontent.com/f", tmp_path / "a")
    assert "Authorization" not in seen[0].headers

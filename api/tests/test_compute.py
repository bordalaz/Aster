from pathlib import Path

from sqlalchemy import text

from migrate.load import load_snapshot
from migrate.schema import apply_schema
from tests.compute_fixtures import write_snapshot, link_field, rollup_field


def _two_tables():
    # Номенклатура(primary Имя, Цена) 1—N Оборудование(primary Инв); Оборудование.ЦенаИзНом = rollup.
    schema = [
        {"id": "tblNNNNNNNNNNNNNN", "name": "Номенклатура", "primaryFieldId": "fldNnm00000000000",
         "fields": [
            {"id": "fldNnm00000000000", "name": "Имя", "type": "singleLineText"},
            {"id": "fldNprice00000000", "name": "Цена", "type": "number", "options": {"precision": 2}},
            link_field("fldNequip00000000", "Оборудование", "tblOOOOOOOOOOOOOO", "fldOnom0000000000")]},
        {"id": "tblOOOOOOOOOOOOOO", "name": "Оборудование", "primaryFieldId": "fldOinv0000000000",
         "fields": [
            {"id": "fldOinv0000000000", "name": "Инв", "type": "singleLineText"},
            link_field("fldOnom0000000000", "Номенклатура", "tblNNNNNNNNNNNNNN", "fldNequip00000000"),
            rollup_field("fldOprice00000000", "ЦенаИзНом", "fldOnom0000000000", "fldNprice00000000")]},
    ]
    records = {
        "tblNNNNNNNNNNNNNN": [
            {"id": "recN1", "createdTime": "2023-01-01T00:00:00.000Z",
             "fields": {"fldNnm00000000000": "Кольцо", "fldNprice00000000": 5.5, "fldNequip00000000": ["recO1", "recO2"]}}],
        "tblOOOOOOOOOOOOOO": [
            {"id": "recO1", "createdTime": "2023-01-01T00:00:00.000Z",
             "fields": {"fldOinv0000000000": "INV-1", "fldOnom0000000000": ["recN1"]}},
            {"id": "recO2", "createdTime": "2023-01-02T00:00:00.000Z",
             "fields": {"fldOinv0000000000": "INV-2", "fldOnom0000000000": ["recN1"]}}],
    }
    return schema, records


def test_snapshot_loads(tmp_path):
    schema, records = _two_tables()
    write_snapshot(tmp_path, schema, records)
    from app.db import engine  # noqa
    with engine.begin() as c:
        apply_schema(c, schema)
        load_snapshot(c, tmp_path)
        n = c.execute(text("select count(*) from at_tbloooooooooooooo")).scalar()
    assert n == 2

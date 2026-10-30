import pytest
from migrate.names import check_id, table_name, column_name, link_table_name

def test_names():
    assert table_name("tbl1ZvKeatrUCpH3s") == "at_tbl1zvkeatrucph3s"
    assert column_name("fldUasUu4p7xcskLH") == "f_flduasuu4p7xcsklh"
    assert link_table_name("fldmGqgYrdh8QXdJ0") == "l_fldmgqgyrdh8qxdj0"

@pytest.mark.parametrize("bad", ["tbl1; drop table x", "fldUasUu4p7xcskLH", "tbl123", "", "tbl1ZvKeatrUCpH3s "])
def test_bad_table_id_rejected(bad):
    with pytest.raises(ValueError):
        check_id(bad, "tbl")

def test_replica_tables_exist():
    from sqlalchemy import inspect
    from app.db import engine
    assert {"attachment", "at_computed", "at_link_meta"} <= set(inspect(engine).get_table_names())

# SQLAlchemy モデルが schema.sql（design.md 4.2、正となる DDL）と一致すること
# DB には接続せず、schema.sql の文字列とモデルのメタデータを突き合わせる。test_spec.md にケース ID がないため test_extra_
import re
from pathlib import Path

import pytest

from app.models import Base

SCHEMA_SQL = Path(__file__).resolve().parents[1] / "fixtures" / "schema.sql"
TABLES = ["staff", "member", "product", "tax_rate", "discount_campaign",
          "transaction", "transaction_detail", "refresh_token"]


def parse_schema() -> dict[str, dict]:
    text = SCHEMA_SQL.read_text(encoding="utf-8")
    tables: dict[str, dict] = {}
    for name, body in re.findall(r"CREATE TABLE `?(\w+)`? \((.*?)\n\) ENGINE", text, flags=re.S):
        columns: dict[str, bool] = {}
        primary_key: list[str] = []
        for raw in body.splitlines():
            line = raw.strip().rstrip(",")
            pk = re.match(r"PRIMARY KEY \((.+)\)", line)
            if pk:
                primary_key = [c.strip() for c in pk.group(1).split(",")]
                continue
            column = re.match(r"(\w+)\s+[A-Z]+", line)
            if column and not line.startswith(("CONSTRAINT", "INDEX", "FOREIGN", "REFERENCES")):
                columns[column.group(1)] = "NOT NULL" not in line
        tables[name] = {"columns": columns, "primary_key": primary_key}
    return tables


SCHEMA = parse_schema()


def test_extra_schema_sql_and_models_have_same_tables():
    assert sorted(SCHEMA) == sorted(TABLES)
    assert sorted(Base.metadata.tables) == sorted(TABLES)


@pytest.mark.parametrize("table", TABLES)
def test_extra_model_columns_match_schema_sql(table):
    model = Base.metadata.tables[table]
    assert {c.name: c.nullable for c in model.columns} == SCHEMA[table]["columns"]
    assert [c.name for c in model.primary_key.columns] == SCHEMA[table]["primary_key"]

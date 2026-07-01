"""Smoke tests for Sahil's Layer 0 parser using bundled demo files."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest


SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from utils.code_parser import parse_file


DEMO_COBOL_DIR = SERVER_ROOT / "demo" / "sample_cobol"
DEMO_SCHEMA_FILE = SERVER_ROOT / "demo" / "sample_schema" / "legacy_bank.sql"
DEMO_JAVA_DIR = SERVER_ROOT / "demo" / "sample_java"
DEMO_JAVA_SCHEMA_FILE = SERVER_ROOT / "demo" / "sample_schema" / "legacy_java_bank.sql"


@pytest.mark.parametrize(
    "source_path",
    sorted(DEMO_COBOL_DIR.glob("*.cbl")),
    ids=lambda path: path.name,
)
def test_parse_demo_cobol_files(source_path: Path) -> None:
    source = source_path.read_text(encoding="utf-8")

    parsed = parse_file(source_path.name, source)

    assert parsed.filename == source_path.name
    assert parsed.language == "cobol"
    assert parsed.raw_lines == source.splitlines()
    assert parsed.chunks
    assert parsed.data_items
    assert parsed.dependencies
    assert all(chunk.language == "cobol" for chunk in parsed.chunks)


def test_parse_demo_sql_schema() -> None:
    source = DEMO_SCHEMA_FILE.read_text(encoding="utf-8")

    parsed = parse_file(DEMO_SCHEMA_FILE.name, source)

    assert parsed.filename == DEMO_SCHEMA_FILE.name
    assert parsed.language == "sql"
    assert parsed.raw_lines == source.splitlines()
    assert parsed.chunks
    assert parsed.data_items
    assert parsed.dependencies
    assert any(item.kind == "table" for item in parsed.data_items)
    assert any(item.kind == "column" for item in parsed.data_items)


@pytest.mark.parametrize(
    "source_path",
    sorted(DEMO_JAVA_DIR.glob("*.java")),
    ids=lambda path: path.name,
)
def test_parse_demo_java_files(source_path: Path) -> None:
    source = source_path.read_text(encoding="utf-8")

    parsed = parse_file(source_path.name, source)

    assert parsed.filename == source_path.name
    assert parsed.language == "java"
    assert parsed.raw_lines == source.splitlines()
    assert parsed.chunks
    assert any(item.kind == "table" and item.detail == "class" for item in parsed.data_items)
    assert any(item.kind == "file" for item in parsed.data_items)
    assert parsed.dependencies
    assert all(chunk.language == "java" for chunk in parsed.chunks)


def test_parse_demo_java_sql_schema() -> None:
    source = DEMO_JAVA_SCHEMA_FILE.read_text(encoding="utf-8")

    parsed = parse_file(DEMO_JAVA_SCHEMA_FILE.name, source)

    table_names = {item.name for item in parsed.data_items if item.kind == "table"}
    column_names = {item.name for item in parsed.data_items if item.kind == "column"}

    assert parsed.filename == DEMO_JAVA_SCHEMA_FILE.name
    assert parsed.language == "sql"
    assert parsed.chunks
    assert {"CUSTOMER", "ACCOUNT", "TRANSFER_REQUEST", "LEDGER_ENTRY",
            "DAILY_LIMIT", "RISK_HOLD", "SETTLEMENT_AUDIT"}.issubset(table_names)
    assert {"CUSTOMER_ID", "ACCOUNT_ID", "AMOUNT", "STATUS"}.issubset(column_names)
    assert ("table_account", "table_customer") in parsed.dependencies
    assert ("table_ledger_entry", "table_transfer_request") in parsed.dependencies

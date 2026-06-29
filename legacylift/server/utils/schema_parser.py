"""
utils/schema_parser.py — SQL schema parsing utilities.

Reads a legacy SQL schema file (DDL) and extracts structured metadata
about tables, columns, data types, and relationships.  This metadata is
used by Layer 4 (schema_validator.py) to verify that the migrated Python
code handles every table and column in the original schema.

The parser uses two complementary approaches:
  1. sqlparse — for tokenising and walking the DDL AST
  2. Regex fallback — for the weird legacy SQL that sqlparse chokes on

In DEMO_MODE the parser skips real SQL and returns a canned schema that
matches the demo/sample_schema/legacy_bank.sql fixture.

Used by:
  core/layer4/schema_validator.py
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Optional

from rich.console import Console

console = Console()
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"

try:
    import sqlparse
    from sqlparse import sql as sqlast
    from sqlparse.tokens import Keyword, DDL, Punctuation
    SQLPARSE_AVAILABLE = True
except ImportError:
    SQLPARSE_AVAILABLE = False
    if DEMO_MODE:
        console.print("[yellow]schema_parser: sqlparse not available — using stub[/yellow]")


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class ColumnInfo:
    """Metadata for a single table column."""
    name: str
    data_type: str
    nullable: bool = True
    default: Optional[str] = None
    is_primary_key: bool = False
    raw_definition: str = ""


@dataclass
class TableInfo:
    """Metadata for a single database table."""
    name: str
    columns: list[ColumnInfo] = field(default_factory=list)
    primary_keys: list[str] = field(default_factory=list)
    indexes: list[str] = field(default_factory=list)
    raw_ddl: str = ""

    @property
    def column_names(self) -> list[str]:
        return [c.name for c in self.columns]


@dataclass
class SchemaInfo:
    """
    The complete parsed representation of a legacy SQL schema file.

    Passed to Layer 4 for validation against the migrated codebase.
    """
    source_file: str
    tables: list[TableInfo] = field(default_factory=list)
    parse_errors: list[str] = field(default_factory=list)

    @property
    def table_names(self) -> list[str]:
        return [t.name for t in self.tables]

    def get_table(self, name: str) -> Optional[TableInfo]:
        """Case-insensitive table lookup."""
        name_lower = name.lower()
        return next((t for t in self.tables if t.name.lower() == name_lower), None)


# ---------------------------------------------------------------------------
# SchemaParser
# ---------------------------------------------------------------------------

class SchemaParser:
    """
    Parses a SQL DDL file into a SchemaInfo object.

    Supports: CREATE TABLE statements with column definitions.
    Does NOT support: stored procedures, views, triggers (yet).

    TODO (implementer):
      - Handle ALTER TABLE ... ADD COLUMN statements for schema evolution
      - Parse CHECK constraints to extract business rules for Layer 0
      - Handle PostgreSQL-specific types (SERIAL, UUID, JSONB)
    """

    def parse_file(self, filepath: str) -> SchemaInfo:
        """
        Read a .sql file from disk and parse its DDL.

        Args:
            filepath: Absolute or relative path to the SQL file.

        Returns:
            SchemaInfo with all tables and columns populated.

        TODO (implementer): add encoding detection for EBCDIC-exported SQL.
        """
        if DEMO_MODE and not os.path.exists(filepath):
            console.print(
                f"[yellow]schema_parser: file not found '{filepath}', "
                "returning demo schema[/yellow]"
            )
            return self._demo_schema(filepath)

        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            return self.parse_text(content, source_file=filepath)
        except Exception as exc:
            console.print(f"[red]schema_parser error reading '{filepath}': {exc}[/red]")
            return SchemaInfo(source_file=filepath, parse_errors=[str(exc)])

    def parse_text(self, sql: str, source_file: str = "<inline>") -> SchemaInfo:
        """
        Parse raw SQL DDL text.

        Args:
            sql:         Raw SQL content.
            source_file: Label for error messages.

        Returns:
            SchemaInfo populated with parsed tables.

        TODO (implementer):
          - Use sqlparse.parse() to walk the statement tree.
          - Fall back to _regex_parse() for statements sqlparse rejects.
        """
        if not sql.strip():
            return SchemaInfo(source_file=source_file, parse_errors=["Empty SQL file"])

        if SQLPARSE_AVAILABLE:
            return self._sqlparse_parse(sql, source_file)
        return self._regex_parse(sql, source_file)

    # -----------------------------------------------------------------------
    # Internal: sqlparse-based parser
    # -----------------------------------------------------------------------

    def _sqlparse_parse(self, sql: str, source_file: str) -> SchemaInfo:
        """
        Parse DDL using sqlparse tokeniser.

        TODO (implementer):
          - Walk each statement, identify CREATE TABLE tokens.
          - Extract column definitions between the outer parentheses.
          - Parse each column line: name, type, NOT NULL, DEFAULT, PRIMARY KEY.
        """
        schema = SchemaInfo(source_file=source_file)
        statements = sqlparse.parse(sql)

        for stmt in statements:
            if stmt.get_type() == "CREATE":
                table = self._parse_create_table(stmt, sql)
                if table:
                    schema.tables.append(table)

        # If sqlparse found nothing, fall back to regex
        if not schema.tables:
            return self._regex_parse(sql, source_file)

        return schema

    def _parse_create_table(
        self, stmt: "sqlast.Statement", full_sql: str
    ) -> Optional[TableInfo]:
        """
        Extract a TableInfo from a single CREATE TABLE statement.

        TODO (implementer):
          - Use stmt.tokens to find the table name token.
          - Find the Parenthesis token containing column defs.
          - Call _parse_column_def() on each comma-separated clause.
        """
        # PLACEHOLDER — use regex for now, graduate to full AST walk later
        raw = str(stmt)
        return self._parse_create_table_regex(raw)

    # -----------------------------------------------------------------------
    # Internal: regex-based parser (reliable fallback)
    # -----------------------------------------------------------------------

    def _regex_parse(self, sql: str, source_file: str) -> SchemaInfo:
        """
        Regex-based CREATE TABLE parser.

        Handles the wild variety of legacy SQL formatting including:
          - All-caps keywords
          - Inline comments (--)
          - No foreign keys (typical in legacy mainframe exports)
        """
        schema = SchemaInfo(source_file=source_file)

        # Strip single-line comments
        sql_clean = re.sub(r"--[^\n]*", "", sql)

        # Find all CREATE TABLE blocks
        pattern = re.compile(
            r"CREATE\s+TABLE\s+(\w+)\s*\((.*?)\)\s*;",
            re.IGNORECASE | re.DOTALL,
        )
        for match in pattern.finditer(sql_clean):
            table_name = match.group(1)
            columns_block = match.group(2)
            table = TableInfo(
                name=table_name,
                raw_ddl=match.group(0),
            )
            for col_def in self._split_columns(columns_block):
                col_def = col_def.strip()
                if not col_def or col_def.upper().startswith(("PRIMARY", "UNIQUE", "INDEX", "KEY")):
                    if col_def.upper().startswith("PRIMARY KEY"):
                        # Extract primary key columns
                        pk_match = re.search(r"\(([^)]+)\)", col_def)
                        if pk_match:
                            pks = [p.strip() for p in pk_match.group(1).split(",")]
                            table.primary_keys.extend(pks)
                    continue
                col = self._parse_column_def(col_def)
                if col:
                    table.columns.append(col)

            schema.tables.append(table)

        if not schema.tables:
            schema.parse_errors.append("No CREATE TABLE statements found in SQL file")

        return schema

    def _split_columns(self, columns_block: str) -> list[str]:
        """Split a column definition block on commas that are NOT inside parentheses."""
        parts: list[str] = []
        depth = 0
        current: list[str] = []
        for ch in columns_block:
            if ch == "(":
                depth += 1
                current.append(ch)
            elif ch == ")":
                depth -= 1
                current.append(ch)
            elif ch == "," and depth == 0:
                parts.append("".join(current))
                current = []
            else:
                current.append(ch)
        if current:
            parts.append("".join(current))
        return parts

    def _parse_create_table_regex(self, raw: str) -> Optional[TableInfo]:
        """Parse a single CREATE TABLE statement string with regex."""
        m = re.match(
            r"CREATE\s+TABLE\s+(\w+)\s*\((.*)\)",
            raw.strip().rstrip(";"),
            re.IGNORECASE | re.DOTALL,
        )
        if not m:
            return None

        table = TableInfo(name=m.group(1), raw_ddl=raw)
        for col_def in self._split_columns(m.group(2)):
            col = self._parse_column_def(col_def.strip())
            if col:
                table.columns.append(col)
        return table

    def _parse_column_def(self, col_def: str) -> Optional[ColumnInfo]:
        """
        Parse a single column definition line.

        Examples handled:
          'ACCT_ID     INTEGER     NOT NULL'
          'BAL_AMT     DECIMAL(15,2)'
          'OPEN_DT     INTEGER     DEFAULT 0'

        TODO (implementer): handle ENUM types, REFERENCES (FK), CHECK constraints.
        """
        col_def = col_def.strip()
        if not col_def:
            return None

        parts = col_def.split()
        if len(parts) < 2:
            return None

        name = parts[0]
        # data_type may already include parameters if column was split correctly,
        # e.g. "DECIMAL(15,2)" — keep it as-is
        data_type = parts[1]

        nullable = "NOT NULL" not in col_def.upper()
        is_pk = "PRIMARY KEY" in col_def.upper()

        default_match = re.search(r"DEFAULT\s+(\S+)", col_def, re.IGNORECASE)
        default = default_match.group(1) if default_match else None

        return ColumnInfo(
            name=name,
            data_type=data_type,
            nullable=nullable,
            default=default,
            is_primary_key=is_pk,
            raw_definition=col_def,
        )

    # -----------------------------------------------------------------------
    # Demo data
    # -----------------------------------------------------------------------

    def _demo_schema(self, source_file: str) -> SchemaInfo:
        """
        Return a canned SchemaInfo matching the demo legacy_bank.sql fixture.
        Used when the real file isn't on disk (e.g. in unit tests).

        TODO (implementer): remove once the real file is always present.
        """
        schema = SchemaInfo(source_file=source_file)
        schema.tables = [
            TableInfo(
                name="ACCT_MSTR",
                columns=[
                    ColumnInfo("ACCT_ID", "INTEGER", nullable=False, is_primary_key=True),
                    ColumnInfo("CUST_ID", "INTEGER", nullable=False),
                    ColumnInfo("ACCT_TYPE", "CHAR(2)", nullable=False),
                    ColumnInfo("BAL_AMT", "DECIMAL(15,2)", nullable=False, default="0"),
                    ColumnInfo("OPEN_DT", "INTEGER", nullable=False),
                    ColumnInfo("STAT_CD", "CHAR(1)", nullable=False, default="A"),
                ],
            ),
            TableInfo(
                name="TXNS",
                columns=[
                    ColumnInfo("TXN_ID", "INTEGER", nullable=False, is_primary_key=True),
                    ColumnInfo("ACCT_ID", "INTEGER", nullable=False),
                    ColumnInfo("TXN_TYPE", "CHAR(2)", nullable=False),
                    ColumnInfo("TXN_AMT", "DECIMAL(15,2)", nullable=False),
                    ColumnInfo("TXN_DT", "INTEGER", nullable=False),
                    ColumnInfo("POST_DT", "INTEGER"),
                ],
            ),
        ]
        return schema

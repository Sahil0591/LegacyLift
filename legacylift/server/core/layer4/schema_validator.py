"""
core/layer4/schema_validator.py — Legacy database schema completeness checker.

Layer 4 is the FINAL quality gate, running after ALL chunks are approved.
It answers one question: does the migrated codebase handle EVERY table and
column in the original legacy database schema?

Legacy systems often have 50-200 cryptically named tables.  The migration
might accidentally skip a table (e.g. ACCT_HIST_2 that nobody knew existed).
Layer 4 catches these omissions.

What it checks:
  1. Parse the legacy SQL schema (via utils/schema_parser.py)
  2. For each table, check if its name appears in any chunk's migrated_code
  3. For tables that ARE referenced, check that key column names also appear
  4. Report any table or column that is referenced in SQL but absent from code

It does NOT check semantic correctness — that is Layer 2's job.
It also does NOT run any SQL — it is purely textual analysis.

Pipeline position: Runs once after all chunks are approved. Called by pipeline.run_layer4().
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from rich.console import Console

from models.project import Project
from models.chunk import MigrationChunk
from utils.schema_parser import SchemaParser, SchemaInfo, TableInfo


class SchemaValidationResult:
    """Result of Layer 4 schema validation (defined here to avoid circular import)."""
    def __init__(self, passed: bool, issues: list, tables_checked: int) -> None:
        self.passed = passed
        self.issues = issues
        self.tables_checked = tables_checked

console = Console()
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"

# Path to demo schema file (relative to project root)
DEMO_SCHEMA_PATH = Path(__file__).parent.parent.parent / "demo" / "sample_schema" / "legacy_bank.sql"


class SchemaValidator:
    """
    Validates that migrated code covers all tables in the legacy SQL schema.
    """

    def __init__(self) -> None:
        self._parser = SchemaParser()

    async def validate(
        self, project: Project, chunks: list[MigrationChunk]
    ) -> SchemaValidationResult:
        """
        Check that every table in the legacy schema is handled in migrated code.

        Args:
            project: The migration project (used to find schema file path).
            chunks:  All approved MigrationChunks with migrated_code.

        Returns:
            SchemaValidationResult with passed flag and list of issues.

        TODO (implementer):
          - Find schema files by scanning project.files for .sql extensions.
          - For each schema file, use SchemaParser to extract tables.
          - Check table name coverage in migrated_code using regex or AST.
          - Also check column coverage for high-risk tables (identified by
            risk_scorer output).
          - Emit 'schema_validation_complete' WebSocket event with results.
          - Consider using SQLAlchemy's inspect() on the actual migrated code's
            ORM models to verify schema alignment at the Python type level.
        """
        if DEMO_MODE:
            console.print("[dim]SchemaValidator.validate() → running schema coverage check[/dim]")

        # --- Load schema ---
        schema = self._find_and_parse_schema(project)

        if not schema.tables:
            return SchemaValidationResult(
                passed=True,
                issues=["No SQL schema files found — skipping schema validation"],
                tables_checked=0,
            )

        # --- Build corpus of all migrated code ---
        all_migrated_code = "\n".join(
            chunk.migrated_code for chunk in chunks if chunk.migrated_code
        )

        # --- Check table coverage ---
        issues: list[str] = []
        tables_checked = 0

        for table in schema.tables:
            tables_checked += 1
            table_issues = self._check_table_coverage(table, all_migrated_code)
            issues.extend(table_issues)

            if DEMO_MODE and not table_issues:
                console.print(f"  [green]✓[/green] {table.name}")
            elif DEMO_MODE:
                for issue in table_issues:
                    console.print(f"  [red]✗[/red] {table.name}: {issue}")

        passed = len([i for i in issues if i.startswith("MISSING TABLE")]) == 0

        return SchemaValidationResult(
            passed=passed,
            issues=issues,
            tables_checked=tables_checked,
        )

    def _find_and_parse_schema(self, project: Project) -> SchemaInfo:
        """
        Locate the SQL schema file(s) in the project uploads and parse them.

        TODO (implementer):
          - Scan project.files for files with .sql extension.
          - Support multiple schema files (parse and merge them).
        """
        # Check uploaded files for SQL
        for f in project.files:
            if f.filename.lower().endswith(".sql") and f.content:
                return self._parser.parse_text(f.content, source_file=f.filename)

        # DEMO_MODE only: fall back to the bundled demo schema so the demo
        # flow works without requiring a .sql upload. In production, a
        # project with no uploaded schema has nothing to validate against —
        # substituting an unrelated canned schema here would silently
        # report bogus "MISSING TABLE" results for tables the project never
        # had. validate() already treats an empty SchemaInfo as "nothing to
        # check" and reports that honestly.
        if DEMO_MODE:
            if DEMO_SCHEMA_PATH.exists():
                return self._parser.parse_file(str(DEMO_SCHEMA_PATH))
            return self._parser._demo_schema("legacy_bank.sql")

        return SchemaInfo(source_file="")

    def _check_table_coverage(
        self, table: TableInfo, all_code: str
    ) -> list[str]:
        """
        Check whether a single table is referenced in the migrated code.

        Args:
            table:    TableInfo from the parsed schema.
            all_code: All migrated Python code concatenated.

        Returns:
            List of issue strings (empty = table is covered).

        TODO (implementer):
          - Use case-insensitive search (COBOL table names are uppercase,
            Python vars are typically snake_case).
          - Also check for ORM model class names (e.g. ACCT_MSTR → AcctMstr).
          - Check key columns (primary keys + NOT NULL columns) are referenced.
          - If a table is missing entirely: CRITICAL issue.
          - If a table is present but missing key columns: WARNING.
        """
        issues: list[str] = []
        table_name_lower = table.name.lower()

        # Check for table name reference (case-insensitive, and snake_case variant)
        snake_variant = table_name_lower.replace("_", "")
        pattern = re.compile(
            rf"\b({re.escape(table_name_lower)}|{re.escape(snake_variant)})\b",
            re.IGNORECASE,
        )

        if not pattern.search(all_code):
            issues.append(
                f"MISSING TABLE: '{table.name}' not referenced in any migrated code — "
                f"({len(table.columns)} columns including {', '.join(table.column_names[:3])})"
            )
            return issues  # No point checking columns if table is missing

        # Check key columns (primary keys and NOT NULL columns)
        key_columns = [c for c in table.columns if c.is_primary_key or not c.nullable]
        for col in key_columns[:5]:  # Check first 5 key columns to avoid noise
            col_pattern = re.compile(
                rf"\b{re.escape(col.name.lower())}\b", re.IGNORECASE
            )
            if not col_pattern.search(all_code):
                issues.append(
                    f"WARNING: Column '{table.name}.{col.name}' "
                    f"({col.data_type}, NOT NULL) not found in migrated code"
                )

        return issues

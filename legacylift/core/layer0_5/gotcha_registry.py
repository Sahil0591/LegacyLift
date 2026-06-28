"""
core/layer0_5/gotcha_registry.py — Known migration pitfall registry.

A 'gotcha' is a subtle correctness issue that arises specifically during
COBOL (or Java/VB6) to Python migration.  Unlike deprecations, which are
about API choices, gotchas are about semantics that change silently:
  - COBOL truncates on overflow; Python int never overflows
  - COBOL string comparison is byte-by-byte with EBCDIC collation
  - COBOL arithmetic rounds differently from Python's decimal module
  - COBOL date arithmetic wraps around century boundaries oddly
  - COBOL PERFORM UNTIL checks condition BEFORE the loop body (like while),
    not after (like do-while)

Each gotcha is a string that goes into the LLM reviewer prompt:
  "WARNING: COBOL PERFORM UNTIL evaluates the condition before
   executing the loop body. Verify the migrated while loop has the
   same semantics."

Pipeline position: Third step of Layer 0.5.
Output injected into Layer 2 (ai_reviewer.py) system prompt.
"""

from __future__ import annotations

import os

from rich.console import Console

console = Console()
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"

# ---------------------------------------------------------------------------
# Gotcha database
# ---------------------------------------------------------------------------

GOTCHAS: dict[tuple[str, str], list[str]] = {
    ("COBOL", "Python"): [
        "INTEGER DIVISION: COBOL integer arithmetic truncates toward zero. "
        "Python 3 // also truncates, but Python / always returns float. "
        "Use // for truncating division; use decimal.Decimal for exact results.",

        "DECIMAL PRECISION: COBOL COMP-3 has exact decimal semantics. "
        "Python float is IEEE 754 binary — NEVER use float for money. "
        "Always use decimal.Decimal with ROUND_HALF_UP for financial rounding.",

        "STRING PADDING: COBOL PIC X(n) fields are right-padded with spaces to "
        "length n. Python str has no fixed length. When comparing, always strip "
        "trailing whitespace: field.rstrip() before comparison.",

        "PERFORM UNTIL: COBOL PERFORM UNTIL checks the condition BEFORE the body "
        "(pre-test loop, like Python 'while'). Verify loop termination is identical.",

        "DATE ARITHMETIC: COBOL dates stored as YYYYMMDD integers. "
        "Converting via datetime.strptime(str(val), '%Y%m%d') will raise "
        "ValueError for invalid dates like 00000000 — add a guard.",

        "SIGN HANDLING: COBOL PIC S9 (signed) fields can have trailing sign. "
        "When parsing fixed-length records, handle the trailing sign byte explicitly.",

        "NUMERIC OVERFLOW: COBOL PIC 9(5) truncates at 99999 silently. "
        "Python int has arbitrary precision — add explicit range checks where "
        "the legacy code relied on overflow behaviour.",

        "EBCDIC vs ASCII: If processing binary files from a mainframe, "
        "EBCDIC-encoded strings must be decoded with codecs.decode(b, 'cp037') "
        "before any string operations.",

        "FILE STATUS: COBOL FILE STATUS codes (00 = success, 10 = end-of-file, etc.) "
        "have no Python equivalent. Map them to exceptions or sentinel values explicitly.",

        "GLOBAL STATE: COBOL WORKING-STORAGE is shared across all paragraphs. "
        "Migrated Python functions that read WORKING-STORAGE variables must "
        "either take them as parameters or use a class to hold state.",
    ],
    ("Java", "Python"): [
        "THREADING: Java is multi-threaded by default; Python has the GIL. "
        "If the Java code uses synchronized blocks, the migration needs explicit "
        "asyncio or multiprocessing to achieve equivalent concurrency.",

        "NULL vs None: Java null and Python None behave similarly but Java "
        "NullPointerException maps to Python AttributeError. Add None guards "
        "where Java code catches NPE.",
    ],
}


class GotchaRegistry:
    """
    Returns the list of known migration gotchas for a language pair.

    Gotchas are injected into the Layer 2 AI reviewer system prompt verbatim.
    """

    async def get_gotchas(
        self, source_language: str, target_language: str
    ) -> list[str]:
        """
        Retrieve all known gotchas for the given source → target language pair.

        Args:
            source_language: e.g. 'COBOL', 'Java'
            target_language: e.g. 'Python', 'Go'

        Returns:
            List of gotcha strings.  Empty list if no gotchas are registered
            for this pair.

        TODO (implementer):
          - Add a severity field (CRITICAL / WARNING) to each gotcha.
          - Load from an external YAML file so domain experts can contribute
            new gotchas without code changes.
          - Consider asking the LLM to generate initial gotchas for new
            language pairs — then have a senior engineer curate the list.
        """
        if DEMO_MODE:
            console.print(
                f"[dim]GotchaRegistry.get_gotchas({source_language} → {target_language})[/dim]"
            )

        key = (source_language.upper(), target_language.capitalize())
        gotchas = GOTCHAS.get(key, [])

        if not gotchas:
            for (src, tgt), g in GOTCHAS.items():
                if src.upper() == source_language.upper() and tgt.lower() == target_language.lower():
                    return g

        return gotchas

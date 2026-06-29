"""
core/layer0_5/deprecation_mapper.py — Deprecated/dangerous API pattern mapper.

Maps known problematic patterns in the source language to their correct
equivalents in the target language.  This knowledge is injected into the
Layer 2 AI reviewer prompt so the LLM knows exactly what NOT to do.

Examples of what this catches:
  COBOL → Python:
    COMP-3 (packed decimal)  → must use decimal.Decimal, NOT float
    PIC 9(8) date as integer → must use datetime.date, NOT int arithmetic
    PERFORM VARYING counter  → use for/range, NOT while True with manual increment
    MOVE SPACES TO ws-field  → use str.strip() or '', NOT literal spaces
    STRING / UNSTRING        → use str.join() / str.split()

The mapper does NOT use the LLM — it reads from a curated pattern database
that developers maintain as they discover new pitfalls.

Pipeline position: Second step of Layer 0.5, after doc_fetcher.py.
"""

from __future__ import annotations

import os

from rich.console import Console

console = Console()
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"

# ---------------------------------------------------------------------------
# Pattern database
# ---------------------------------------------------------------------------

# Maps (source_lang, target_lang) tuples to lists of pattern strings.
# Each pattern is a one-liner that fits in an LLM prompt.
DEPRECATED_PATTERNS: dict[tuple[str, str], list[str]] = {
    ("COBOL", "Python"): [
        "COMP-3 (COMPUTATIONAL-3) fields → use decimal.Decimal, NEVER float (floating-point errors in financial calculations are a regulatory issue)",
        "PIC 9(8) dates stored as YYYYMMDD integers → convert using datetime.strptime(str(val), '%Y%m%d')",
        "PERFORM VARYING with numeric counter → prefer for i in range(start, end)",
        "MOVE SPACES TO field → use field = '' or field = ' ' * length for fixed-width",
        "STRING ... DELIMITED SIZE INTO → use str.join() or f-strings",
        "UNSTRING ... DELIMITED BY → use str.split(delimiter)",
        "REDEFINES clause → use @dataclass with Union types, or named tuple",
        "88-level condition names → use Python Enum class",
        "EVALUATE TRUE / WHEN → use if/elif chains or match/case (Python 3.10+)",
        "ROUNDED clause → use Decimal with ROUND_HALF_UP, not built-in round()",
        "INSPECT CONVERTING → use str.translate() or re.sub()",
        "File I/O (OPEN/READ/WRITE/CLOSE) → use pathlib.Path and with open()",
        "GOBACK / STOP RUN → use sys.exit() or return from main function",
    ],
    ("Java", "Python"): [
        "Java int → Python int (arbitrary precision, no overflow)",
        "Java float/double → use decimal.Decimal for financial calculations",
        "Java Date/Calendar → use datetime.date / datetime.datetime",
        "Java SimpleDateFormat → use datetime.strptime / strftime",
        "Java ArrayList → Python list",
        "Java HashMap → Python dict",
        "Java Optional<T> → Python Optional[T] with None checks",
        "Java checked exceptions → use try/except, not raises declaration",
    ],
}


class DeprecationMapper:
    """
    Returns a list of deprecated pattern strings for the given language pair.

    These strings are injected verbatim into the Layer 2 AI reviewer's system
    prompt so the reviewer knows what anti-patterns to look for.
    """

    async def map(self, source_language: str, target_language: str) -> list[str]:
        """
        Return the list of deprecated patterns for a source→target pair.

        Args:
            source_language: e.g. 'COBOL', 'Java'
            target_language: e.g. 'Python', 'Go'

        Returns:
            List of pattern strings, one per line.  Returns empty list if
            no patterns are defined for this language pair.

        TODO (implementer):
          - Load patterns from a YAML or JSON file so non-developers can
            contribute new gotchas without touching Python code.
          - Add a 'severity' field (CRITICAL / WARNING) to each pattern.
          - Consider using the LLM to generate initial patterns for new
            language pairs, then have a human curate them.
        """
        if DEMO_MODE:
            console.print(
                f"[dim]DeprecationMapper.map({source_language} → {target_language})[/dim]"
            )

        key = (source_language.upper(), target_language.capitalize())
        patterns = DEPRECATED_PATTERNS.get(key, [])

        if not patterns:
            # Try case-insensitive fallback
            for (src, tgt), pats in DEPRECATED_PATTERNS.items():
                if src.upper() == source_language.upper() and tgt.lower() == target_language.lower():
                    patterns = pats
                    break

        return patterns

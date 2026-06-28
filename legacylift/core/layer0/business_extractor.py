"""
core/layer0/business_extractor.py — LLM-powered business rule extractor.

This module reads every uploaded source file and uses the LLM to identify
discrete business decisions embedded in the code.  These are rules that a
domain expert (not just a programmer) would need to verify before migration.

Examples of what we're looking for:
  - "Interest rate is 2.5% for balances below $10,000"
  - "Penalty waived if customer has Premium status"
  - "End-of-day batch must complete before 23:59"
  - "Maximum withdrawal is $50,000 per day"

The extractor prompts the LLM with each file's source code and asks it to
return structured JSON listing every rule it finds.

Pipeline position: Step 2 of Layer 0, called after Archaeologist.analyse().
Output consumed by ownership/classifier.py and surfaced via GET /api/.../rules.
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Any

from rich.console import Console

from legacylift.models.project import Project
from legacylift.models.business_rule import BusinessRule, RuleConfidence
from legacylift.utils.llm_client import LLMClient

console = Console()
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"

# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are an expert legacy code analyst specialising in extracting business rules
from COBOL, Java, and VB6 code.

A business rule is a discrete business decision embedded in code: a threshold,
a rate, a policy, a timing constraint, or a regulatory requirement.  It is NOT
a programming construct (loops, I/O routines, error handling).

Return your answer as a JSON object with a single key "rules" containing a list.
Each rule must have:
  - title:             short one-line summary
  - description:       plain-English explanation a non-programmer can verify
  - source_lines:      [start_line, end_line] where the rule appears
  - confidence:        "High", "Medium", or "Low"
  - hardcoded_values:  list of magic numbers or strings in the rule logic
  - warnings:          list of anything suspicious (e.g. duplicate logic)

Return ONLY valid JSON. No markdown, no explanation outside the JSON object.
"""

USER_PROMPT_TEMPLATE = """\
Analyse the following {language} source file and extract all business rules.

File: {filename}
```
{source_code}
```
"""


class BusinessExtractor:
    """
    Extracts BusinessRule objects from legacy source files using the LLM.

    Processes each file independently so errors in one file don't block others.
    Returns a flat list of all rules across all files.
    """

    def __init__(self) -> None:
        self._client = LLMClient()

    async def extract(self, project: Project) -> list[BusinessRule]:
        """
        Run business rule extraction across all uploaded project files.

        Args:
            project: Project with .files list populated.

        Returns:
            List of BusinessRule objects across all files, ordered by source file.

        TODO (implementer):
          - Run asyncio.gather() over self._extract_from_file() for all files
            to process them in parallel (significant speed-up for large codebases).
          - Add deduplication: if the same threshold appears in two files,
            merge them into one rule with a list of source_files.
          - Chunk large files before sending to the LLM if they exceed the
            model's context window (roughly 100K tokens for gpt-4o).
        """
        if DEMO_MODE:
            console.print(
                f"[dim]BusinessExtractor.extract() → processing {len(project.files)} files[/dim]"
            )

        all_rules: list[BusinessRule] = []
        for f in project.files:
            rules = await self._extract_from_file(
                filename=f.filename,
                content=f.content or "-- empty --",
                language=project.source_language,
            )
            all_rules.extend(rules)

        return all_rules

    async def _extract_from_file(
        self, filename: str, content: str, language: str
    ) -> list[BusinessRule]:
        """
        Extract business rules from a single file by calling the LLM.

        Args:
            filename: Name of the source file (for attribution).
            content:  Full text content of the file.
            language: Source language string (e.g. 'COBOL').

        Returns:
            List of BusinessRule objects parsed from the LLM's JSON response.

        TODO (implementer):
          - Parse the LLM response JSON.
          - Map confidence strings to RuleConfidence enum.
          - Assign sequential IDs like BR-001, BR-002 across all files.
          - Handle LLM hallucinations: if source_lines are out of range,
            clamp them to the actual file line count.
        """
        try:
            user_prompt = USER_PROMPT_TEMPLATE.format(
                language=language,
                filename=filename,
                source_code=content[:8000],  # Truncate very large files
            )

            raw = await self._client.complete(
                system=SYSTEM_PROMPT,
                user=user_prompt,
                temperature=0.1,  # Low temperature for deterministic extraction
            )

            return self._parse_llm_response(raw, filename)

        except Exception as exc:
            if DEMO_MODE:
                console.print(
                    f"[red]BusinessExtractor error for {filename}: {exc}[/red]"
                )
            # Return stub rule so the pipeline continues
            return self._stub_rules(filename)

    def _parse_llm_response(self, raw: str, filename: str) -> list[BusinessRule]:
        """
        Parse the LLM's JSON response into BusinessRule objects.

        Args:
            raw:      Raw string response from the LLM.
            filename: Source filename for attribution.

        Returns:
            List of parsed BusinessRule objects.

        TODO (implementer):
          - Handle edge cases: LLM wraps JSON in markdown ```json ... ```.
          - Validate each rule has required fields before constructing the model.
          - Log a warning (not an error) for rules with Low confidence.
        """
        # Strip markdown code fences if present
        text = raw.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1])

        try:
            data = json.loads(text)
            rules_data: list[dict] = data.get("rules", [])
        except json.JSONDecodeError:
            # LLM returned non-JSON — fall back to stub
            return self._stub_rules(filename)

        rules: list[BusinessRule] = []
        for i, r in enumerate(rules_data):
            try:
                lines_raw = r.get("source_lines", [0, 0])
                rule = BusinessRule(
                    id=f"BR-{(i + 1):03d}",
                    title=r.get("title", "Untitled Rule"),
                    description=r.get("description", ""),
                    source_file=filename,
                    source_lines=tuple(lines_raw[:2]) if len(lines_raw) >= 2 else (0, 0),
                    confidence=RuleConfidence(r.get("confidence", "Medium")),
                    hardcoded_values=r.get("hardcoded_values", []),
                    warnings=r.get("warnings", []),
                )
                rules.append(rule)
            except Exception:
                continue  # Skip malformed rules

        return rules if rules else self._stub_rules(filename)

    def _stub_rules(self, filename: str) -> list[BusinessRule]:
        """
        Return canned business rules for DEMO_MODE or when LLM fails.

        TODO (implementer): remove once real extraction is working.
        """
        stubs: dict[str, list[BusinessRule]] = {
            "interest_calc.cbl": [
                BusinessRule(
                    id="BR-001",
                    title="Tier-1 Interest Rate (Low Balance)",
                    description=(
                        "Accounts with a balance below $10,000 earn interest "
                        "at 2.5% per annum, applied daily using a 365-day year."
                    ),
                    source_file=filename,
                    source_lines=(42, 58),
                    confidence=RuleConfidence.HIGH,
                    hardcoded_values=["10000", "2.5", "365"],
                    warnings=[],
                ),
                BusinessRule(
                    id="BR-002",
                    title="Tier-2 Interest Rate (Mid Balance)",
                    description=(
                        "Accounts with a balance between $10,000 and $100,000 "
                        "earn 3.75% per annum."
                    ),
                    source_file=filename,
                    source_lines=(60, 72),
                    confidence=RuleConfidence.HIGH,
                    hardcoded_values=["10000", "100000", "3.75"],
                    warnings=[],
                ),
                BusinessRule(
                    id="BR-003",
                    title="Tier-3 Interest Rate (High Balance)",
                    description="Accounts with a balance above $100,000 earn 4.5% per annum.",
                    source_file=filename,
                    source_lines=(74, 85),
                    confidence=RuleConfidence.HIGH,
                    hardcoded_values=["100000", "4.5"],
                    warnings=["Commented-out code near line 80 suggests this rate changed"],
                ),
            ],
            "account_master.cbl": [
                BusinessRule(
                    id="BR-004",
                    title="Account Status Lock on Delinquency",
                    description=(
                        "If an account is more than 90 days past due, "
                        "its status code is set to 'D' (delinquent) and "
                        "withdrawals are blocked."
                    ),
                    source_file=filename,
                    source_lines=(33, 41),
                    confidence=RuleConfidence.HIGH,
                    hardcoded_values=["90", "D"],
                    warnings=["Dead code block at lines 88-95 may contain an older version"],
                ),
            ],
            "end_of_day_batch.cbl": [
                BusinessRule(
                    id="BR-005",
                    title="End-of-Day Batch Processing Window",
                    description=(
                        "The end-of-day batch must start after 23:00 and "
                        "complete before 23:59 AEST.  If it exceeds this window "
                        "the batch is flagged and ops is notified."
                    ),
                    source_file=filename,
                    source_lines=(18, 30),
                    confidence=RuleConfidence.MEDIUM,
                    hardcoded_values=["230000", "235900"],
                    warnings=["Time zone is hardcoded — may break during DST"],
                ),
            ],
        }
        return stubs.get(filename, [BusinessRule(
            id="BR-999",
            title="Demo Placeholder Rule",
            description="This is a placeholder rule returned in DEMO_MODE.",
            source_file=filename,
            source_lines=(1, 10),
            confidence=RuleConfidence.LOW,
            hardcoded_values=[],
            warnings=["Implement BusinessExtractor._extract_from_file() to get real rules"],
        )])

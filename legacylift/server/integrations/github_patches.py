from __future__ import annotations

import re
from dataclasses import dataclass


_HUNK_HEADER_RE = re.compile(r"^@@ -(?P<old_start>\d+)(?:,(?P<old_count>\d+))? \+(?P<new_start>\d+)(?:,(?P<new_count>\d+))? @@")


@dataclass(frozen=True)
class ParsedPatchHunk:
    hunk_index: int
    header: str
    old_start_line: int
    old_end_line: int
    new_start_line: int
    new_end_line: int
    patch: str


def parse_patch_hunks(patch: str | None) -> list[ParsedPatchHunk]:
    if not patch:
        return []

    hunks: list[ParsedPatchHunk] = []
    current: list[str] = []
    for line in patch.splitlines():
        if line.startswith("@@ "):
            if current:
                hunks.append(_parse_hunk(len(hunks), current))
            current = [line]
        elif current:
            current.append(line)

    if current:
        hunks.append(_parse_hunk(len(hunks), current))

    return hunks


def _parse_hunk(hunk_index: int, lines: list[str]) -> ParsedPatchHunk:
    header = lines[0]
    match = _HUNK_HEADER_RE.match(header)
    if match is None:
        raise ValueError(f"Invalid unified diff hunk header: {header}")

    old_start = int(match.group("old_start"))
    new_start = int(match.group("new_start"))
    old_count = int(match.group("old_count") or "1")
    new_count = int(match.group("new_count") or "1")

    return ParsedPatchHunk(
        hunk_index=hunk_index,
        header=header,
        old_start_line=old_start,
        old_end_line=_end_line(old_start, old_count),
        new_start_line=new_start,
        new_end_line=_end_line(new_start, new_count),
        patch="\n".join(lines),
    )


def _end_line(start: int, count: int) -> int:
    if count <= 0:
        return start
    return start + count - 1

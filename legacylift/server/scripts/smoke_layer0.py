"""Run the Layer 0 parser against the bundled COBOL and SQL demos."""

from __future__ import annotations

import sys
from pathlib import Path


SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from utils.code_parser import parse_file


DEMO_DIRS = (
    SERVER_ROOT / "demo" / "sample_cobol",
    SERVER_ROOT / "demo" / "sample_schema",
)
SUPPORTED_SUFFIXES = {".cbl", ".cob", ".cobol", ".java", ".sql"}


def main() -> None:
    demo_files = sorted(
        path
        for demo_dir in DEMO_DIRS
        for path in demo_dir.iterdir()
        if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
    )

    for path in demo_files:
        parsed = parse_file(path.name, path.read_text(encoding="utf-8"))
        print(
            f"{path.name}: language={parsed.language} "
            f"chunks={len(parsed.chunks)} "
            f"dependencies={len(parsed.dependencies)} "
            f"data_items={len(parsed.data_items)}"
        )


if __name__ == "__main__":
    main()

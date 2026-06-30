"""
utils/code_parser.py — Structural parser for COBOL, Java, and SQL source files.

Single public entry-point: parse_file(filename, source) -> ParsedFile
Leaf node for Layer 0 sub-step 0a. No imports from the rest of legacylift.
Never raises — returns an empty ParsedFile on any unrecoverable error.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public data contracts  (consumed by all downstream Layer 0 sub-steps)
# ---------------------------------------------------------------------------

@dataclass
class DataItem:
    name: str
    kind: str    # "variable" | "table" | "column" | "file"
    detail: str  # PIC clause, SQL type, or empty string


@dataclass
class CodeChunk:
    id: str
    name: str
    language: str
    source: str
    start_line: int
    end_line: int
    calls: list[str] = field(default_factory=list)


@dataclass
class ParsedFile:
    filename: str
    language: str
    chunks: list[CodeChunk] = field(default_factory=list)
    dependencies: list[tuple[str, str]] = field(default_factory=list)
    data_items: list[DataItem] = field(default_factory=list)
    raw_lines: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Optional tree-sitter imports — fail gracefully if grammars not installed
# ---------------------------------------------------------------------------

_COBOL_TS_AVAILABLE = False
_JAVA_TS_AVAILABLE = False
_COBOL_LANG = None
_JAVA_LANG = None
_TSParser = None

try:
    from tree_sitter import Language as _TSLanguage, Parser as _TSParser  # type: ignore
    try:
        import tree_sitter_cobol as _tscobol  # type: ignore
        _COBOL_LANG = _TSLanguage(_tscobol.language())
        _COBOL_TS_AVAILABLE = True
    except Exception:
        pass
    try:
        import tree_sitter_java as _tsjava  # type: ignore
        _JAVA_LANG = _TSLanguage(_tsjava.language())
        _JAVA_TS_AVAILABLE = True
    except Exception:
        pass
except Exception:
    pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_chunk_id(filename: str, name: str) -> str:
    stem = Path(filename).stem.lower()
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return f"{stem}__{slug}"


def _detect_language(ext: str) -> str:
    ext = ext.lower()
    if ext in (".cbl", ".cob", ".cobol"):
        return "cobol"
    if ext == ".java":
        return "java"
    if ext == ".sql":
        return "sql"
    return "unknown"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_file(filename: str, source: str) -> ParsedFile:
    """Parse a legacy source file into structured pipeline data.

    Never raises. On any error returns an empty ParsedFile with language='unknown'.
    """
    try:
        ext = Path(filename).suffix
        language = _detect_language(ext)

        if language == "unknown":
            logger.warning("code_parser: unsupported extension %r for %s", ext, filename)
            return ParsedFile(filename=filename, language="unknown",
                              chunks=[], dependencies=[], data_items=[],
                              raw_lines=[])

        raw_lines = source.splitlines()
        extra_deps: list[tuple[str, str]] = []

        if language == "cobol":
            chunks, data_items = _parse_cobol(filename, source)
        elif language == "java":
            chunks, data_items = _parse_java(filename, source)
        else:  # sql
            chunks, data_items, extra_deps = _parse_sql(filename, source)

        # Build dependency list: chunk.calls edges + SQL FK edges
        deps: list[tuple[str, str]] = list(extra_deps)
        for chunk in chunks:
            for callee in chunk.calls:
                deps.append((chunk.id, callee))

        # Deduplicate preserving insertion order
        seen: set[tuple[str, str]] = set()
        unique_deps: list[tuple[str, str]] = []
        for d in deps:
            if d not in seen:
                seen.add(d)
                unique_deps.append(d)

        return ParsedFile(
            filename=filename,
            language=language,
            chunks=chunks,
            dependencies=unique_deps,
            data_items=data_items,
            raw_lines=raw_lines,
        )

    except Exception as e:
        logger.error("parse_file failed for %s: %s", filename, e, exc_info=True)
        return ParsedFile(filename=filename, language="unknown",
                          chunks=[], dependencies=[], data_items=[],
                          raw_lines=[])


class CodeParser:
    """
    Backward-compatible object API for older pipeline code and tests.

    Newer Layer 0 code uses parse_file(filename, source) directly. This wrapper
    keeps the original parser shape available without duplicating parsing logic.
    """

    def __init__(self, language: str = "cobol", filename: str | None = None) -> None:
        self.language = language.lower()
        self.filename = filename or self._default_filename(self.language)

    def parse(self, source: str) -> list[CodeChunk]:
        """Parse source and return structural chunks."""
        return parse_file(self.filename, source).chunks

    def extract_literals(self, source: str) -> list[str]:
        """Extract simple quoted and numeric literals from source."""
        quoted = re.findall(r"'([^']*)'|\"([^\"]*)\"", source)
        literals = [single or double for single, double in quoted]
        literals.extend(
            m.group(0)
            for m in re.finditer(r"(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])", source)
        )
        return literals

    def split_into_chunks(self, source: str) -> list[tuple[str, str, int, int]]:
        """Return legacy tuple chunks: (name, source, start_line, end_line)."""
        parsed = parse_file(self.filename, source)
        return [
            (chunk.name, chunk.source, chunk.start_line, chunk.end_line)
            for chunk in parsed.chunks
        ]

    @staticmethod
    def _default_filename(language: str) -> str:
        if language == "java":
            return "input.java"
        if language == "sql":
            return "input.sql"
        if language == "cobol":
            return "input.cbl"
        return "input.txt"


# ---------------------------------------------------------------------------
# COBOL parsing
# ---------------------------------------------------------------------------

def _parse_cobol(
    filename: str, source: str
) -> tuple[list[CodeChunk], list[DataItem]]:
    if _COBOL_TS_AVAILABLE:
        try:
            return _parse_cobol_ts(filename, source)
        except Exception as e:
            logger.warning(
                "COBOL tree-sitter failed for %s, falling back to regex: %s", filename, e
            )
    return _parse_cobol_regex(filename, source)


# -- tree-sitter COBOL -------------------------------------------------------

def _parse_cobol_ts(
    filename: str, source: str
) -> tuple[list[CodeChunk], list[DataItem]]:
    parser = _TSParser(_COBOL_LANG)  # type: ignore[call-arg]
    tree = parser.parse(source.encode("utf-8"))
    lines = source.splitlines()
    chunks: list[CodeChunk] = []
    data_items: list[DataItem] = []

    def _walk_calls(node, calls: list[str]) -> None:
        if node.type in ("perform_statement", "perform_phrase"):
            for child in node.children:
                if child.type in ("paragraph_name", "section_name", "user_defined_word"):
                    calls.append(source[child.start_byte:child.end_byte].strip())
        elif node.type == "call_statement":
            for child in node.children:
                if child.type in ("string_literal", "alphanumeric_literal"):
                    calls.append(source[child.start_byte:child.end_byte].strip("'\" "))
        elif node.type == "go_to_statement":
            for child in node.children:
                if child.type in ("paragraph_name", "user_defined_word"):
                    calls.append(source[child.start_byte:child.end_byte].strip())
        for child in node.children:
            _walk_calls(child, calls)

    def _walk_tree(node) -> None:
        if node.type == "paragraph":
            try:
                name_node = next(
                    (c for c in node.children if c.type == "paragraph_name"), None
                )
                if name_node:
                    name = source[name_node.start_byte:name_node.end_byte].strip()
                    start_line = node.start_point[0] + 1
                    end_line = node.end_point[0] + 1
                    calls: list[str] = []
                    _walk_calls(node, calls)
                    chunks.append(CodeChunk(
                        id=_make_chunk_id(filename, name),
                        name=name,
                        language="cobol",
                        source="\n".join(lines[start_line - 1:end_line]),
                        start_line=start_line,
                        end_line=end_line,
                        calls=list(dict.fromkeys(calls)),
                    ))
            except Exception as e:
                logger.debug("TS COBOL paragraph error in %s: %s", filename, e)

        elif node.type == "data_description_entry":
            try:
                level_node = next(
                    (c for c in node.children if c.type == "level_number"), None
                )
                name_node = next(
                    (c for c in node.children
                     if c.type in ("user_defined_word", "data_name")), None
                )
                pic_node = next(
                    (c for c in node.children if c.type == "picture_clause"), None
                )
                if level_node and name_node and pic_node:
                    level = source[level_node.start_byte:level_node.end_byte].strip()
                    if level in ("01", "77"):
                        data_items.append(DataItem(
                            name=source[name_node.start_byte:name_node.end_byte].strip(),
                            kind="variable",
                            detail=source[pic_node.start_byte:pic_node.end_byte].strip(),
                        ))
            except Exception as e:
                logger.debug("TS COBOL data item error in %s: %s", filename, e)

        for child in node.children:
            _walk_tree(child)

    _walk_tree(tree.root_node)
    return chunks, data_items


# -- regex COBOL -------------------------------------------------------------

_CB_DIV_RE = re.compile(
    r"^\s*(IDENTIFICATION|ENVIRONMENT|DATA|PROCEDURE)\s+DIVISION",
    re.IGNORECASE,
)
_CB_SECT_RE = re.compile(
    r"^([A-Z0-9][A-Z0-9-]*)\s+SECTION\s*\.",
    re.IGNORECASE,
)
_CB_PARA_RE = re.compile(
    r"^([A-Z0-9][A-Z0-9-]*)\s*\.\s*$",
    re.IGNORECASE,
)
_CB_DATA_RE = re.compile(
    r"^\s*(01|77)\s+([A-Z0-9][A-Z0-9-]*)\s+(?:PIC|PICTURE)\s+(\S+)",
    re.IGNORECASE,
)
_CB_SELECT_RE = re.compile(
    r"\bSELECT\s+([A-Z0-9][A-Z0-9-]*)\s+ASSIGN\s+TO\s+(\S+)",
    re.IGNORECASE,
)
_CB_PERFORM_RE = re.compile(r"\bPERFORM\s+([A-Z0-9][A-Z0-9-]+)", re.IGNORECASE)
_CB_CALL_RE = re.compile(r"\bCALL\s+['\"]([^'\"]+)['\"]", re.IGNORECASE)
_CB_GOTO_RE = re.compile(r"\bGO\s+TO\s+([A-Z0-9][A-Z0-9-]+)", re.IGNORECASE)

# Words that trail a PERFORM but are not paragraph names
_CB_NON_CALL = frozenset({
    "UNTIL", "TIMES", "VARYING", "FROM", "BY", "WITH", "TEST",
    "BEFORE", "AFTER", "THRU", "THROUGH", "END-PERFORM",
})
# Names that look like paragraphs but are division/clause keywords
_CB_NON_PARA = frozenset({
    "IDENTIFICATION", "ENVIRONMENT", "DATA", "PROCEDURE",
    "END", "WORKING-STORAGE", "LOCAL-STORAGE", "LINKAGE",
    "FILE", "REPORT", "SCREEN", "COMMUNICATION", "DECLARATIVES",
})


def _cobol_strip_line(raw: str) -> tuple[str, str]:
    """Return (indicator, content_cols_8_to_72) from a fixed-format COBOL line."""
    padded = raw.ljust(80)
    indicator = padded[6]
    return indicator, padded[7:72].rstrip()


def _extract_cobol_calls(chunk_source: str) -> list[str]:
    calls: list[str] = []
    for m in _CB_PERFORM_RE.finditer(chunk_source):
        name = m.group(1).upper()
        if name not in _CB_NON_CALL:
            calls.append(name)
    for m in _CB_CALL_RE.finditer(chunk_source):
        calls.append(m.group(1))
    for m in _CB_GOTO_RE.finditer(chunk_source):
        name = m.group(1).upper()
        if name not in _CB_NON_CALL:
            calls.append(name)
    return list(dict.fromkeys(calls))


def _parse_cobol_regex(
    filename: str, source: str
) -> tuple[list[CodeChunk], list[DataItem]]:
    raw_lines = source.splitlines()
    data_items: list[DataItem] = []
    chunks: list[CodeChunk] = []

    # Strip fixed-format fields; blank out comment/page lines
    active: list[tuple[int, str]] = []  # (1-indexed lineno, content)
    for i, raw in enumerate(raw_lines, 1):
        indicator, content = _cobol_strip_line(raw)
        active.append((i, "" if indicator in ("*", "/") else content))

    current_div: str = ""
    # List of (paragraph_name, 1-indexed start line) in order of appearance
    para_starts: list[tuple[str, int]] = []

    for lineno, content in active:
        if not content.strip():
            continue

        # Division boundary
        div_m = _CB_DIV_RE.match(content)
        if div_m:
            current_div = div_m.group(1).upper()
            continue

        if current_div == "DATA":
            m = _CB_DATA_RE.match(content)
            if m:
                data_items.append(DataItem(
                    name=m.group(2),
                    kind="variable",
                    detail=m.group(3).rstrip("."),
                ))

        elif current_div == "ENVIRONMENT":
            m = _CB_SELECT_RE.search(content)
            if m:
                data_items.append(DataItem(
                    name=m.group(1),
                    kind="file",
                    detail=m.group(2).strip("'\"").rstrip("."),
                ))

        elif current_div == "PROCEDURE":
            # Paragraph/section headers start in Area A: content[0] is non-space
            if content and content[0] not in (" ", "\t"):
                sect_m = _CB_SECT_RE.match(content)
                if sect_m:
                    para_starts.append((sect_m.group(1).upper() + " SECTION", lineno))
                    continue
                para_m = _CB_PARA_RE.match(content)
                if para_m:
                    name = para_m.group(1).upper()
                    if name not in _CB_NON_PARA:
                        para_starts.append((name, lineno))

    # Build one CodeChunk per paragraph/section
    total_lines = len(raw_lines)
    for idx, (para_name, start_line) in enumerate(para_starts):
        try:
            end_line = (
                para_starts[idx + 1][1] - 1
                if idx + 1 < len(para_starts)
                else total_lines
            )
            chunk_source = "\n".join(raw_lines[start_line - 1:end_line])
            chunks.append(CodeChunk(
                id=_make_chunk_id(filename, para_name),
                name=para_name,
                language="cobol",
                source=chunk_source,
                start_line=start_line,
                end_line=end_line,
                calls=_extract_cobol_calls(chunk_source),
            ))
        except Exception as e:
            logger.debug(
                "COBOL paragraph extraction error in %s line %d: %s",
                filename, start_line, e,
            )

    return chunks, data_items


# ---------------------------------------------------------------------------
# Java parsing
# ---------------------------------------------------------------------------

def _parse_java(
    filename: str, source: str
) -> tuple[list[CodeChunk], list[DataItem]]:
    if _JAVA_TS_AVAILABLE:
        try:
            return _parse_java_ts(filename, source)
        except Exception as e:
            logger.warning(
                "Java tree-sitter failed for %s, falling back to regex: %s", filename, e
            )
    return _parse_java_regex(filename, source)


# -- tree-sitter Java --------------------------------------------------------

_JAVA_TS_KW = frozenset({
    "if", "for", "while", "switch", "catch", "assert", "new",
    "return", "throw", "super", "this",
})


def _parse_java_ts(
    filename: str, source: str
) -> tuple[list[CodeChunk], list[DataItem]]:
    parser = _TSParser(_JAVA_LANG)  # type: ignore[call-arg]
    tree = parser.parse(source.encode("utf-8"))
    lines = source.splitlines()
    chunks: list[CodeChunk] = []
    data_items: list[DataItem] = []

    def _walk_calls(node, calls: list[str]) -> None:
        if node.type == "method_invocation":
            name_node = next(
                (c for c in node.children if c.type == "identifier"), None
            )
            if name_node:
                name = source[name_node.start_byte:name_node.end_byte]
                if name.lower() not in _JAVA_TS_KW:
                    calls.append(name)
        for child in node.children:
            _walk_calls(child, calls)

    def _walk_tree(node) -> None:
        if node.type == "class_declaration":
            name_node = next(
                (c for c in node.children if c.type == "identifier"), None
            )
            if name_node:
                data_items.append(DataItem(
                    name=source[name_node.start_byte:name_node.end_byte],
                    kind="table",
                    detail="class",
                ))

        elif node.type == "import_declaration":
            raw = source[node.start_byte:node.end_byte].strip().rstrip(";")
            path = re.sub(r"^import\s+(static\s+)?", "", raw, flags=re.IGNORECASE)
            data_items.append(DataItem(name=path, kind="file", detail=path))

        elif node.type == "method_declaration":
            try:
                name_node = next(
                    (c for c in node.children if c.type == "identifier"), None
                )
                if name_node:
                    method_name = source[name_node.start_byte:name_node.end_byte]
                    start_line = node.start_point[0] + 1
                    end_line = node.end_point[0] + 1
                    calls: list[str] = []
                    _walk_calls(node, calls)
                    chunks.append(CodeChunk(
                        id=_make_chunk_id(filename, method_name),
                        name=method_name,
                        language="java",
                        source="\n".join(lines[start_line - 1:end_line]),
                        start_line=start_line,
                        end_line=end_line,
                        calls=list(dict.fromkeys(calls)),
                    ))
            except Exception as e:
                logger.debug("TS Java method error in %s: %s", filename, e)

        for child in node.children:
            _walk_tree(child)

    _walk_tree(tree.root_node)
    return chunks, data_items


# -- regex Java --------------------------------------------------------------

_JAVA_METHOD_RE = re.compile(
    r"(?:(?:public|protected|private|static|final|abstract|"
    r"synchronized|native|strictfp)\s+)*"
    r"(?:<[^>]+>\s*)?"                  # optional generics
    r"(?:void|[\w\[\]<>,? ]+?)\s+"     # return type (non-greedy)
    r"(\w+)\s*\([^)]*\)\s*"            # method name + params
    r"(?:throws\s+[\w\s,]+\s*)?\{",    # optional throws + opening brace
    re.MULTILINE,
)
_JAVA_CLASS_RE = re.compile(
    r"\b(?:class|interface|enum)\s+(\w+)", re.MULTILINE
)
_JAVA_IMPORT_RE = re.compile(
    r"^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;", re.MULTILINE
)
_JAVA_CALL_RE = re.compile(r"\b(\w+)\s*\(")
_JAVA_KW_SET = frozenset({
    "if", "for", "while", "switch", "catch", "assert", "new",
    "return", "throw", "super", "this", "instanceof", "else",
    "synchronized", "try", "finally", "do",
})


def _parse_java_regex(
    filename: str, source: str
) -> tuple[list[CodeChunk], list[DataItem]]:
    chunks: list[CodeChunk] = []
    data_items: list[DataItem] = []

    for m in _JAVA_CLASS_RE.finditer(source):
        data_items.append(DataItem(name=m.group(1), kind="table", detail="class"))

    for m in _JAVA_IMPORT_RE.finditer(source):
        data_items.append(DataItem(name=m.group(1), kind="file", detail=m.group(1)))

    for m in _JAVA_METHOD_RE.finditer(source):
        try:
            method_name = m.group(1)
            if method_name in _JAVA_KW_SET:
                continue

            # Locate the opening brace and walk to matching close brace
            brace_pos = source.index("{", m.start())
            depth = 0
            end_byte = brace_pos
            for i in range(brace_pos, len(source)):
                if source[i] == "{":
                    depth += 1
                elif source[i] == "}":
                    depth -= 1
                    if depth == 0:
                        end_byte = i
                        break

            method_source = source[m.start():end_byte + 1]
            start_line = source[: m.start()].count("\n") + 1
            end_line = source[: end_byte + 1].count("\n") + 1

            calls = [
                c.group(1)
                for c in _JAVA_CALL_RE.finditer(method_source)
                if c.group(1) not in _JAVA_KW_SET
            ]

            chunks.append(CodeChunk(
                id=_make_chunk_id(filename, method_name),
                name=method_name,
                language="java",
                source=method_source,
                start_line=start_line,
                end_line=end_line,
                calls=list(dict.fromkeys(calls)),
            ))
        except Exception as e:
            logger.debug("Java regex method error in %s: %s", filename, e)

    return chunks, data_items


# ---------------------------------------------------------------------------
# SQL parsing (regex only — no tree-sitter needed)
# ---------------------------------------------------------------------------

_SQL_TABLE_RE = re.compile(
    r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"
    r"([`\"\[]?[\w.]+[`\"\]]?)\s*"
    r"\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*;?",
    re.IGNORECASE | re.DOTALL,
)
_SQL_COLUMN_RE = re.compile(
    r"^\s*([`\"\[]?[\w]+[`\"\]]?)\s+([\w\(\), ]+?)(?:\s+(?:NOT\s+NULL|NULL|DEFAULT|"
    r"PRIMARY|UNIQUE|REFERENCES|CHECK|COMMENT|AUTO_INCREMENT|GENERATED).*)?$",
    re.IGNORECASE,
)
_SQL_FK_RE = re.compile(
    r"FOREIGN\s+KEY\s*\([^)]+\)\s*REFERENCES\s+([`\"\[]?[\w.]+[`\"\]]?)",
    re.IGNORECASE,
)
_SQL_CONSTRAINT_START_RE = re.compile(
    r"^\s*(?:CONSTRAINT\s+\w+\s+)?(?:PRIMARY|UNIQUE|INDEX|KEY|CHECK|FOREIGN)\b",
    re.IGNORECASE,
)


def _sql_clean_name(raw: str) -> str:
    return raw.strip('`"[]').split(".")[-1]


def _parse_sql(
    filename: str, source: str
) -> tuple[list[CodeChunk], list[DataItem], list[tuple[str, str]]]:
    stem = Path(filename).stem.lower()
    chunks: list[CodeChunk] = []
    data_items: list[DataItem] = []
    extra_deps: list[tuple[str, str]] = []

    for m in _SQL_TABLE_RE.finditer(source):
        try:
            table_name = _sql_clean_name(m.group(1))
            table_body = m.group(2)
            start_line = source[: m.start()].count("\n") + 1
            end_line = source[: m.end()].count("\n") + 1
            chunk_id = f"{stem}__table_{table_name.lower()}"

            chunks.append(CodeChunk(
                id=chunk_id,
                name=table_name,
                language="sql",
                source=source[m.start():m.end()],
                start_line=start_line,
                end_line=end_line,
                calls=[],
            ))

            data_items.append(DataItem(name=table_name, kind="table", detail=""))

            # Columns
            for col_line in table_body.splitlines():
                stripped = col_line.strip().rstrip(",")
                if not stripped or _SQL_CONSTRAINT_START_RE.match(stripped):
                    continue
                col_m = _SQL_COLUMN_RE.match(stripped)
                if col_m:
                    col_name = _sql_clean_name(col_m.group(1))
                    col_type = col_m.group(2).strip()
                    data_items.append(DataItem(
                        name=col_name,
                        kind="column",
                        detail=col_type,
                    ))

            # Foreign key → parent table dependencies
            for fk_m in _SQL_FK_RE.finditer(table_body):
                parent = _sql_clean_name(fk_m.group(1))
                extra_deps.append(
                    (f"table_{table_name.lower()}", f"table_{parent.lower()}")
                )

        except Exception as e:
            logger.debug("SQL table extraction error in %s: %s", filename, e)

    return chunks, data_items, extra_deps

"""
utils/symbol_index.py — Deterministic extraction of a migrated unit's PUBLIC
target-language API surface (function/method signatures, exported types, and
module-level constants) from its generated code.

This is the server twin of client/lib/symbols.ts. It exists so a chunk being
migrated can be shown the REAL names/signatures of the units it already depends
on (the "ALREADY-MIGRATED TARGET API" prompt block), instead of guessing a name
that another chunk actually generated differently.

Recognition is deliberately conservative and line-oriented (Python additionally
uses `ast` when the snippet parses), mirroring utils' import-hoisting philosophy
in client/lib/imports.ts: anything we don't confidently recognise as a public
declaration is skipped rather than mis-reported. Never raises.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass, field


@dataclass
class ExportSurface:
    """The public surface one migrated unit exposes to the rest of the project."""

    functions: list[str] = field(default_factory=list)  # signature lines
    types: list[str] = field(default_factory=list)       # "class X", "type Y struct"
    constants: list[str] = field(default_factory=list)    # "NAME = value"

    def is_empty(self) -> bool:
        return not (self.functions or self.types or self.constants)

    def as_lines(self, indent: str = "    ") -> list[str]:
        out: list[str] = []
        for t in self.types:
            out.append(f"{indent}{t}")
        for f in self.functions:
            out.append(f"{indent}{f}")
        for c in self.constants:
            out.append(f"{indent}const {c}")
        return out


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MAX_SIG = 200
_MAX_ITEMS = 40  # cap per unit so one huge file can't blow the prompt budget


def _clean_signature(line: str) -> str:
    """A declaration head as a compact signature: drop the trailing body opener
    and any trailing punctuation, collapse whitespace, truncate."""
    sig = line.strip()
    # Cut everything from the body/opener onward.
    for stop in ("{",):
        idx = sig.find(stop)
        if idx != -1:
            sig = sig[:idx]
    sig = sig.rstrip(" \t:;")
    sig = re.sub(r"\s+", " ", sig)
    return sig[:_MAX_SIG].strip()


def _canon(language: str | None) -> str:
    return " ".join((language or "").strip().casefold().split())


# ---------------------------------------------------------------------------
# Python — AST-first, regex fallback
# ---------------------------------------------------------------------------

def _python_surface_ast(code: str) -> ExportSurface | None:
    try:
        tree = ast.parse(code)
    except (SyntaxError, ValueError):
        return None

    surface = ExportSurface()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name.startswith("_"):
                continue
            args = _python_args(node.args)
            ret = ""
            if node.returns is not None:
                try:
                    ret = f" -> {ast.unparse(node.returns)}"
                except Exception:  # pragma: no cover - unparse is best-effort
                    ret = ""
            prefix = "async def " if isinstance(node, ast.AsyncFunctionDef) else "def "
            surface.functions.append(_clean_signature(f"{prefix}{node.name}({args}){ret}"))
        elif isinstance(node, ast.ClassDef):
            if not node.name.startswith("_"):
                surface.types.append(f"class {node.name}")
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            for target in _assign_targets(node):
                if re.fullmatch(r"[A-Z][A-Z0-9_]*", target):
                    surface.constants.append(target)
    return surface


def _python_args(args: ast.arguments) -> str:
    parts: list[str] = []
    for a in list(args.posonlyargs) + list(args.args):
        parts.append(_python_arg(a))
    if args.vararg:
        parts.append(f"*{args.vararg.arg}")
    for a in args.kwonlyargs:
        parts.append(_python_arg(a))
    if args.kwarg:
        parts.append(f"**{args.kwarg.arg}")
    return ", ".join(parts)


def _python_arg(a: ast.arg) -> str:
    if a.annotation is not None:
        try:
            return f"{a.arg}: {ast.unparse(a.annotation)}"
        except Exception:  # pragma: no cover
            return a.arg
    return a.arg


def _assign_targets(node: ast.Assign | ast.AnnAssign) -> list[str]:
    names: list[str] = []
    targets = node.targets if isinstance(node, ast.Assign) else [node.target]
    for t in targets:
        if isinstance(t, ast.Name):
            names.append(t.id)
    return names


# ---------------------------------------------------------------------------
# Regex rule sets (per language). Each rule: (bucket, compiled-regex).
# Bucket is "functions" | "types" | "constants". Matched on trimmed lines.
# ---------------------------------------------------------------------------

_RULES: dict[str, list[tuple[str, re.Pattern[str]]]] = {
    "python": [
        ("functions", re.compile(r"^(?:async\s+)?def\s+(?!_)\w+\s*\(")),
        ("types", re.compile(r"^class\s+(?!_)\w+")),
        ("constants", re.compile(r"^([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=")),
    ],
    "java": [
        ("functions", re.compile(r"^(?:public|protected)\b.*\b\w+\s*\([^;]*\)\s*(?:throws[\w,\s.]*)?\{?\s*$")),
        ("types", re.compile(r"^(?:public|protected)\b.*\b(?:class|interface|enum|record)\s+\w+")),
        ("constants", re.compile(r"^(?:public|protected).*\bstatic\s+final\b.*\b(\w+)\s*=")),
    ],
    "c#": [
        ("functions", re.compile(r"^(?:public|protected|internal)\b.*\b\w+\s*\([^;]*\)\s*\{?\s*$")),
        ("types", re.compile(r"^(?:public|internal)\b.*\b(?:class|interface|enum|record|struct)\s+\w+")),
        ("constants", re.compile(r"^(?:public|internal).*\b(?:const|static\s+readonly)\b.*\b(\w+)\s*=")),
    ],
    "c++": [
        ("functions", re.compile(r"^[\w:<>,&*\s]+\s+\w+\s*\([^;]*\)\s*(?:const)?\s*\{?\s*$")),
        ("types", re.compile(r"^(?:class|struct|enum(?:\s+class)?)\s+\w+")),
        ("constants", re.compile(r"^(?:constexpr|const)\b.*\b(\w+)\s*=")),
    ],
    "rust": [
        ("functions", re.compile(r"^pub(?:\([^)]*\))?\s+(?:async\s+)?fn\s+\w+")),
        ("types", re.compile(r"^pub(?:\([^)]*\))?\s+(?:struct|enum|trait|type)\s+\w+")),
        ("constants", re.compile(r"^pub(?:\([^)]*\))?\s+(?:const|static)\s+(\w+)")),
    ],
    "go": [
        ("functions", re.compile(r"^func\s+(?:\([^)]*\)\s*)?[A-Z]\w*\s*\(")),
        ("types", re.compile(r"^type\s+[A-Z]\w*\b")),
        ("constants", re.compile(r"^(?:const|var)\s+([A-Z]\w*)\b")),
    ],
    "typescript": [
        ("functions", re.compile(r"^export\s+(?:async\s+)?function\s+\w+")),
        ("types", re.compile(r"^export\s+(?:default\s+)?(?:abstract\s+)?(?:class|interface|type|enum)\s+\w+")),
        ("constants", re.compile(r"^export\s+const\s+(\w+)")),
    ],
    "javascript": [
        ("functions", re.compile(r"^export\s+(?:async\s+)?function\s+\w+")),
        ("types", re.compile(r"^export\s+(?:default\s+)?class\s+\w+")),
        ("constants", re.compile(r"^export\s+const\s+(\w+)")),
    ],
    "sql": [
        ("types", re.compile(r"^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\w.\"`]+", re.IGNORECASE)),
        ("functions", re.compile(r"^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+[\w.\"`]+", re.IGNORECASE)),
    ],
}


def _regex_surface(code: str, canon: str) -> ExportSurface:
    rules = _RULES.get(canon)
    surface = ExportSurface()
    if not rules:
        return surface

    for raw in code.splitlines():
        line = raw.strip()
        if not line or line.startswith(("//", "#", "--", "*")):
            continue
        for bucket, pattern in rules:
            m = pattern.match(line)
            if not m:
                continue
            if bucket == "constants":
                # constants store just the name (group 1 when present, else the line head)
                name = m.group(1) if m.groups() else _clean_signature(line)
                surface.constants.append(name)
            elif bucket == "types":
                surface.types.append(_clean_signature(line))
            else:
                surface.functions.append(_clean_signature(line))
            break  # one bucket per line

    return surface


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def extract_exports(code: str, language: str) -> ExportSurface:
    """Best-effort public API surface of one migrated unit. Never raises."""
    if not code or not code.strip():
        return ExportSurface()

    canon = _canon(language)
    try:
        if canon == "python":
            surface = _python_surface_ast(code) or _regex_surface(code, canon)
        else:
            surface = _regex_surface(code, canon)
    except Exception:  # pragma: no cover - extraction must never break generation
        return ExportSurface()

    surface.functions = _dedupe(surface.functions)[:_MAX_ITEMS]
    surface.types = _dedupe(surface.types)[:_MAX_ITEMS]
    surface.constants = _dedupe(surface.constants)[:_MAX_ITEMS]
    return surface


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        key = item.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out

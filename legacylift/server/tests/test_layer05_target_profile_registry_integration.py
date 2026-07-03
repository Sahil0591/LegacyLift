"""
tests/test_layer05_target_profile_registry_integration.py

Verifies that Layer 0.5 profile building resolves project.target_language
through the target profile catalog instead of falling back to Python-shaped
runtime defaults for every target.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Add project root to path so imports work without `pip install -e .`
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.pipeline import TargetProfile, _build_target_profile
from models.project import Project, SourceLanguage


def _project(target_language: str) -> Project:
    return Project(
        name="Registry integration test",
        source_language=SourceLanguage.COBOL,
        target_language=target_language,
    )


@pytest.mark.asyncio
async def test_java_target_uses_registry_metadata_not_python_defaults():
    profile = await _build_target_profile(_project("Java"))
    payload = profile.to_dict()

    assert payload["language"] == "Java"
    assert "JUnit" in payload["test_framework"]
    assert "BigDecimal" in payload["type_system"] or "BigDecimal" in payload["notes"]
    assert "PEP 8" not in payload["style_guide"]
    assert "pytest" not in payload["test_framework"]


@pytest.mark.asyncio
async def test_csharp_target_uses_registry_metadata():
    profile = await _build_target_profile(_project("C#"))
    payload = profile.to_dict()

    assert payload["language"] == "C#"
    assert "xUnit" in payload["test_framework"] or "NUnit" in payload["test_framework"]
    assert (
        "nullable" in payload["type_system"].lower()
        or "types" in payload["type_system"].lower()
        or ".net" in payload["notes"].lower()
    )


@pytest.mark.asyncio
async def test_cpp_target_uses_registry_metadata():
    profile = await _build_target_profile(_project("C++23"))
    payload = profile.to_dict()
    combined = " ".join(
        [
            payload["style_guide"],
            payload["type_system"],
            payload["notes"],
        ]
    )

    assert payload["language"] == "C++"
    assert "GoogleTest" in payload["test_framework"] or "Catch2" in payload["test_framework"]
    assert any(
        term in combined
        for term in ("RAII", "latency", "trading", "risk")
    )


@pytest.mark.asyncio
async def test_rust_target_uses_registry_metadata():
    profile = await _build_target_profile(_project("Rust"))
    payload = profile.to_dict()
    combined = f"{payload['type_system']} {payload['notes']}"

    assert payload["language"] == "Rust"
    assert "cargo test" in payload["test_framework"]
    assert any(
        term in combined
        for term in ("ownership", "Result", "safety", "high-performance")
    )


@pytest.mark.asyncio
async def test_sql_target_uses_registry_metadata():
    profile = await _build_target_profile(_project("PL/SQL"))
    payload = profile.to_dict()
    combined = f"{payload['type_system']} {payload['notes']}"

    assert payload["language"] == "SQL"
    assert any(
        term.lower() in combined.lower()
        for term in ("transaction", "reconciliation", "audit", "stored procedures")
    ) or "DECIMAL" in combined


@pytest.mark.asyncio
async def test_python_alias_preserves_pair_gotchas():
    profile = await _build_target_profile(_project("Python 3.12"))
    payload = profile.to_dict()

    assert payload["language"] == "Python"
    assert "pytest" in payload["test_framework"]
    assert payload["deprecated_patterns"]
    assert payload["gotchas"]


@pytest.mark.asyncio
async def test_unknown_target_falls_back_to_python_catalog():
    profile = await _build_target_profile(_project("go-1.24"))
    payload = profile.to_dict()

    assert payload["language"] == "Python"
    assert "pytest" in payload["test_framework"]


@pytest.mark.asyncio
async def test_notes_include_migration_and_risk_sections():
    profile = await _build_target_profile(_project("Java"))
    payload = profile.to_dict()

    assert "Migration guidance" in payload["notes"]
    assert "Risk check focus" in payload["notes"]


def test_to_dict_schema_unchanged():
    payload = TargetProfile(
        language="Python",
        version="3.12",
        recommended_libraries=[],
        deprecated_patterns=[],
        gotchas=[],
    ).to_dict()

    assert set(payload) == {
        "language",
        "version",
        "recommended_libraries",
        "deprecated_patterns",
        "gotchas",
        "style_guide",
        "type_system",
        "async_model",
        "test_framework",
        "notes",
    }

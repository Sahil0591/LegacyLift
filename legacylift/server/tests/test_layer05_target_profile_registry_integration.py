"""
tests/test_layer05_target_profile_registry_integration.py

Verifies that Layer 0.5 profile building resolves project.target_language
through the target profile catalog instead of always using Python defaults.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.pipeline import _build_target_profile
from models.project import Project, SourceLanguage


def _project(target_language: str) -> Project:
    return Project(
        name="Registry integration test",
        source_language=SourceLanguage.COBOL,
        target_language=target_language,
    )


@pytest.mark.asyncio
async def test_python_target_uses_catalog_guidance_and_doc_version():
    profile = await _build_target_profile(_project("Python"))
    payload = profile.to_dict()

    assert payload["language"] == "Python"
    assert payload["version"] == "3.12"
    assert payload["test_framework"] == "pytest"
    assert "dataclasses" in payload["type_system"].lower() or "pydantic" in payload["type_system"].lower()
    assert "Decimal" in payload["notes"]
    assert "asyncio" in payload["async_model"]


@pytest.mark.asyncio
async def test_java_target_uses_catalog_not_python_defaults():
    profile = await _build_target_profile(_project("Java"))
    payload = profile.to_dict()

    assert payload["language"] == "Java"
    assert payload["version"] == "21 LTS with Java 25 readiness"
    assert payload["test_framework"] == "JUnit 5"
    assert "records" in payload["type_system"].lower() or "domain types" in payload["type_system"].lower()
    assert "BigDecimal" in payload["notes"]
    assert "pytest" not in payload["test_framework"]
    assert "PEP 8" not in payload["style_guide"]


@pytest.mark.asyncio
async def test_cpp_alias_resolves_to_catalog_profile():
    profile = await _build_target_profile(_project("C++23"))
    payload = profile.to_dict()

    assert payload["language"] == "C++"
    assert payload["test_framework"] == "GoogleTest or Catch2"
    assert "RAII" in payload["style_guide"]


@pytest.mark.asyncio
async def test_rust_target_uses_catalog_metadata():
    profile = await _build_target_profile(_project("Rust"))
    payload = profile.to_dict()

    assert payload["language"] == "Rust"
    assert payload["test_framework"] == "cargo test"
    assert "Result" in payload["type_system"]


@pytest.mark.asyncio
async def test_sql_target_uses_catalog_metadata():
    profile = await _build_target_profile(_project("PL/SQL"))
    payload = profile.to_dict()

    assert payload["language"] == "SQL"
    assert "tSQLt" in payload["test_framework"] or "utPLSQL" in payload["test_framework"]
    assert "DECIMAL" in payload["notes"] or "NUMERIC" in payload["notes"]


@pytest.mark.asyncio
async def test_unknown_target_language_falls_back_without_raising():
    profile = await _build_target_profile(_project("Go"))
    payload = profile.to_dict()

    assert payload["language"] == "Go"
    assert payload["test_framework"] == (
        "pytest with pytest-asyncio. One test per business rule. "
        "Use Decimal-aware assertions."
    )


@pytest.mark.asyncio
async def test_catalog_notes_include_migration_guidance():
    profile = await _build_target_profile(_project("Java 21"))
    payload = profile.to_dict()

    assert "BigDecimal" in payload["notes"] or "transaction" in payload["notes"].lower()
    assert payload["notes"]
    assert "COBOL fixed-format strings" not in payload["notes"]

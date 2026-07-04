"""
models/target_profile.py - Target language profile catalog models.

Target profiles describe governed generation targets and their rollout state.
They are consumed by Layer 0.5 registry code, API selectors, prompt builders,
and CI/static-validation fixtures.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class TargetProfileId(str, Enum):
    """Stable identifiers for supported target profile catalog entries."""

    PYTHON_3X = "python-3x"
    JAVA_21 = "java-21"
    CSHARP_DOTNET = "csharp-dotnet"
    CPP_23 = "cpp-23"
    RUST_2024 = "rust-2024"
    SQL_PLSQL = "sql-plsql"
    GO_1X = "go-1x"
    TYPESCRIPT_5X = "typescript-5x"


class TargetProfileStatus(str, Enum):
    """Readiness of a target profile in the LegacyLift backend."""

    ACTIVE = "active"
    ACTIVE_EXPERIMENTAL = "active_experimental"
    STUB = "stub"


# ---------------------------------------------------------------------------
# TargetProfileDefinition
# ---------------------------------------------------------------------------

class TargetProfileDefinition(BaseModel):
    """
    Enterprise target profile metadata for migration planning and governance.

    codegen_supported is only true for profiles with target-aware generation,
    static validation, and a CI smoke fixture.
    """

    id: TargetProfileId
    display_name: str
    language: str
    version: str
    tagline: str
    use_cases: tuple[str, ...] = Field(default_factory=tuple)
    runtime_description: str
    numeric_policy: str
    date_policy: str
    test_framework: str
    style_guide: str
    type_system_guidance: str
    async_concurrency_model: str
    migration_guidance: tuple[str, ...] = Field(default_factory=tuple)
    risk_check_focus: tuple[str, ...] = Field(default_factory=tuple)
    recommended_libraries: tuple[str, ...] = Field(default_factory=tuple)
    aliases: tuple[str, ...] = Field(default_factory=tuple)
    status: TargetProfileStatus
    codegen_supported: bool = False

    class Config:
        use_enum_values = True
        frozen = True

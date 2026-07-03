"""
models/target_profile.py - Target language profile catalog models.

Target profiles describe governed generation targets without claiming that
code generation is already wired for every language. They are consumed by
Layer 0.5 registry code and, in later PRs, can drive API selectors and
profile-aware prompts.
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


class TargetProfileStatus(str, Enum):
    """Readiness of a target profile in the LegacyLift backend."""

    ACTIVE = "active"
    STUB = "stub"


# ---------------------------------------------------------------------------
# TargetProfileDefinition
# ---------------------------------------------------------------------------

class TargetProfileDefinition(BaseModel):
    """
    Enterprise target profile metadata for migration planning and governance.

    PR1 intentionally stores catalog guidance only. codegen_supported remains
    false until the generation/review/test stack is explicitly wired for a
    profile.
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

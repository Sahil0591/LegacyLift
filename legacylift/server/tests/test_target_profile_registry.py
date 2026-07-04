"""
tests/test_target_profile_registry.py - Target profile catalog tests.

These tests keep the MVP target registry honest: targets marked codegen-capable
must have generation, static validation, and CI fixture coverage.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

# Add project root to path so imports work without `pip install -e .`
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.layer0_5.target_profile_registry import (
    TargetProfileNotFoundError,
    get_profile,
    list_profiles,
    resolve_profile,
)
from core.target_languages import TARGET_LANGUAGES as RUNTIME_TARGET_LANGUAGES
from models.target_profile import (
    TargetProfileDefinition,
    TargetProfileId,
    TargetProfileStatus,
)


REQUIRED_TEXT_FIELDS = (
    "display_name",
    "language",
    "version",
    "tagline",
    "runtime_description",
    "numeric_policy",
    "date_policy",
    "test_framework",
    "style_guide",
    "type_system_guidance",
    "async_concurrency_model",
)

REQUIRED_SEQUENCE_FIELDS = (
    "use_cases",
    "migration_guidance",
    "risk_check_focus",
    "recommended_libraries",
    "aliases",
)


CLIENT_TARGET_CATALOG = (
    Path(__file__).resolve().parents[2] / "client" / "lib" / "targetLanguages.ts"
)


def _id_value(value) -> str:
    return getattr(value, "value", str(value))


def _client_rollout_metadata() -> dict[str, tuple[str, bool]]:
    text = CLIENT_TARGET_CATALOG.read_text(encoding="utf-8")
    entries: dict[str, tuple[str, bool]] = {}
    for match in re.finditer(
        r'id:\s*"([^"]+)".*?status:\s*"([^"]+)".*?codegenSupported:\s*(true|false)',
        text,
        flags=re.DOTALL,
    ):
        entries[match.group(1)] = (match.group(2), match.group(3) == "true")
    return entries


def test_registry_contains_exactly_eight_profiles():
    assert len(list_profiles()) == 8


def test_all_profiles_validate_and_have_required_fields():
    for profile in list_profiles():
        validated = TargetProfileDefinition.model_validate(profile.model_dump())
        assert validated.id
        assert validated.status
        for field_name in REQUIRED_TEXT_FIELDS:
            assert getattr(validated, field_name)
        for field_name in REQUIRED_SEQUENCE_FIELDS:
            assert len(getattr(validated, field_name)) > 0
        assert isinstance(validated.codegen_supported, bool)


def test_python_profile_is_active():
    profile = get_profile(TargetProfileId.PYTHON_3X)

    assert profile.status == TargetProfileStatus.ACTIVE


def test_non_python_profiles_are_experimental_codegen_targets():
    for profile in list_profiles():
        if profile.id == TargetProfileId.PYTHON_3X:
            continue

        assert profile.status == TargetProfileStatus.ACTIVE_EXPERIMENTAL
        assert profile.codegen_supported is True


def test_all_profiles_are_mvp_codegen_supported():
    assert all(profile.codegen_supported is True for profile in list_profiles())


def test_resolve_by_id_works_for_java_21():
    profile = resolve_profile("java-21")

    assert profile.id == TargetProfileId.JAVA_21


@pytest.mark.parametrize("alias", ["Python", "python", "Python 3.12"])
def test_resolve_by_python_aliases(alias: str):
    profile = resolve_profile(alias)

    assert profile.id == TargetProfileId.PYTHON_3X


@pytest.mark.parametrize("alias", ["Java", "Java 21"])
def test_resolve_by_java_aliases(alias: str):
    profile = resolve_profile(alias)

    assert profile.id == TargetProfileId.JAVA_21


@pytest.mark.parametrize("alias", ["Go", "Golang", "go-1x"])
def test_resolve_by_go_aliases(alias: str):
    profile = resolve_profile(alias)

    assert profile.id == TargetProfileId.GO_1X


@pytest.mark.parametrize("alias", ["TypeScript", "TS", "typescript-5x"])
def test_resolve_by_typescript_aliases(alias: str):
    profile = resolve_profile(alias)

    assert profile.id == TargetProfileId.TYPESCRIPT_5X


def test_unknown_profile_raises_clear_error():
    with pytest.raises(TargetProfileNotFoundError, match="Target profile 'kotlin-2' was not found"):
        resolve_profile("kotlin-2")


def test_returned_profiles_cannot_mutate_canonical_registry():
    profile = get_profile(TargetProfileId.PYTHON_3X)

    with pytest.raises(ValidationError):
        profile.display_name = "Mutated"

    changed_copy = profile.model_copy(update={"display_name": "Mutated"})

    assert changed_copy.display_name == "Mutated"
    assert get_profile(TargetProfileId.PYTHON_3X).display_name == "Python 3.x"


def test_every_profile_has_at_least_one_use_case():
    assert all(len(profile.use_cases) > 0 for profile in list_profiles())


def test_display_name_and_tagline_do_not_frame_product_as_cobol_to_python_converter():
    banned_fragments = (
        "cobol-to-python",
        "cobol to python",
        "python converter",
        "converter",
    )

    for profile in list_profiles():
        text = f"{profile.display_name} {profile.tagline}".casefold()
        assert not any(fragment in text for fragment in banned_fragments)


def test_runtime_target_catalog_matches_registry_rollout_flags():
    registry = {_id_value(profile.id): profile for profile in list_profiles()}
    runtime = {target.id: target for target in RUNTIME_TARGET_LANGUAGES}

    assert set(runtime) == set(registry)
    for target_id, target in runtime.items():
        profile = registry[target_id]
        assert target.status == profile.status
        assert target.codegen_supported is profile.codegen_supported


def test_client_target_catalog_matches_registry_rollout_flags():
    registry = {
        _id_value(profile.id): (profile.status, profile.codegen_supported)
        for profile in list_profiles()
    }

    assert _client_rollout_metadata() == registry

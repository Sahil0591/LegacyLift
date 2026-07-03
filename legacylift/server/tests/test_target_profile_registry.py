"""
tests/test_target_profile_registry.py - Target profile catalog tests.

These tests keep PR1 honest: it is a registry/catalog addition only, with no
claim that non-Python generation is wired yet.
"""

from __future__ import annotations

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


def test_registry_contains_exactly_six_profiles():
    assert len(list_profiles()) == 6


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


def test_non_python_profiles_are_stub_and_codegen_not_supported():
    for profile in list_profiles():
        if profile.id == TargetProfileId.PYTHON_3X:
            continue

        assert profile.status == TargetProfileStatus.STUB
        assert profile.codegen_supported is False


def test_all_profiles_do_not_overclaim_codegen_support():
    assert all(profile.codegen_supported is False for profile in list_profiles())


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


def test_unknown_profile_raises_clear_error():
    with pytest.raises(TargetProfileNotFoundError, match="Target profile 'go-1.24' was not found"):
        resolve_profile("go-1.24")


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

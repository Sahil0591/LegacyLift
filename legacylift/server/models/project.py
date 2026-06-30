"""
models/project.py — Top-level project and uploaded-file data models.

A Project is the root entity that flows through the entire LegacyLift pipeline.
It carries identity, configuration, and the list of uploaded source files from
the moment the user hits POST /api/project all the way through schema validation.

Pipeline position: Created in api/main.py, passed to every pipeline stage in
core/pipeline.py as the shared context object.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class SourceLanguage(str, Enum):
    """Legacy source languages the pipeline can analyse."""
    COBOL = "COBOL"
    JAVA  = "Java"
    VB6   = "VB6"
    # TODO: add RPGLE, PL1, FORTRAN as the parser library grows


class ProjectStatus(str, Enum):
    """Lifecycle states of a migration project."""
    CREATED    = "created"       # Project exists, no files uploaded yet
    UPLOADING  = "uploading"     # Files being received
    ANALYSING  = "analysing"     # Layer 0 running
    READY      = "ready"         # Layer 0 complete, awaiting chunk selection
    MIGRATING  = "migrating"     # Layer 1-3 churning through chunks
    VALIDATING = "validating"    # Layer 4 schema check
    COMPLETE   = "complete"      # All chunks approved, report generated
    FAILED     = "failed"        # Unrecoverable error — check error_log


# ---------------------------------------------------------------------------
# UploadedFile
# ---------------------------------------------------------------------------

class UploadedFile(BaseModel):
    """
    Represents a single source file uploaded by the user.

    The raw bytes are stored on disk (or object storage in prod); this model
    holds the metadata and the decoded text content used by the pipeline.
    """

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    """Unique file identifier."""

    filename: str
    """Original filename as uploaded (e.g. 'interest_calc.cbl')."""

    language: SourceLanguage
    """Detected or declared source language."""

    content: str = ""
    """Full text content of the file decoded as UTF-8 (or EBCDIC converted)."""

    size_bytes: int = 0
    """File size in bytes — used for chunking decisions."""

    uploaded_at: datetime = Field(default_factory=datetime.utcnow)
    """UTC timestamp of when the file was received."""

    # TODO (Layer 0 — archaeologist.py): populate line_count after parsing
    line_count: int = 0

    # TODO (Layer 0 — dependency_mapper.py): populate detected_dependencies
    detected_dependencies: list[str] = Field(default_factory=list)
    """Names of other files/modules this file calls or references."""

    class Config:
        use_enum_values = True


# ---------------------------------------------------------------------------
# Project
# ---------------------------------------------------------------------------

class Project(BaseModel):
    """
    Root entity for a LegacyLift migration project.

    One project = one legacy codebase being migrated.  All pipeline stages
    receive the project and mutate its status and results in place (in a real
    implementation, these would be database writes via a repository layer).
    """

    id: str = Field(default_factory=lambda: f"proj-{uuid.uuid4().hex[:8]}")
    """Short unique ID, e.g. 'proj-a1b2c3d4'."""

    owner_id: str = ""
    """Clerk user ID of the user who created this project."""

    name: str
    """Human-readable project name, e.g. 'BankCore COBOL Migration'."""

    source_language: SourceLanguage = SourceLanguage.COBOL
    """Language of the uploaded legacy files."""

    target_language: str = "Python"
    """Destination language. Defaults to Python; future: Java, Go."""

    status: ProjectStatus = ProjectStatus.CREATED
    """Current lifecycle status — updated by pipeline.py at each stage."""

    created_at: datetime = Field(default_factory=datetime.utcnow)
    """UTC creation timestamp."""

    files: list[UploadedFile] = Field(default_factory=list)
    """All uploaded source files for this project."""

    # --- Layer 0 outputs (populated by core/layer0/) ---
    # TODO (archaeologist.py): fill business_rules after Layer 0
    business_rules: list[str] = Field(default_factory=list)
    """IDs of extracted BusinessRule objects stored separately."""

    # TODO (dependency_mapper.py): fill dependency_graph after Layer 0
    dependency_graph: dict = Field(default_factory=dict)
    """Adjacency map of module dependencies, e.g. {'A': ['B', 'C']}."""

    # TODO (risk_scorer.py): fill risk_scores after Layer 0
    risk_scores: dict[str, float] = Field(default_factory=dict)
    """Per-file risk score from 0.0 (safe) to 1.0 (very risky)."""

    # --- Layer 0.5 outputs (populated by core/layer0_5/) ---
    target_profile: Optional[dict] = None
    """Library/API compatibility profile for the target language version."""

    # --- Layer 0 outputs (populated by core/layer0/__init__.py) ---
    layer0_rules: list[dict] = Field(default_factory=list)
    """Serialized BusinessRule dicts from Layer 0 — served by GET /rules."""

    layer0_graph: dict = Field(default_factory=dict)
    """Serialized DependencyGraph dict (nodes + edges) — served by GET /graph."""

    # --- Pipeline timing and summary ---
    started_at: Optional[datetime] = None
    """UTC timestamp when the pipeline transitioned to 'analysing'."""

    completed_at: Optional[datetime] = None
    """UTC timestamp when the pipeline reached 'complete' or 'failed'."""

    chunk_count: int = 0
    """Number of migration chunks discovered by Layer 0."""

    risk_summary: dict = Field(default_factory=dict)
    """Aggregated risk level counts, e.g. {'Low': 3, 'Medium': 5, ...}."""

    needs_review_count: int = 0
    """Number of business rules flagged for human review."""

    # --- Upload tracking (populated by POST /project/{id}/upload) ---
    uploaded_files: dict = Field(default_factory=dict)
    """filename → content_string, populated on upload for quick lookup."""

    # --- Chunk approval state (populated by POST /project/{id}/approve|reject) ---
    chunk_approvals: dict = Field(default_factory=dict)
    """chunk_id → 'approved' | 'rejected', set by the approval endpoints."""

    # --- Chunk selection (Step 5 — populated by POST /select-chunk) ---
    selected_chunk_id: Optional[str] = None
    """ID of the Layer 0 chunk the human chose to migrate first."""

    current_migration: Optional[dict] = None
    """Serialised MigrationResult from core/migration/generator.py (latest run)."""

    # --- Layer 0 chunk storage (populated by run_pipeline after Layer 0) ---
    layer0_chunks: list[dict] = Field(default_factory=list)
    """
    Serialised Layer 0 MigrationChunk dicts (includes source code).
    Stored so the select-chunk endpoint can look up chunk source without
    re-parsing the uploaded files.
    """

    # --- Business rule confirmation (populated by POST /confirm-rule) ---
    chunk_rule_statuses: dict[str, str] = Field(default_factory=dict)
    """chunk_id → 'Pending' | 'Confirmed' — tracks human rule confirmation."""

    # --- Error tracking ---
    error: Optional[str] = None
    """Most recent unrecoverable pipeline error message."""

    error_log: list[str] = Field(default_factory=list)
    """Chronological list of error messages accumulated during the pipeline."""

    class Config:
        use_enum_values = True

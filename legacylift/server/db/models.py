from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=_utcnow,
        onupdate=_utcnow,
        nullable=False,
    )


class Repository(Base, TimestampMixin):
    __tablename__ = "repositories"
    __table_args__ = (
        UniqueConstraint("github_owner", "github_name", name="uq_repositories_github_identity"),
        Index("ix_repositories_github_identity", "github_owner", "github_name"),
        Index("ix_repositories_github_repository_id", "github_repository_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    github_repository_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    github_owner: Mapped[str] = mapped_column(String(255), nullable=False)
    github_name: Mapped[str] = mapped_column(String(255), nullable=False)
    html_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    default_branch: Mapped[str] = mapped_column(String(255), default="main", nullable=False)
    installation_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    commits: Mapped[list[Commit]] = relationship(back_populates="repository", cascade="all, delete-orphan")
    pull_requests: Mapped[list[PullRequest]] = relationship(back_populates="repository", cascade="all, delete-orphan")
    code_chunks: Mapped[list[CodeChunk]] = relationship(back_populates="repository", cascade="all, delete-orphan")
    ownership_groups: Mapped[list[OwnershipGroup]] = relationship(back_populates="repository")
    baseline_index_jobs: Mapped[list[BaselineIndexJob]] = relationship(
        back_populates="repository",
        cascade="all, delete-orphan",
    )


class Commit(Base):
    __tablename__ = "commits"
    __table_args__ = (
        UniqueConstraint("repository_id", "sha", "ref", name="uq_commits_repo_sha_ref"),
        Index("ix_commits_repo_ref", "repository_id", "ref"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    repository_id: Mapped[str] = mapped_column(ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False)
    sha: Mapped[str] = mapped_column(String(255), nullable=False)
    ref: Mapped[str] = mapped_column(String(255), default="main", nullable=False)
    indexed_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)

    repository: Mapped[Repository] = relationship(back_populates="commits")


class PullRequest(Base):
    __tablename__ = "pull_requests"
    __table_args__ = (
        UniqueConstraint("repository_id", "number", name="uq_pull_requests_repo_number"),
        Index("ix_pull_requests_repo_state", "repository_id", "state"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    repository_id: Mapped[str] = mapped_column(ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    base_sha: Mapped[str] = mapped_column(String(255), nullable=False)
    head_sha: Mapped[str] = mapped_column(String(255), nullable=False)
    state: Mapped[str] = mapped_column(String(50), default="open", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow, nullable=False)

    repository: Mapped[Repository] = relationship(back_populates="pull_requests")
    changed_files: Mapped[list[PullRequestChangedFile]] = relationship(
        back_populates="pull_request",
        cascade="all, delete-orphan",
    )


class CodeChunk(Base, TimestampMixin):
    __tablename__ = "code_chunks"
    __table_args__ = (
        UniqueConstraint(
            "repository_id",
            "commit_sha",
            "path",
            "start_line",
            "end_line",
            name="uq_code_chunks_identity",
        ),
        Index("ix_code_chunks_repo_ref_path", "repository_id", "commit_sha", "path"),
        Index("ix_code_chunks_line_lookup", "repository_id", "path", "start_line", "end_line"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    repository_id: Mapped[str] = mapped_column(ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False)
    commit_sha: Mapped[str] = mapped_column(String(255), nullable=False)
    path: Mapped[str] = mapped_column(String(1024), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    language: Mapped[str] = mapped_column(String(80), nullable=False)
    start_line: Mapped[int] = mapped_column(Integer, nullable=False)
    end_line: Mapped[int] = mapped_column(Integer, nullable=False)
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    source_excerpt: Mapped[str] = mapped_column(Text, nullable=False)

    repository: Mapped[Repository] = relationship(back_populates="code_chunks")
    decision_criteria: Mapped[list[DecisionCriterion]] = relationship(
        back_populates="code_chunk",
        cascade="all, delete-orphan",
    )
    hunk_matches: Mapped[list[PullRequestHunkMatch]] = relationship(
        back_populates="code_chunk",
        cascade="all, delete-orphan",
    )


class GitHubWebhookDelivery(Base, TimestampMixin):
    __tablename__ = "github_webhook_deliveries"
    __table_args__ = (
        UniqueConstraint("delivery_id", name="uq_github_webhook_deliveries_delivery_id"),
        Index("ix_github_webhook_deliveries_event", "event", "action"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    delivery_id: Mapped[str] = mapped_column(String(255), nullable=False)
    event: Mapped[str] = mapped_column(String(120), nullable=False)
    action: Mapped[str | None] = mapped_column(String(120), nullable=True)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="processing", nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class BaselineIndexJob(Base, TimestampMixin):
    __tablename__ = "baseline_index_jobs"
    __table_args__ = (
        Index("ix_baseline_index_jobs_repo_status", "repository_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    repository_id: Mapped[str] = mapped_column(ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False)
    ref: Mapped[str] = mapped_column(String(255), default="main", nullable=False)
    commit_sha: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="queued", nullable=False)
    reason: Mapped[str] = mapped_column(String(120), default="installation", nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    repository: Mapped[Repository] = relationship(back_populates="baseline_index_jobs")


class PullRequestChangedFile(Base, TimestampMixin):
    __tablename__ = "pull_request_changed_files"
    __table_args__ = (
        UniqueConstraint("pull_request_id", "path", name="uq_pr_changed_files_pr_path"),
        Index("ix_pr_changed_files_path", "path"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    pull_request_id: Mapped[str] = mapped_column(ForeignKey("pull_requests.id", ondelete="CASCADE"), nullable=False)
    path: Mapped[str] = mapped_column(String(1024), nullable=False)
    status: Mapped[str] = mapped_column(String(80), nullable=False)
    sha: Mapped[str | None] = mapped_column(String(255), nullable=True)
    additions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    deletions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    changes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    patch: Mapped[str] = mapped_column(Text, default="", nullable=False)
    previous_filename: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    pull_request: Mapped[PullRequest] = relationship(back_populates="changed_files")
    hunks: Mapped[list[PullRequestHunk]] = relationship(
        back_populates="changed_file",
        cascade="all, delete-orphan",
    )


class PullRequestHunk(Base, TimestampMixin):
    __tablename__ = "pull_request_hunks"
    __table_args__ = (
        UniqueConstraint("changed_file_id", "hunk_index", name="uq_pr_hunks_file_index"),
        Index("ix_pr_hunks_path_new_range", "path", "new_start_line", "new_end_line"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    changed_file_id: Mapped[str] = mapped_column(
        ForeignKey("pull_request_changed_files.id", ondelete="CASCADE"),
        nullable=False,
    )
    path: Mapped[str] = mapped_column(String(1024), nullable=False)
    hunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    header: Mapped[str] = mapped_column(String(512), nullable=False)
    old_start_line: Mapped[int] = mapped_column(Integer, nullable=False)
    old_end_line: Mapped[int] = mapped_column(Integer, nullable=False)
    new_start_line: Mapped[int] = mapped_column(Integer, nullable=False)
    new_end_line: Mapped[int] = mapped_column(Integer, nullable=False)
    patch: Mapped[str] = mapped_column(Text, nullable=False)

    changed_file: Mapped[PullRequestChangedFile] = relationship(back_populates="hunks")
    matches: Mapped[list[PullRequestHunkMatch]] = relationship(
        back_populates="hunk",
        cascade="all, delete-orphan",
    )


class PullRequestHunkMatch(Base, TimestampMixin):
    __tablename__ = "pull_request_hunk_matches"
    __table_args__ = (
        UniqueConstraint("hunk_id", "code_chunk_id", name="uq_pr_hunk_matches_hunk_chunk"),
        Index("ix_pr_hunk_matches_chunk", "code_chunk_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    hunk_id: Mapped[str] = mapped_column(ForeignKey("pull_request_hunks.id", ondelete="CASCADE"), nullable=False)
    code_chunk_id: Mapped[str] = mapped_column(ForeignKey("code_chunks.id", ondelete="CASCADE"), nullable=False)
    overlap_start_line: Mapped[int] = mapped_column(Integer, nullable=False)
    overlap_end_line: Mapped[int] = mapped_column(Integer, nullable=False)

    hunk: Mapped[PullRequestHunk] = relationship(back_populates="matches")
    code_chunk: Mapped[CodeChunk] = relationship(back_populates="hunk_matches")


class DecisionCriterion(Base, TimestampMixin):
    __tablename__ = "decision_criteria"
    __table_args__ = (
        UniqueConstraint("code_chunk_id", "summary", name="uq_decision_criteria_chunk_summary"),
        Index("ix_decision_criteria_chunk", "code_chunk_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    code_chunk_id: Mapped[str] = mapped_column(ForeignKey("code_chunks.id", ondelete="CASCADE"), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    hardcoded_values_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    evidence_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    code_chunk: Mapped[CodeChunk] = relationship(back_populates="decision_criteria")
    ownership_classifications: Mapped[list[OwnershipClassification]] = relationship(
        back_populates="decision_criterion",
        cascade="all, delete-orphan",
    )
    ownership_reviews: Mapped[list[OwnershipReview]] = relationship(
        back_populates="decision_criterion",
        cascade="all, delete-orphan",
    )
    change_guidance: Mapped[list[ChangeGuidance]] = relationship(
        back_populates="decision_criterion",
        cascade="all, delete-orphan",
    )


class OwnershipGroup(Base, TimestampMixin):
    __tablename__ = "ownership_groups"
    __table_args__ = (
        UniqueConstraint("repository_id", "name", name="uq_ownership_groups_repo_name"),
        Index("ix_ownership_groups_name", "name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    repository_id: Mapped[str | None] = mapped_column(
        ForeignKey("repositories.id", ondelete="CASCADE"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    aliases_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    color: Mapped[str] = mapped_column(String(32), default="#64748b", nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    repository: Mapped[Repository | None] = relationship(back_populates="ownership_groups")
    classifications: Mapped[list[OwnershipClassification]] = relationship(back_populates="owner_group")


class OwnershipClassification(Base):
    __tablename__ = "ownership_classifications"
    __table_args__ = (
        UniqueConstraint(
            "decision_criterion_id",
            "inferred_by",
            name="uq_ownership_classifications_criterion_inferred_by",
        ),
        Index("ix_ownership_classifications_owner", "owner_name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    decision_criterion_id: Mapped[str] = mapped_column(
        ForeignKey("decision_criteria.id", ondelete="CASCADE"),
        nullable=False,
    )
    owner_group_id: Mapped[str | None] = mapped_column(
        ForeignKey("ownership_groups.id", ondelete="SET NULL"),
        nullable=True,
    )
    owner_name: Mapped[str] = mapped_column(String(120), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    evidence: Mapped[str] = mapped_column(Text, default="", nullable=False)
    matched_signals_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    inferred_by: Mapped[str] = mapped_column(String(120), default="layer0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)

    decision_criterion: Mapped[DecisionCriterion] = relationship(back_populates="ownership_classifications")
    owner_group: Mapped[OwnershipGroup | None] = relationship(back_populates="classifications")


class OwnershipReview(Base, TimestampMixin):
    __tablename__ = "ownership_reviews"
    __table_args__ = (
        Index("ix_ownership_reviews_state", "review_state", "approval_state"),
        Index("ix_ownership_reviews_criterion_created", "decision_criterion_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    decision_criterion_id: Mapped[str] = mapped_column(
        ForeignKey("decision_criteria.id", ondelete="CASCADE"),
        nullable=False,
    )
    action: Mapped[str] = mapped_column(String(80), default="inferred", nullable=False)
    original_owner_name: Mapped[str] = mapped_column(String(120), nullable=False)
    current_owner_name: Mapped[str] = mapped_column(String(120), nullable=False)
    review_state: Mapped[str] = mapped_column(String(50), default="pending", nullable=False)
    approval_state: Mapped[str] = mapped_column(String(50), default="pending", nullable=False)
    reviewer_identity: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    decision_criterion: Mapped[DecisionCriterion] = relationship(back_populates="ownership_reviews")


class ChangeGuidance(Base, TimestampMixin):
    __tablename__ = "change_guidance"
    __table_args__ = (
        UniqueConstraint("decision_criterion_id", name="uq_change_guidance_criterion"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    decision_criterion_id: Mapped[str] = mapped_column(
        ForeignKey("decision_criteria.id", ondelete="CASCADE"),
        nullable=False,
    )
    risk_summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    primary_approval_group: Mapped[str] = mapped_column(String(120), default="Unknown", nullable=False)
    secondary_groups_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    approval_checklist_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    suggested_tests_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    suggested_message: Mapped[str] = mapped_column(Text, default="", nullable=False)
    merge_risk: Mapped[str] = mapped_column(String(50), default="unknown", nullable=False)

    decision_criterion: Mapped[DecisionCriterion] = relationship(back_populates="change_guidance")


class GitHubOverlayAnnotation(Base, TimestampMixin):
    __tablename__ = "github_overlay_annotations"
    __table_args__ = (
        Index("ix_overlay_annotations_repo_path", "repository_id", "path", "start_line", "end_line"),
        Index("ix_overlay_annotations_pr_status", "pull_request_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    repository_id: Mapped[str] = mapped_column(ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False)
    pull_request_id: Mapped[str | None] = mapped_column(
        ForeignKey("pull_requests.id", ondelete="CASCADE"),
        nullable=True,
    )
    decision_criterion_id: Mapped[str | None] = mapped_column(
        ForeignKey("decision_criteria.id", ondelete="SET NULL"),
        nullable=True,
    )
    path: Mapped[str] = mapped_column(String(1024), nullable=False)
    start_line: Mapped[int] = mapped_column(Integer, nullable=False)
    end_line: Mapped[int] = mapped_column(Integer, nullable=False)
    annotation_type: Mapped[str] = mapped_column(String(80), default="decision_criterion", nullable=False)
    title: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    message: Mapped[str] = mapped_column(Text, default="", nullable=False)
    severity: Mapped[str] = mapped_column(String(50), default="info", nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="active", nullable=False)

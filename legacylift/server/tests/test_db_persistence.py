from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio

from db.models import (
    Base,
    CodeChunk,
    DecisionCriterion,
    GitHubOverlayAnnotation,
    OwnershipClassification,
    OwnershipReview,
    Repository,
)
from db.repositories import (
    persist_layer0_analysis,
    seed_default_ownership_groups,
    upsert_code_chunk,
    upsert_commit,
    upsert_decision_criterion,
    upsert_ownership_classification,
    upsert_ownership_review,
    upsert_repository,
)
from db.session import (
    DEFAULT_DATABASE_URL,
    create_engine,
    get_database_url,
    init_db,
    session_factory,
)


@pytest_asyncio.fixture
async def db_session(tmp_path: Path):
    db_file = tmp_path / "legacylift-test.db"
    engine = create_engine(f"sqlite+aiosqlite:///{db_file}")
    await init_db(engine)
    async_session = session_factory(engine)

    async with async_session() as session:
        yield session
        await session.rollback()

    await engine.dispose()


def test_default_database_url_points_to_local_data_dir(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)

    assert get_database_url() == DEFAULT_DATABASE_URL
    assert DEFAULT_DATABASE_URL == "sqlite+aiosqlite:///./.data/legacylift.db"


@pytest.mark.asyncio
async def test_default_sqlite_url_creates_data_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    server_dir = tmp_path / "server"
    server_dir.mkdir()
    monkeypatch.chdir(server_dir)

    engine = create_engine(DEFAULT_DATABASE_URL)
    await init_db(engine)

    assert (server_dir / ".data").is_dir()
    assert (server_dir / ".data" / "legacylift.db").exists()

    await engine.dispose()


@pytest.mark.asyncio
async def test_orm_tables_can_be_created(db_session):
    repository = await upsert_repository(
        db_session,
        github_owner="legacy-bank",
        github_name="core-mainframe",
        default_branch="main",
        installation_id="12345",
    )
    await db_session.commit()

    assert repository.id
    assert repository.github_owner == "legacy-bank"
    assert repository.github_name == "core-mainframe"
    assert GitHubOverlayAnnotation.__tablename__ in Base.metadata.tables


@pytest.mark.asyncio
async def test_default_ownership_groups_are_seeded_idempotently(db_session):
    first = await seed_default_ownership_groups(db_session)
    second = await seed_default_ownership_groups(db_session)
    await db_session.commit()

    assert [group.name for group in first] == [group.name for group in second]
    assert {group.name for group in first} >= {"Finance", "Compliance", "Risk", "Ops", "Engineering", "Unknown"}


@pytest.mark.asyncio
async def test_repository_commit_chunk_and_decision_criterion_upserts_are_idempotent(db_session):
    repository = await upsert_repository(db_session, github_owner="legacy-bank", github_name="accounts")
    commit = await upsert_commit(db_session, repository_id=repository.id, sha="abc123", ref="refs/heads/main")

    first_chunk = await upsert_code_chunk(
        db_session,
        repository_id=repository.id,
        commit_sha=commit.sha,
        path="src/interest.cbl",
        name="CALC-INTEREST",
        language="cobol",
        start_line=10,
        end_line=24,
        source="MOVE 10000 TO WS-TIER1-LIMIT",
    )
    second_chunk = await upsert_code_chunk(
        db_session,
        repository_id=repository.id,
        commit_sha=commit.sha,
        path="src/interest.cbl",
        name="CALC-INTEREST",
        language="cobol",
        start_line=10,
        end_line=24,
        source="MOVE 10000 TO WS-TIER1-LIMIT",
    )

    criterion = await upsert_decision_criterion(
        db_session,
        code_chunk_id=first_chunk.id,
        summary="Tier-one balance limit controls the interest rate.",
        hardcoded_values=["10000"],
        evidence={"chunk_id": "interest__calc_interest"},
        confidence=0.92,
    )
    same_criterion = await upsert_decision_criterion(
        db_session,
        code_chunk_id=first_chunk.id,
        summary="Tier-one balance limit controls the interest rate.",
        hardcoded_values=["10000"],
        evidence={"chunk_id": "interest__calc_interest"},
        confidence=0.92,
    )
    await db_session.commit()

    assert second_chunk.id == first_chunk.id
    assert criterion.id == same_criterion.id


@pytest.mark.asyncio
async def test_persist_layer0_analysis_stores_chunks_rules_and_reviews_once(db_session):
    project = SimpleNamespace(id="proj-test123", name="Demo Upload")
    chunk = SimpleNamespace(
        id="interest__calc_interest",
        filename="interest.cbl",
        name="CALC-INTEREST",
        language="cobol",
        source="IF WS-BALANCE < 10000 MOVE 0.025 TO WS-RATE.",
        start_line=7,
        end_line=9,
    )
    rule = SimpleNamespace(
        chunk_id="interest__calc_interest",
        rule="Accounts below the tier-one balance threshold earn the tier-one rate.",
        confidence=0.95,
        owner="Finance",
        owner_reasoning="Interest-rate thresholds belong to Finance.",
        key_variables=["10000", "0.025"],
        needs_review=False,
    )

    first = await persist_layer0_analysis(db_session, project, [chunk], [rule])
    second = await persist_layer0_analysis(db_session, project, [chunk], [rule])
    await db_session.commit()

    assert first.chunk_count == 1
    assert first.criterion_count == 1
    assert second.chunk_count == 1
    assert second.criterion_count == 1

    repositories = (await db_session.execute(Repository.__table__.select())).all()
    chunks = (await db_session.execute(CodeChunk.__table__.select())).all()
    criteria = (await db_session.execute(DecisionCriterion.__table__.select())).all()
    classifications = (await db_session.execute(OwnershipClassification.__table__.select())).all()
    reviews = (await db_session.execute(OwnershipReview.__table__.select())).all()

    assert len(repositories) == 1
    assert len(chunks) == 1
    assert len(criteria) == 1
    assert len(classifications) == 1
    assert len(reviews) == 1


@pytest.mark.asyncio
async def test_ownership_classification_and_review_persist(db_session):
    repository = await upsert_repository(db_session, github_owner="legacy-bank", github_name="accounts")
    commit = await upsert_commit(db_session, repository_id=repository.id, sha="abc123", ref="main")
    chunk = await upsert_code_chunk(
        db_session,
        repository_id=repository.id,
        commit_sha=commit.sha,
        path="src/interest.cbl",
        name="CALC-INTEREST",
        language="cobol",
        start_line=1,
        end_line=3,
        source="MOVE 0.025 TO WS-RATE.",
    )
    criterion = await upsert_decision_criterion(
        db_session,
        code_chunk_id=chunk.id,
        summary="Tier-one rate is hardcoded.",
        hardcoded_values=["0.025"],
        evidence={"owner_reasoning": "rate threshold"},
        confidence=0.86,
    )

    classification = await upsert_ownership_classification(
        db_session,
        decision_criterion_id=criterion.id,
        owner_name="Finance",
        confidence=0.86,
        evidence="rate threshold",
        matched_signals=["rate", "interest"],
        inferred_by="layer0",
    )
    review = await upsert_ownership_review(
        db_session,
        decision_criterion_id=criterion.id,
        original_owner_name="Finance",
        current_owner_name="Finance",
        review_state="pending",
        approval_state="pending",
    )
    await db_session.commit()

    assert classification.owner_name == "Finance"
    assert review.current_owner_name == "Finance"


def test_local_sqlite_database_files_are_ignored():
    gitignore = Path(__file__).parents[2] / ".gitignore"

    ignored_patterns = gitignore.read_text().splitlines()

    assert "*.db" in ignored_patterns
    assert "*.sqlite" in ignored_patterns
    assert "server/.data/" in ignored_patterns

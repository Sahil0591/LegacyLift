from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from db.models import Base


DEFAULT_DATABASE_URL = "sqlite+aiosqlite:///./.data/legacylift.db"

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_database_url() -> str:
    return os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)


def _sqlite_path(database_url: str) -> Path | None:
    if not database_url.startswith("sqlite"):
        return None

    if database_url.endswith(":memory:"):
        return None

    try:
        path_part = database_url.split(":///", 1)[1]
    except IndexError:
        return None

    if path_part in ("", ":memory:"):
        return None

    if path_part.startswith("/"):
        return Path(path_part)
    return Path(path_part)


def ensure_sqlite_directory(database_url: str) -> None:
    db_path = _sqlite_path(database_url)
    if db_path is not None and db_path.parent != Path("."):
        db_path.parent.mkdir(parents=True, exist_ok=True)


def create_engine(database_url: str | None = None) -> AsyncEngine:
    url = database_url or get_database_url()
    ensure_sqlite_directory(url)

    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_async_engine(url, future=True, connect_args=connect_args)


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_engine()
    return _engine


def session_factory(engine: AsyncEngine | None = None) -> async_sessionmaker[AsyncSession]:
    if engine is not None:
        return async_sessionmaker(engine, expire_on_commit=False)

    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    return _session_factory


@asynccontextmanager
async def get_session(engine: AsyncEngine | None = None) -> AsyncIterator[AsyncSession]:
    factory = session_factory(engine)
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db(engine: AsyncEngine | None = None) -> None:
    target_engine = engine or get_engine()
    async with target_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

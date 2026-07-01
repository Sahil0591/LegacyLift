from __future__ import annotations

import os
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
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


_VALID_DATABASE_URL_PREFIXES = ("postgresql+asyncpg://", "postgresql://", "sqlite+aiosqlite://")


def validate_database_url(url: str) -> None:
    """Raise RuntimeError if url is missing or doesn't use a supported scheme."""
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Expected one of: " + ", ".join(_VALID_DATABASE_URL_PREFIXES)
        )
    if not url.startswith(_VALID_DATABASE_URL_PREFIXES):
        raise RuntimeError(
            f"DATABASE_URL has an unsupported scheme ({redact_database_url(url)!r}). "
            "Expected one of: " + ", ".join(_VALID_DATABASE_URL_PREFIXES)
        )


def redact_database_url(url: str) -> str:
    """Strip user:pass@ credentials before a DATABASE_URL is ever logged or printed."""
    return re.sub(r"://[^/@]+@", "://***@", url)


def create_engine(database_url: str | None = None) -> AsyncEngine:
    url = database_url or get_database_url()
    ensure_sqlite_directory(url)

    if url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
    elif url.startswith("postgresql"):
        # Neon's pooled (pgbouncer transaction-mode) connection string breaks
        # asyncpg's server-side prepared-statement cache. Disabling it is a
        # safe no-op against Neon's direct/non-pooled connection string too,
        # so apply it unconditionally for any postgresql URL.
        connect_args = {"statement_cache_size": 0}
    else:
        connect_args = {}
    return create_async_engine(url, future=True, connect_args=connect_args)


def _literal_sql(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int | float):
        return str(value)
    if isinstance(value, str):
        escaped = value.replace("'", "''")
        return f"'{escaped}'"
    return None


def _column_default_sql(column) -> str | None:
    default = column.default
    if default is None or default.is_callable or default.is_sequence:
        return None
    return _literal_sql(default.arg)


def _sqlite_repair_schema(connection: Connection) -> None:
    if connection.dialect.name != "sqlite":
        return

    inspector = inspect(connection)
    preparer = connection.dialect.identifier_preparer

    for table in Base.metadata.sorted_tables:
        if not inspector.has_table(table.name):
            continue

        existing_columns = {column["name"] for column in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in existing_columns or column.primary_key:
                continue

            column_type = column.type.compile(dialect=connection.dialect)
            default_sql = _column_default_sql(column)
            default_clause = f" DEFAULT {default_sql}" if default_sql is not None else ""
            nullable_clause = "" if column.nullable else " NOT NULL"
            if not column.nullable and default_sql is None:
                nullable_clause = ""

            table_name = preparer.quote(table.name)
            column_name = preparer.quote(column.name)
            connection.execute(
                text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}{default_clause}{nullable_clause}"),
            )


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
        await conn.run_sync(_sqlite_repair_schema)

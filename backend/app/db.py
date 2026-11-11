"""Async Postgres pool (psycopg 3). The backend connects with the table-owner role, so EVERY query below filters by the
verified user id; row-level security (sql/schema.sql) is the second, database-level line of defence."""
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Optional

from fastapi import HTTPException
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from .config import settings

pool: Optional[AsyncConnectionPool] = None


async def open_pool() -> None:
    global pool
    if settings.database_url and pool is None:
        # prepare_threshold=None keeps this compatible with Supabase's transaction pooler (pgbouncer)
        pool = AsyncConnectionPool(settings.database_url, min_size=1, max_size=8, open=False, kwargs={"row_factory": dict_row, "prepare_threshold": None})
        await pool.open(wait=False)


async def close_pool() -> None:
    global pool
    if pool is not None:
        await pool.close()
        pool = None


@asynccontextmanager
async def conn() -> AsyncIterator[Any]:
    if pool is None:
        raise HTTPException(503, "Accounts and saved data are not configured on this server (DATABASE_URL is missing).")
    try:
        async with pool.connection() as c:
            yield c
    except HTTPException:
        raise
    except Exception as e:  # connection refused, pool timeout, etc.
        if e.__class__.__module__.startswith("psycopg") and not e.__class__.__name__.endswith(("IntegrityError", "DataError")):
            raise HTTPException(503, "The database is temporarily unavailable. Please try again.") from e
        raise


async def fetch_all(sql: str, *args: Any) -> list[dict]:
    async with conn() as c:
        cur = await c.execute(sql, args)
        return await cur.fetchall()


async def fetch_one(sql: str, *args: Any) -> Optional[dict]:
    async with conn() as c:
        cur = await c.execute(sql, args)
        return await cur.fetchone()


async def execute(sql: str, *args: Any) -> None:
    async with conn() as c:
        await c.execute(sql, args)
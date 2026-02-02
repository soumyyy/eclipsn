"""
Phase 4 backfill: Run memory extraction for one or all users.
Usage:
  poetry run python -m src.jobs.memory_extraction_backfill --user-id <uuid>
  poetry run python -m src.jobs.memory_extraction_backfill --all  # all users with Gmail or bespoke data
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from ..services.database import get_pool
from ..services.memory_extraction import run_extraction_for_user

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


async def get_user_ids_with_data() -> list[str]:
    """Return user_ids that have gmail_threads or memory_chunks (so extraction is meaningful)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT user_id::text FROM (
                SELECT user_id FROM gmail_threads
                UNION
                SELECT user_id FROM memory_chunks
            ) u
            """
        )
    return [r["user_id"] for r in rows]


async def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 4 memory extraction backfill")
    parser.add_argument("--user-id", type=str, help="Run extraction for this user UUID only")
    parser.add_argument("--all", action="store_true", help="Run for all users with Gmail or bespoke data")
    parser.add_argument("--gmail-limit", type=int, default=500, help="Max Gmail threads per user")
    parser.add_argument("--bespoke-limit", type=int, default=200, help="Max bespoke chunks per user")
    args = parser.parse_args()
    if not args.user_id and not args.all:
        parser.error("Provide --user-id <uuid> or --all")
    if args.user_id and args.all:
        parser.error("Provide only one of --user-id or --all")
    user_ids: list[str] = []
    if args.user_id:
        user_ids = [args.user_id]
    else:
        user_ids = await get_user_ids_with_data()
        logger.info("Found %d users with Gmail or bespoke data", len(user_ids))
    total_inserted = 0
    for uid in user_ids:
        try:
            result = await run_extraction_for_user(
                uid,
                gmail_limit=args.gmail_limit,
                bespoke_limit=args.bespoke_limit,
            )
            total_inserted += result["inserted"]
            logger.info(
                "User %s: gmail=%d bespoke=%d inserted=%d skipped=%d",
                uid[:8],
                result["gmail_candidates"],
                result["bespoke_candidates"],
                result["inserted"],
                result["skipped"],
            )
        except Exception as e:  # noqa: BLE001
            logger.exception("Extraction failed for user %s: %s", uid, e)
    logger.info("Backfill done: %d memories inserted across %d users", total_inserted, len(user_ids))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

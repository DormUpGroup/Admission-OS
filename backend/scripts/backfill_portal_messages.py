import argparse
import asyncio
import json

from app.db.session import get_session_factory
from app.services.migrations.messages import backfill_portal_messages


async def run(*, apply: bool) -> None:
    async with get_session_factory()() as db:
        async with db.begin():
            result = await backfill_portal_messages(db)
            if not apply:
                await db.rollback()
        print(json.dumps({**result, "applied": apply}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Idempotently backfill portal NOTE activities into conversations"
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Commit changes; without this flag the transaction is rolled back",
    )
    args = parser.parse_args()
    asyncio.run(run(apply=args.apply))

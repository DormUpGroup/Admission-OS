from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.tables import automation_setting_table


async def automation_is_enabled(db: AsyncSession) -> bool:
    if not get_settings().automation_enabled:
        return False
    value = (
        await db.execute(
            select(automation_setting_table.c.valueJson).where(
                automation_setting_table.c.key == "global_enabled"
            )
        )
    ).scalar_one_or_none()
    if value is None:
        return False
    return bool(value.get("enabled")) if isinstance(value, dict) else False

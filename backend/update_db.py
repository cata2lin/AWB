import asyncio
from app.core.database import AsyncSessionLocal
from app.models.system_setting import SystemSetting
from sqlalchemy import select

async def update_settings():
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(SystemSetting).where(SystemSetting.key == "po.categories"))
        setting = result.scalar_one_or_none()
        if setting:
            categories = setting.value_json
            if categories is not None:
                if not any(c.get("key") == "packaging" for c in categories):
                    categories.insert(0, {"key": "packaging", "label": "📦 Packaging", "stores": [], "tom_enabled": True})
                    setting.value_json = categories.copy()
                    await session.commit()
                    print("Added packaging category to DB.")
                else:
                    print("Packaging category already in DB.")
            else:
                print("Categories json is None")
        else:
            print("po.categories not found in DB.")

if __name__ == "__main__":
    asyncio.run(update_settings())

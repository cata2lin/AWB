"""
Configurable order-exclusion rules — CRUD.

Mirrors Scripturi's profit_exclusion_rules management: admins add/remove `tag` and
`sku` rules that exclude matching orders from ALL analytics reports (on top of the
always-on built-in `test`/`sample` tags). Applied via app/core/order_filters.py.
"""

from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.order_filters import DEFAULT_EXCLUDED_TAGS
from app.models import Order
from app.models.exclusion_rule import ExclusionRule

router = APIRouter()


class ExclusionRuleIn(BaseModel):
    rule_type: str  # "tag" | "sku"
    value: str
    reason: Optional[str] = None


@router.get("/analytics/exclusion-rules")
async def list_exclusion_rules(db: AsyncSession = Depends(get_db)):
    """All configurable rules + the always-on built-in tags (read-only)."""
    rows = (
        (
            await db.execute(
                select(ExclusionRule).order_by(ExclusionRule.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return {
        "builtin_tags": list(DEFAULT_EXCLUDED_TAGS),
        "rules": [
            {
                "id": r.id,
                "rule_type": r.rule_type,
                "value": r.value,
                "reason": r.reason,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


@router.post("/analytics/exclusion-rules")
async def add_exclusion_rule(
    payload: ExclusionRuleIn, db: AsyncSession = Depends(get_db)
):
    rule_type = (payload.rule_type or "").strip().lower()
    value = (payload.value or "").strip()
    if rule_type not in ("tag", "sku"):
        raise HTTPException(400, detail="rule_type must be 'tag' or 'sku'")
    if not value:
        raise HTTPException(400, detail="value is required")

    # Reject duplicates (case-insensitive on value within the same type).
    existing = (
        await db.execute(
            select(ExclusionRule).where(
                ExclusionRule.rule_type == rule_type,
                func.lower(ExclusionRule.value) == value.lower(),
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(409, detail="Rule already exists")

    rule = ExclusionRule(
        rule_type=rule_type,
        value=value,
        reason=(payload.reason or "").strip() or None,
        created_at=datetime.utcnow(),
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return {"id": rule.id, "rule_type": rule.rule_type, "value": rule.value}


@router.delete("/analytics/exclusion-rules/{rule_id}")
async def delete_exclusion_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    rule = await db.get(ExclusionRule, rule_id)
    if not rule:
        raise HTTPException(404, detail="Rule not found")
    await db.delete(rule)
    await db.commit()
    return {"deleted": rule_id}


@router.get("/analytics/exclusion-rules/preview")
async def preview_excluded_orders(db: AsyncSession = Depends(get_db)):
    """How many orders each TAG rule currently matches (sanity check before relying
    on it). NULL-tag orders are never matched. SKU rules aren't previewed here (they
    apply in-loop in the P&L reports)."""
    from sqlalchemy import cast, Text

    rows = (
        (
            await db.execute(
                select(ExclusionRule).where(ExclusionRule.rule_type == "tag")
            )
        )
        .scalars()
        .all()
    )
    tags = list(DEFAULT_EXCLUDED_TAGS) + [r.value for r in rows]
    out = []
    for t in tags:
        tl = str(t).strip().lower()
        if not tl:
            continue
        n = (
            await db.execute(
                select(func.count(Order.id)).where(
                    Order.tags.isnot(None),
                    cast(Order.tags, Text).ilike(f'%"{tl}"%'),
                )
            )
        ).scalar() or 0
        out.append({"tag": tl, "matched_orders": int(n)})
    return {"tags": out}

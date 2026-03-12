"""
Geographic analytics endpoint — order distribution by country and city.
"""
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import Order

router = APIRouter()


@router.get("/geographic")
async def get_geographic_stats(
    store_uids: Optional[str] = None,
    days: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get order distribution by country and region.
    Returns counts grouped by country_code from shipping_address.
    """
    # Parse store_uids if provided (comma-separated)
    store_uid_list = None
    if store_uids:
        store_uid_list = [s.strip() for s in store_uids.split(',')]
    
    # Build conditions
    conditions = []
    if store_uid_list:
        conditions.append(Order.store_uid.in_(store_uid_list))
    if date_from and date_to:
        conditions.append(Order.frisbo_created_at >= datetime.strptime(date_from, '%Y-%m-%d'))
        conditions.append(Order.frisbo_created_at <= datetime.strptime(date_to, '%Y-%m-%d').replace(hour=23, minute=59, second=59))
    elif days:
        cutoff = datetime.utcnow() - timedelta(days=days)
        conditions.append(Order.frisbo_created_at >= cutoff)
    
    # Query all orders with shipping addresses
    query = select(Order.shipping_address, Order.store_uid)
    if conditions:
        query = query.where(and_(*conditions))
    
    result = await db.execute(query)
    rows = result.all()
    
    # Aggregate into country -> cities structure
    countries = {}
    for row in rows:
        addr = row.shipping_address or {}
        if not isinstance(addr, dict):
            continue
            
        country_code = addr.get('country_code', 'UNKNOWN') or 'UNKNOWN'
        country_name = addr.get('country', country_code) or country_code
        city = addr.get('city', 'Unknown') or 'Unknown'
        province = addr.get('province', '') or ''
        postal_code = addr.get('zip', '') or addr.get('postal_code', '') or ''
        
        if country_code not in countries:
            countries[country_code] = {
                'code': country_code,
                'name': country_name,
                'count': 0,
                'cities': {}
            }
        
        countries[country_code]['count'] += 1
        
        # Add city data with postal code
        if city not in countries[country_code]['cities']:
            countries[country_code]['cities'][city] = {
                'name': city,
                'province': province,
                'postal_code': postal_code,  # Use first postal code found
                'count': 0
            }
        countries[country_code]['cities'][city]['count'] += 1
    
    # Convert to sorted list
    country_list = []
    for code, data in countries.items():
        cities_list = sorted(
            data['cities'].values(),
            key=lambda x: x['count'],
            reverse=True
        )
        country_list.append({
            'code': data['code'],
            'name': data['name'],
            'count': data['count'],
            'cities': cities_list[:100]  # Top 100 cities for better map coverage
        })
    
    country_list.sort(key=lambda x: x['count'], reverse=True)
    
    return {
        'countries': country_list,
        'total_orders': sum(c['count'] for c in country_list)
    }

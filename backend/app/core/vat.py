"""
VAT (TVA) rate resolution — per country, time-aware.

Single source of truth for "what VAT rate applies to this order?". Used by the
profitability, per-order and SKU-profitability reports so a Bulgarian or Polish
order is no longer taxed at the Romanian rate.

Rules:
- Romania raised its standard VAT from 19% to 21% on 2025-08-01, so RO orders
  created BEFORE that date use 19%. (This time-split is RO-specific and correct.)
- Foreign stores use their own country's standard rate from
  ProfitabilityConfig.vat_rates (CZ 21%, PL 23%, BG 20%). These have been stable,
  so no time-split is applied to them.
- Unknown country falls back to the RO rate.
"""

from datetime import date as _date
from typing import Mapping, Optional

# Romania's 19% -> 21% standard-VAT increase.
RO_VAT_INCREASE_DATE = _date(2025, 8, 1)
RO_VAT_BEFORE_INCREASE = 0.19

# Standard rates by ISO country code. Overridable via ProfitabilityConfig.vat_rates.
DEFAULT_VAT_RATES = {"RO": 0.21, "CZ": 0.21, "PL": 0.23, "BG": 0.20, "HU": 0.27}

_CURRENCY_TO_COUNTRY = {
    "RON": "RO",
    "BGN": "BG",
    "CZK": "CZ",
    "PLN": "PL",
    "HUF": "HU",
}
_TLD_TO_COUNTRY = (
    (".bg", "BG"),
    (".cz", "CZ"),
    (".pl", "PL"),
    (".hu", "HU"),
    (".ro", "RO"),
)


def resolve_vat_rate(
    country: Optional[str],
    order_date: Optional[_date] = None,
    vat_rates: Optional[Mapping[str, float]] = None,
) -> float:
    """Return the VAT rate (e.g. 0.21) for a country + order date."""
    rates = dict(DEFAULT_VAT_RATES)
    if vat_rates:
        rates.update({str(k).upper(): v for k, v in vat_rates.items() if v is not None})
    c = (country or "RO").upper()
    if c == "RO":
        if order_date is not None and order_date < RO_VAT_INCREASE_DATE:
            return RO_VAT_BEFORE_INCREASE
        return rates.get("RO", 0.21)
    return rates.get(c, rates.get("RO", 0.21))


def country_for_store(
    name: Optional[str] = None,
    domain: Optional[str] = None,
    currency: Optional[str] = None,
) -> str:
    """Best-effort ISO country code for a store from its domain/name TLD, then currency.

    AWB store names are domain-like (esteban.ro, grandia.ro, bonhaus.bg), so the
    TLD is the most reliable signal; currency is a fallback (EUR is ambiguous and
    intentionally maps to nothing, leaving the TLD or RO default to win)."""
    text = f"{name or ''} {domain or ''}".lower()
    for tld, cc in _TLD_TO_COUNTRY:
        if tld in text:
            return cc
    return _CURRENCY_TO_COUNTRY.get((currency or "").upper(), "RO")

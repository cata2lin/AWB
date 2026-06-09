"""DB-free tests for per-country, time-aware VAT resolution (audit Finding H/U)."""

from datetime import date

from app.core.vat import resolve_vat_rate, country_for_store, DEFAULT_VAT_RATES


def test_romania_time_split():
    # Before the 2025-08-01 increase RO is 19%, after it is 21%.
    assert resolve_vat_rate("RO", date(2025, 7, 31)) == 0.19
    assert resolve_vat_rate("RO", date(2025, 8, 1)) == 0.21
    assert resolve_vat_rate("RO", date(2026, 6, 1)) == 0.21


def test_foreign_countries_use_own_rate_no_time_split():
    # Foreign rates are stable — same before and after the RO cutoff.
    for d in (date(2025, 7, 31), date(2026, 6, 1)):
        assert resolve_vat_rate("PL", d) == 0.23
        assert resolve_vat_rate("BG", d) == 0.20
        assert resolve_vat_rate("CZ", d) == 0.21


def test_unknown_country_falls_back_to_ro():
    assert resolve_vat_rate("XX", date(2026, 6, 1)) == 0.21
    assert resolve_vat_rate(None, date(2026, 6, 1)) == 0.21


def test_config_override():
    custom = {"PL": 0.20, "RO": 0.22}
    assert resolve_vat_rate("PL", date(2026, 6, 1), custom) == 0.20
    assert resolve_vat_rate("RO", date(2026, 6, 1), custom) == 0.22
    # RO time-split still applies regardless of the configured post-cutoff rate.
    assert resolve_vat_rate("RO", date(2025, 1, 1), custom) == 0.19


def test_country_for_store_by_tld():
    assert country_for_store("bonhaus.bg") == "BG"
    assert country_for_store("bonhaus.cz") == "CZ"
    assert country_for_store("bonhaus.pl") == "PL"
    assert country_for_store("nocturna.bg") == "BG"
    assert country_for_store("esteban.ro") == "RO"
    assert country_for_store("grandia.ro") == "RO"


def test_country_for_store_tld_beats_currency():
    # A .bg store billing in EUR is still Bulgaria.
    assert country_for_store("bonhaus.bg", currency="EUR") == "BG"


def test_country_for_store_currency_fallback():
    assert country_for_store("somestore", currency="PLN") == "PL"
    assert country_for_store("somestore", currency="BGN") == "BG"
    assert (
        country_for_store("somestore", currency="EUR") == "RO"
    )  # ambiguous -> default
    assert country_for_store("somestore") == "RO"


def test_default_rates_match_scripturi_reference():
    assert DEFAULT_VAT_RATES["RO"] == 0.21
    assert DEFAULT_VAT_RATES["CZ"] == 0.21
    assert DEFAULT_VAT_RATES["PL"] == 0.23
    assert DEFAULT_VAT_RATES["BG"] == 0.20

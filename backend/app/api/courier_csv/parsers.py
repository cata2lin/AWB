"""
Courier CSV parsers — column detection, transform functions, and courier presets.

Edit THIS file to add new courier presets, column mappings, or value transforms.
"""
import csv
import io
import re
from typing import Optional, Callable


# Common CSV column name mappings for different couriers
COLUMN_MAPPINGS = {
    'awb': ['awb', 'awb_number', 'nr_awb', 'tracking', 'tracking_number',
            'numar_awb', 'cod_awb', 'nr. awb', 'nr.awb',
            'expediere', 'barcode',  # DPD, Packeta (EN)
            'cod de bare', 'cod_de_bare',  # Packeta (RO)
            '\u2116'],  # Speedy (№ symbol)
    'package_count': ['colete', 'nr_colete', 'package_count', 'packages',
                      'numar_colete', 'nr colete', 'nr. colete',
                      'nr. trimiteri',  # Sameday
                      'numar colete',   # DPD
                      'numarul de trimitere', 'numarul_de_trimitere',  # Packeta (RO)
                      'units'],          # Speedy
    'weight': ['greutate', 'weight', 'kg', 'greutate_kg', 'greutate (kg)',
               'greutate reala', 'greutate_reala'],
    'transport_cost': ['pret', 'cost', 'transport', 'pret_transport',
                       'cost_transport', 'price', 'valoare', 'suma',
                       'cost total', 'cost_total', 'total',
                       'packet price',  # Packeta (EN)
                       'pretul coletelor', 'pretul_coletelor'],  # Packeta (RO)
    # --- NEW column mapping groups ---
    'order_ref': ['ref 1', 'ref1', 'referinta', 'referinta_1',
                  'order', 'order_number', 'order number',
                  'comanda', 'nr_comanda'],
    'awb_type': ['tip', 'type', 'tip expediere', 'tip_expediere'],
    'original_awb': ['expediere primara', 'expediere_primara',
                     'return delivery', 'retur'],
    'cost_fara_tva': ['total fara tva', 'total_fara_tva', 'net', 'suma neta', 'suma_neta'],
    'cost_tva': ['total vat', 'total_vat', 'tva', 'vat'],
    'cost_currency': ['total|valuta', 'valuta', 'currency', 'moneda de schimb', 'moneda_de_schimb'],
    'content': ['continut', 'content', 'description', 'descriere'],
    'status': ['status', 'state name', 'stare', 'stare curenta'],
}


# ─────────────────────────────────────────────────────────────────────────────
# Courier-Specific Transform Functions
# ─────────────────────────────────────────────────────────────────────────────

def _packeta_awb_transform(raw: str) -> str:
    """Packeta Barcode: 'Z 339 6206 623, 523000014357211118863331' → 'Z3396206623'"""
    if not raw:
        return raw
    first_part = raw.split(',')[0].strip()
    return first_part.replace(' ', '')


def _speedy_cost_transform(raw: str) -> Optional[float]:
    """Speedy price: '"18.11 leu"' → 18.11"""
    if not raw:
        return None
    cleaned = raw.strip().strip('"').strip()
    # Remove currency suffix (leu, лв, etc.)
    cleaned = re.sub(r'\s*(leu|лв|lei|bgn|ron)\s*$', '', cleaned, flags=re.IGNORECASE).strip()
    try:
        return float(cleaned.replace(',', '.'))
    except (ValueError, TypeError):
        return None


def _speedy_order_ref_from_description(raw: str) -> Optional[str]:
    """
    Extract order reference from Speedy 'description' field.
    e.g. 'BONBG19552 / 1 x set-5-lavete-m...' → 'BONBG19552'
    e.g. 'Otkazana pratka, vyrnata s pratka 1055070820385; BONBG19552 / ...' → 'BONBG19552'
    """
    if not raw:
        return None
    # Look for known order reference patterns (brand prefix + digits)
    # Patterns: EST12345, GRAND1886, PL18160, BONBG19552, ROSSI1234, etc.
    match = re.search(r'\b([A-Z]{2,10}\d{3,6})\b', raw)
    if match:
        return match.group(1)
    return None


def _dpd_order_ref_from_content(raw: str) -> Optional[str]:
    """
    Extract order reference from DPD 'Continut' field as fallback.
    e.g. 'EST101078 / 1 X 90 | 1 X 87...' → 'EST101078'
    """
    if not raw:
        return None
    match = re.search(r'\b([A-Z]{2,10}\d{3,6})\b', raw)
    if match:
        return match.group(1)
    return None


def _dpd_awb_type_transform(raw: str) -> str:
    """DPD Tip: 'Normal' → 'outbound', 'Retur' → 'return'"""
    if not raw:
        return 'outbound'
    val = raw.strip().lower()
    if 'retur' in val or 'return' in val:
        return 'return'
    return 'outbound'


# ─────────────────────────────────────────────────────────────────────────────
# Courier Presets — Enhanced with order_ref, awb_type, cost breakdown columns
# ─────────────────────────────────────────────────────────────────────────────

COURIER_PRESETS = {
    'sameday': {
        'encoding': 'utf-8-sig',
        'delimiter': ',',
        'columns': {
            'awb': 'AWB',
            'cost': 'Cost',
            'packages': 'Nr. trimiteri',
            'weight': None,
            # NEW: Sameday has 'Tip expediere' for outbound/return
            'awb_type': 'Tip expediere',
            'order_ref': None,       # No dedicated order ref column
            'cost_fara_tva': None,
            'cost_tva': None,
            'cost_currency': None,
            'original_awb': None,
            'content': 'Observatii',  # Notes may contain order ref
            'status': 'Status',      # "Expedierea a fost înregistrată."
        },
        'awb_transform': None,
        'cost_transform': None,
        'order_ref_transform': None,
        'awb_type_transform': None,
        # Fingerprint: unique headers that identify this as Sameday export
        'fingerprint': ['AWB', 'Tip expediere', 'Nr. trimiteri'],
    },
    'packeta': {
        'encoding': 'utf-8-sig',
        'delimiter': ';',
        'columns': {
            # Support both EN and RO headers — preset names try first,
            # then COLUMN_MAPPINGS aliases are checked as fallback
            'awb': 'Cod de bare',            # RO; EN fallback: 'Barcode' via COLUMN_MAPPINGS
            'cost': 'pretul coletelor',      # RO; EN fallback: 'Packet price' via COLUMN_MAPPINGS
            'packages': None,
            'weight': None,
            'order_ref': 'Comanda',          # RO; EN fallback: 'Order' via COLUMN_MAPPINGS
            'awb_type': None,
            'cost_fara_tva': None,
            'cost_tva': None,
            'cost_currency': 'Moneda de schimb',  # RO currency column
            'original_awb': None,
            'content': None,
            'status': 'Status',              # "Așteptăm predarea coletului"
        },
        'awb_transform': _packeta_awb_transform,
        'cost_transform': None,
        'order_ref_transform': None,
        'awb_type_transform': None,
        # Additional columns specific to Packeta
        'extra_columns': {
            'sender': 'Expeditor',   # RO; Brand name (bonhaus.pl, bonhaus.cz, etc.)
        },
        # Fingerprint: unique headers that identify this as Packeta
        # Supports both RO ('Cod de bare', 'Numărul de trimitere') and EN ('Barcode', 'Submission number')
        'fingerprint': ['Cod de bare', 'Numărul de trimitere'],
        'fingerprint_alt': ['Barcode', 'Submission number'],
    },
    'speedy': {
        'encoding': 'utf-16',
        'delimiter': '\t',
        'columns': {
            'awb': None,     # Special: column with № symbol, resolved by index
            'cost': 'price',
            'packages': 'Units',
            'weight': 'weight',
            # NEW: Speedy order ref columns
            'order_ref': 'order number',  # col 49 — may be empty
            'awb_type': 'return delivery',  # col 2
            'cost_fara_tva': None,
            'cost_tva': None,
            'cost_currency': None,
            'original_awb': None,
            'content': 'description',   # col 46 — contains order ref (BONBG19552 / ...)
            'status': 'status',          # col 1 — numeric code
        },
        'awb_transform': None,
        'cost_transform': _speedy_cost_transform,
        'order_ref_transform': None,  # Will use _speedy_order_ref_from_description as fallback
        'awb_type_transform': None,
        'awb_column_index': 6,  # The № column is always at index 6
        # Fingerprint: unique headers that identify this as Speedy
        'fingerprint': ['№', 'Digital statement'],
    },
    'dpd': {
        'encoding': 'utf-8-sig',
        'delimiter': ',',
        'columns': {
            'awb': 'Expediere',
            'cost': 'Total',                       # cu TVA (existing)
            'packages': 'Numar colete',
            'weight': 'Greutate',
            # NEW: DPD-specific columns
            'order_ref': 'Ref 1',                  # Order reference (EST101078)
            'awb_type': 'Tip',                     # Normal / Retur
            'original_awb': 'Expediere primara',   # For returns: original AWB
            'cost_fara_tva': 'Total fara TVA',     # Net cost (without VAT)
            'cost_tva': 'Total VAT',               # VAT amount
            'cost_currency': 'Total|Valuta',       # Currency (RON)
            'content': 'Continut',                 # Fallback for order ref
            'status': 'State Name',                # "9 - Returnat", "4 - Livrat"
        },
        'awb_transform': None,
        'cost_transform': None,
        'order_ref_transform': None,
        'awb_type_transform': _dpd_awb_type_transform,
        # Fingerprint: unique headers that identify this as DPD
        'fingerprint': ['Expediere', 'Tarifar|Id'],
    },
}


def find_column(headers: list, field: str) -> Optional[int]:
    """Find the index of a column by matching against known aliases."""
    aliases = COLUMN_MAPPINGS.get(field, [])
    for i, header in enumerate(headers):
        h = header.strip().lower().replace(' ', '_')
        if h in aliases:
            return i
        # Also check without underscore normalization
        h_raw = header.strip().lower()
        if h_raw in aliases:
            return i
    return None


def find_column_by_name(headers: list, name: str) -> Optional[int]:
    """Find column index by exact name (case-insensitive)."""
    for i, h in enumerate(headers):
        if h.strip().lower() == name.strip().lower():
            return i
    return None


def detect_csv_params(text_sample: str):
    """Detect delimiter and headers from the first few lines."""
    first_line = text_sample.split('\n')[0]
    if '\t' in first_line:
        delimiter = '\t'
    elif ';' in first_line:
        delimiter = ';'
    else:
        delimiter = ','

    reader = csv.reader(io.StringIO(text_sample), delimiter=delimiter)
    try:
        headers = next(reader)
    except StopIteration:
        return delimiter, []

    return delimiter, headers


def detect_courier_from_headers(headers: list, delimiter: str = ',',
                                  encoding: str = 'utf-8-sig') -> Optional[str]:
    """
    Auto-detect courier type by matching CSV headers against preset fingerprints.
    
    Returns the preset key ('dpd', 'sameday', 'packeta', 'speedy') or None.
    Matching is done by checking if ALL fingerprint headers exist in the CSV headers.
    """
    headers_lower = [h.strip().lower() for h in headers]
    
    # Check each preset's fingerprint (and optional alternate fingerprint)
    for preset_key, preset in COURIER_PRESETS.items():
        for fp_key in ('fingerprint', 'fingerprint_alt'):
            fingerprint = preset.get(fp_key, [])
            if not fingerprint:
                continue
            
            # All fingerprint headers must be present (case-insensitive)
            if all(
                any(fp.lower() == hl for hl in headers_lower)
                for fp in fingerprint
            ):
                return preset_key
    
    return None


def parse_row_data(row: list, awb_idx: int, pkg_idx, wgt_idx, cost_idx,
                   awb_transform: Optional[Callable] = None,
                   cost_transform: Optional[Callable] = None,
                   # --- NEW optional indices ---
                   order_ref_idx: Optional[int] = None,
                   awb_type_idx: Optional[int] = None,
                   original_awb_idx: Optional[int] = None,
                   cost_fara_tva_idx: Optional[int] = None,
                   cost_tva_idx: Optional[int] = None,
                   cost_currency_idx: Optional[int] = None,
                   content_idx: Optional[int] = None,
                   status_idx: Optional[int] = None,
                   # Transform functions
                   order_ref_transform: Optional[Callable] = None,
                   awb_type_transform: Optional[Callable] = None,
                   courier_key: Optional[str] = None,
                   ) -> tuple:
    """
    Extract AWB and shipping data from a single CSV row.
    Returns (awb, data_dict) or (None, None).
    
    data_dict now includes additional fields:
    - order_ref: Order reference number (for multi-AWB matching)
    - awb_type: 'outbound' or 'return'
    - original_awb: For returns, the original outbound AWB
    - transport_cost_fara_tva: Net cost without VAT (DPD)
    - transport_cost_tva: VAT amount (DPD)
    - currency: Cost currency
    """
    if len(row) <= awb_idx:
        return None, None

    awb = row[awb_idx].strip()
    if not awb:
        return None, None

    # Apply AWB transform (e.g. Packeta barcode extraction)
    if awb_transform:
        awb = awb_transform(awb)
        if not awb:
            return None, None

    data = {}
    
    # --- Existing fields ---
    if pkg_idx is not None and len(row) > pkg_idx:
        try:
            val = row[pkg_idx].strip().replace(',', '.')
            if val:
                data['package_count'] = int(float(val))
        except (ValueError, IndexError):
            pass

    if wgt_idx is not None and len(row) > wgt_idx:
        try:
            val = row[wgt_idx].strip().replace(',', '.')
            if val:
                data['package_weight'] = float(val)
        except (ValueError, IndexError):
            pass

    if cost_idx is not None and len(row) > cost_idx:
        raw_cost = row[cost_idx].strip()
        if raw_cost:
            if cost_transform:
                parsed = cost_transform(raw_cost)
                if parsed is not None:
                    data['transport_cost'] = parsed
            else:
                try:
                    val = raw_cost.replace(',', '.')
                    data['transport_cost'] = float(val)
                except (ValueError, IndexError):
                    pass

    # --- NEW fields ---
    
    # Order reference
    if order_ref_idx is not None and len(row) > order_ref_idx:
        ref = row[order_ref_idx].strip()
        if ref:
            if order_ref_transform:
                ref = order_ref_transform(ref)
            data['order_ref'] = ref
    
    # Fallback: extract order ref from content/description field
    if not data.get('order_ref') and content_idx is not None and len(row) > content_idx:
        content = row[content_idx].strip()
        if content:
            if courier_key == 'speedy':
                extracted = _speedy_order_ref_from_description(content)
            elif courier_key == 'dpd':
                extracted = _dpd_order_ref_from_content(content)
            else:
                extracted = None
            if extracted:
                data['order_ref'] = extracted
    
    # AWB type (outbound/return)
    if awb_type_idx is not None and len(row) > awb_type_idx:
        raw_type = row[awb_type_idx].strip()
        if awb_type_transform:
            data['awb_type'] = awb_type_transform(raw_type)
        elif raw_type:
            val = raw_type.lower()
            if 'retur' in val or 'return' in val:
                data['awb_type'] = 'return'
            else:
                data['awb_type'] = 'outbound'
    
    # Original AWB (for returns)
    if original_awb_idx is not None and len(row) > original_awb_idx:
        orig = row[original_awb_idx].strip()
        if orig and orig != '-':
            data['original_awb'] = orig
    
    # Cost without VAT (DPD)
    if cost_fara_tva_idx is not None and len(row) > cost_fara_tva_idx:
        try:
            val = row[cost_fara_tva_idx].strip().replace(',', '.')
            if val:
                data['transport_cost_fara_tva'] = float(val)
        except (ValueError, IndexError):
            pass
    
    # VAT amount (DPD)
    if cost_tva_idx is not None and len(row) > cost_tva_idx:
        try:
            val = row[cost_tva_idx].strip().replace(',', '.')
            if val:
                data['transport_cost_tva'] = float(val)
        except (ValueError, IndexError):
            pass
    
    # Cost currency
    if cost_currency_idx is not None and len(row) > cost_currency_idx:
        curr = row[cost_currency_idx].strip()
        if curr:
            data['currency'] = curr.upper()

    # CSV status (for debug/audit — last delivery status from courier)
    if status_idx is not None and len(row) > status_idx:
        status_val = row[status_idx].strip()
        if status_val:
            data['csv_status'] = status_val[:255]

    return awb, data

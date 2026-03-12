"""
SKU Risk computation helpers — outcome mapping, normalization, and constants.

Edit THIS file to change outcome classification logic, risk weights,
or anomaly detection thresholds.
"""
import math
from typing import List

# ---------------------------------------------------------------------------
# Constants — Final outcome mapping from workflow/shipment/fulfillment statuses
# ---------------------------------------------------------------------------

DELIVERED_WORKFLOW = {"delivered"}
BACK_TO_SENDER_WORKFLOW = {"back_to_sender", "returning_to_sender"}
BACK_TO_SENDER_SHIPMENT = {"received_by_sender", "returning_to_sender"}
CANCELLED_WORKFLOW = {"cancelled"}
CANCELLED_SHIPMENT = {"canceled"}
REFUSED_WORKFLOW = {"refused"}
REFUSED_SHIPMENT = {"refused"}
DELIVERY_PROBLEM_WORKFLOW = {"unsuccessful_delivery", "incorrect_address", "redirected", "on_hold"}
DELIVERY_PROBLEM_SHIPMENT = {"unsuccessful_delivery", "incorrect_address", "redirected"}
NOT_SHIPPED_WORKFLOW = {"waiting_for_courier"}
NOT_SHIPPED_SHIPMENT = {"created_awb", "not_created"}
NOT_SHIPPED_FULFILLMENT = {"not_fulfilled", "partial"}

# Problem outcomes for SKU risk
PROBLEM_OUTCOMES = {"BACK_TO_SENDER", "CANCELLED", "REFUSED"}

# Shipping anomaly defaults
DEFAULT_SHIPPING_COST_PCT_THRESHOLD = 0.25
DEFAULT_Z_SCORE_THRESHOLD = 2.0

# Risk score weights
RISK_WEIGHT_PROBLEM_RATE = 0.45
RISK_WEIGHT_CONTAMINATION = 0.25
RISK_WEIGHT_SHIPPING_ANOMALY = 0.20
RISK_WEIGHT_DELIVERY_PROBLEM = 0.10


def compute_final_outcome(workflow: str, shipment: str, fulfillment: str) -> str:
    """Map 3 status fields to a single final_outcome."""
    ws = (workflow or "").lower().strip()
    ss = (shipment or "").lower().strip()
    fs = (fulfillment or "").lower().strip()

    if ws in DELIVERED_WORKFLOW:
        return "DELIVERED"
    if ws in BACK_TO_SENDER_WORKFLOW or ss in BACK_TO_SENDER_SHIPMENT:
        return "BACK_TO_SENDER"
    if ws in CANCELLED_WORKFLOW or ss in CANCELLED_SHIPMENT:
        return "CANCELLED"
    if ws in REFUSED_WORKFLOW or ss in REFUSED_SHIPMENT:
        return "REFUSED"
    if ws in DELIVERY_PROBLEM_WORKFLOW or ss in DELIVERY_PROBLEM_SHIPMENT:
        return "DELIVERY_PROBLEM"
    if ws in NOT_SHIPPED_WORKFLOW or ss in NOT_SHIPPED_SHIPMENT or fs in NOT_SHIPPED_FULFILLMENT:
        return "NOT_SHIPPED_OR_PENDING"
    return "OTHER"


def safe_div(a, b):
    """Safe division returning 0 on zero/None denominator."""
    if not b:
        return 0.0
    return a / b


def normalize_min_max(values: List[float]) -> List[float]:
    """Min-max normalize a list of values to [0, 1]. Safe for constants."""
    if not values:
        return []
    mn = min(values)
    mx = max(values)
    rng = mx - mn
    if rng == 0:
        return [0.5] * len(values)
    return [(v - mn) / rng for v in values]

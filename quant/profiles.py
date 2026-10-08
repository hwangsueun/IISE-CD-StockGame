"""Predeclared research profiles; prediction, trading and refitting clocks are separate."""
from copy import deepcopy

PROFILES = {
    "daily_open": {
        "model_version": "model-v3-open",
        "schema_version": 3,
        "strategy": "topk_dropout",
        "execution": "next_market_open",
        "top_k": 10,
        "n_drop": 1,
        "rebalance_turns": 1,
        "label_horizon": {"unit": "market_sessions", "value": 1},
        "label_price": "open",
        "benchmark_column": "open",
        "retrain_months": 6,
        "label": "next market open to following market open, minus matching KOSPI open-to-open return",
    },
    "daily_topk_dropout": {
        "model_version": "model-v2-daily",
        "schema_version": 2,
        "strategy": "topk_dropout",
        "top_k": 10,
        "n_drop": 1,
        "rebalance_turns": 1,
        "label_horizon": {"unit": "market_sessions", "value": 1},
        "retrain_months": 6,
        "label": "next market close to following market close, minus matching KOSPI return",
    },
    "legacy_120": {
        "model_version": "model-v1",
        "schema_version": 1,
        "strategy": "equal_weight_rebalance",
        "top_k": 10,
        "rebalance_turns": 120,
        "label_horizon": {"unit": "weekdays", "value": 120},
        "retrain_months": 6,
        "label": "next close to first market close at/after entry+120 weekdays, minus matching KOSPI return",
    },
}


def get_profile(name="daily_open"):
    return deepcopy(PROFILES[name])

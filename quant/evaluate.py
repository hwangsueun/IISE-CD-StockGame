"""Export a frozen 2022-2023 test for the SAME JS execution/replay engine.

There is no Alpha+Momentum implementation in this checkout. A transparent
60-market-day momentum control is supplied instead, and is named accordingly.
"""
import argparse
import json
from pathlib import Path
import lightgbm as lgb
import pandas as pd
from prepare import write_json


def export(data, model_version="model-v3-open"):
    data = Path(data)
    model_dir = data / model_version
    artifact = json.loads((model_dir / "signals.json").read_text())
    model_meta = next(m for m in artifact["models"] if m["id"] == "lgb-20220101")
    daily = pd.read_csv(data / "quant_daily.csv", dtype={"code": str}, parse_dates=["date"])
    features = pd.read_parquet(model_dir / "features.parquet")
    frozen_model = lgb.Booster(model_file=str(model_dir / "lgb-20220101.txt"))
    features = features[features.index.get_level_values("datetime") >= "2022-01-01"]
    pred = pd.Series(frozen_model.predict(features), index=features.index)
    prices = daily.pivot(index="date", columns="asset_id", values="close")
    momentum = prices / prices.shift(60) - 1
    strategies = {k: {**artifact, "models": [model_meta], "sessions": {}, "top_k": daily.asset_id.nunique() if k == "equal_weight" else artifact["top_k"]}
                  for k in ["frozen_alpha158", "momentum60", "equal_weight"]}
    # V3 allocates equal cash initially and retains incumbents; v2 rebalanced daily.
    strategies["equal_weight"]["strategy"] = "equal_weight_initial" if artifact["schema_version"] == 3 else "equal_weight_rebalance"
    for execution_date, original in artifact["sessions"].items():
        signal_day = pd.Timestamp(original["signal_date"])
        if signal_day < pd.Timestamp("2022-01-01"):
            continue
        # Same currently observable, >=60-bar eligible universe for all controls.
        symbols = [r[0] for r in original["ranking"]]
        for strategy, item in strategies.items():
            ranking = []
            for symbol in symbols:
                if strategy == "frozen_alpha158":
                    score = pred.loc[(signal_day, symbol)]
                elif strategy == "momentum60":
                    score = momentum.loc[signal_day, symbol]
                else:
                    score = 0
                if pd.notna(score):
                    ranking.append([symbol, float(score), float(prices.loc[signal_day, symbol])])
            ranking.sort(key=lambda r: (-r[1], r[0]))
            item["sessions"][execution_date] = {"signal_date": str(signal_day.date()), "model_id": model_meta["id"], "ranking": ranking}
    start = min(strategies["frozen_alpha158"]["sessions"])
    end = daily.date.max().strftime("%Y-%m-%d")
    turns = [{"turn_number": i + 1, "trade_date": str(day.date())} for i, day in enumerate(pd.bdate_range(start, end))]
    coverage = pd.read_csv(data / "instruments.csv")
    assets = [{"asset_id": r.asset_id, "masked_name": r.asset_id, "is_active": True,
               "listed_from": r.observed_from, "listed_to": r.observed_to} for r in coverage.itertuples()]
    price_rows = daily[daily.date >= pd.Timestamp(start) - pd.Timedelta(days=10)]
    price_rows = [{"asset_id": r.asset_id, "trade_date": str(r.date.date()), "close_price": r.close,
                   "open_price": None if pd.isna(r.open) else float(r.open)} for r in price_rows.itertuples()]
    write_json(model_dir / "backtest_input.json", {"turns": turns, "prices": price_rows, "assets": assets, "strategies": strategies,
                                                  "initialCash": 50_000_000, "totalTurns": len(turns)})
    return model_dir


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--model-version", default="model-v3-open")
    args = parser.parse_args()
    print(export(args.data, args.model_version))

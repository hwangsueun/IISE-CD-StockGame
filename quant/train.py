"""Official Qlib Alpha158 + LightGBM; daily excess-return labels by default.

Feature definitions are supplied by the pinned official Alpha158 handler. Model
parameters and K are fixed before evaluation. Deployment uses historical model
vintages, never a model trained after the simulated decision date.
"""
import argparse
import importlib.metadata
import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
import qlib
from qlib.contrib.data.handler import Alpha158

from prepare import ROOT, digest, write_json
from profiles import PROFILES, get_profile

PARAMS = dict(objective="regression", metric="l2", learning_rate=.04, num_leaves=31,
              min_data_in_leaf=100, feature_fraction=.9, lambda_l2=5,
              num_threads=4, seed=42, deterministic=True, force_col_wise=True, verbosity=-1)
TOP_K = 10
MAX_ROUNDS = 120


def label_schedule(calendar, horizon=None):
    """Decision after t close; enter next open-market day's close.

    Default timing matches Ref($close,-2)/Ref($close,-1)-1. The archived
    120-weekday experiment remains explicitly selectable, including holidays.
    """
    days = pd.DatetimeIndex(calendar)
    horizon = horizon or get_profile()["label_horizon"]
    if horizon["unit"] not in ("market_sessions", "weekdays") or horizon["value"] < 1:
        raise ValueError("Invalid label horizon")
    records = []
    for i, day in enumerate(days[:-1]):
        entry = days[i + 1]
        exit_idx = (i + 1 + horizon["value"] if horizon["unit"] == "market_sessions" else
                    days.searchsorted(entry + pd.offsets.BDay(horizon["value"])))
        records.append((day, entry, days[exit_idx] if exit_idx < len(days) else pd.NaT))
    return pd.DataFrame(records, columns=["datetime", "entry", "exit"]).set_index("datetime")


def make_labels(daily, benchmark, horizon=None, price_field="close"):
    prices = daily.pivot(index="date", columns="asset_id", values=price_field)
    tradable = daily.pivot(index="date", columns="asset_id", values="tradable").fillna(False)
    schedule = label_schedule(prices.index, horizon)
    records = []
    for day, timing in schedule.iterrows():
        entry, end = timing.entry, timing.exit
        if pd.isna(end) or entry not in benchmark.index or end not in benchmark.index:
            continue
        b0, b1 = benchmark.loc[entry], benchmark.loc[end]
        if not np.isfinite(b0) or not np.isfinite(b1) or b0 <= 0 or b1 <= 0:
            continue
        returns = prices.loc[end] / prices.loc[entry] - 1
        eligible = tradable.loc[entry] & tradable.loc[day]
        if price_field == "open":
            eligible &= (prices.loc[entry] > 0) & (prices.loc[end] > 0)
        for symbol, ret in returns[eligible].dropna().items():
            records.append((day, symbol, entry, end, ret, b1 / b0 - 1, ret - (b1 / b0 - 1)))
    return pd.DataFrame(records, columns=["datetime", "instrument", "entry", "exit", "return",
                                         "benchmark_return", "label"]).set_index(["datetime", "instrument"])


def purged_split(labels, cutoff):
    mature = labels[labels.exit < cutoff]
    dates = mature.index.get_level_values("datetime").unique().sort_values()
    if len(dates) < 60:
        return mature, mature.iloc[:0]
    valid_start = dates[-40]
    train = mature[mature.exit < valid_start]
    valid = mature[mature.index.get_level_values("datetime") >= valid_start]
    if len(train) < 500 or train.index.get_level_values("datetime").nunique() < 20:
        return mature, mature.iloc[:0]
    assert train.exit.max() < valid.index.get_level_values("datetime").min()
    return train, valid


def signal_metrics(predictions, labels, horizon):
    frame = labels.join(predictions.rename("score"), how="inner").dropna(subset=["score", "label"])
    rows = []
    for day, group in frame.groupby(level="datetime"):
        if len(group) < TOP_K * 2 or group.score.nunique() < 2:
            continue
        ordered = group.sort_values("score", ascending=False)
        rows.append({"date": day.strftime("%Y-%m-%d"), "n": len(group),
                     "ic": float(group.score.corr(group.label)),
                     "rank_ic": float(group.score.corr(group.label, method="spearman")),
                     "top_excess": float(ordered.head(TOP_K).label.mean()),
                     "bottom_excess": float(ordered.tail(TOP_K).label.mean()),
                     "equal_weight_excess": float(group.label.mean())})
    result = pd.DataFrame(rows)
    if result.empty:
        return {"dates": 0}, result
    std = result.rank_ic.std(ddof=1)
    return {"dates": len(result), "mean_ic": float(result.ic.mean()),
            "mean_rank_ic": float(result.rank_ic.mean()),
            "rank_icir_unannualized": float(result.rank_ic.mean() / std) if std > 0 else None,
            "top_minus_bottom": float((result.top_excess - result.bottom_excess).mean()),
            "label_horizon": horizon,
            "note": "Gross signal diagnostics only; serial dependence is possible. Multi-session labels overlap."}, result


def train(args):
    profile = get_profile(args.profile)
    model_version = args.model_version or profile["model_version"]
    if Path(model_version).name != model_version or model_version in (".", ".."):
        raise ValueError("Model version must be a folder name")
    prepared = Path(args.data).resolve()
    manifest = json.loads((prepared / "manifest.json").read_text())
    for name, sha in manifest["files"].items():
        if digest(prepared / name) != sha:
            raise ValueError(f"Prepared data hash mismatch: {name}")
    if (args.profile in ("daily_topk_dropout", "daily_open") and
            manifest.get("price_basis", "").startswith("unadjusted") and not args.allow_unadjusted_research):
        raise ValueError("Daily model needs consistent adjusted game OHLC/VWAP data. "
                         "Use --allow-unadjusted-research only for a separately named raw-price diagnostic.")
    out = prepared / model_version
    out.mkdir(exist_ok=True)
    if (out / "signals.json").exists():
        raise ValueError(f"Immutable {model_version} already exists; choose a new --model-version")
    daily = pd.read_csv(prepared / "quant_daily.csv", dtype={"code": str}, parse_dates=["date"])
    qlib.init(provider_uri=str(prepared / "qlib"), region="cn", kernels=4,
              expression_cache=None, dataset_cache=None)
    features_path = out / "features.parquet"
    if features_path.exists():
        features = pd.read_parquet(features_path)
    else:
        # Official handler, including its default label for the smoke audit only.
        handler = Alpha158(instruments="all", start_time=manifest["from"], end_time=manifest["to"],
                           infer_processors=[], learn_processors=[])
        raw = handler.fetch(col_set=["feature", "label"])
        features = raw["feature"].replace([np.inf, -np.inf], np.nan).sort_index()
        default_label = raw["label"].iloc[:, 0]
        write_json(out / "official_workflow_smoke.json", {
            "feature_count": features.shape[1], "rows": len(features),
            "default_label_nonmissing": int(default_label.notna().sum()),
            "default_label_used_for_training": False})
        if features.shape[1] != 158:
            raise ValueError(f"Expected official 158 features, got {features.shape[1]}")
        features.to_parquet(features_path)
    # Require historical bars only, without conditioning on future survival.
    daily = daily.sort_values(["asset_id", "date"])
    daily["history"] = daily.groupby("asset_id").cumcount() + 1
    eligible = daily[(daily.history >= 60) & daily.tradable].set_index(["date", "asset_id"]).index
    eligible.names = ["datetime", "instrument"]
    features = features.loc[features.index.intersection(eligible)].sort_index()
    default_benchmark = (Path(__file__).resolve().parents[1] / "data/quant/research-inputs/kospi-open-2013-2023.csv"
                         if profile.get("label_price") == "open" else
                         ROOT / "data-pipeline/market_indicator/data/processed/macro_context_daily.csv")
    benchmark_path = Path(args.benchmark or default_benchmark).resolve()
    benchmark = pd.read_csv(benchmark_path, parse_dates=["date"]).set_index("date")[profile.get("benchmark_column", "kospi")]
    if benchmark.index.duplicated().any():
        raise ValueError("Duplicate benchmark date")
    labels = make_labels(daily, benchmark, profile["label_horizon"], profile.get("label_price", "close"))
    labels = labels.loc[labels.index.intersection(features.index)].sort_index()
    labels.to_parquet(out / "labels.parquet")
    spec = {**profile, "model_version": model_version, "profile": args.profile,
            "parameters": PARAMS, "rounds": MAX_ROUNDS,
            "feature": "qlib.contrib.data.handler.Alpha158", "features": list(features.columns),
            "preprocessing": "no fitted scaler; inf->NaN; LightGBM native missing values; >=60 past bars",
            "test": "2022-2023 frozen historical diagnostic; this period was inspected for v1 and is not a fresh holdout for v2",
            "versions": {m: importlib.metadata.version(m) for m in ["pyqlib", "lightgbm", "numpy", "pandas"]},
            "benchmark_path": str(benchmark_path), "benchmark_sha256": digest(benchmark_path), "data_version": manifest["version"],
            "price_basis": manifest["price_basis"]}
    write_json(out / "spec.json", spec)
    scores = []
    models = []
    feature_dates = features.index.get_level_values("datetime")
    cutoffs = pd.date_range("2014-01-01", "2024-01-01", freq=f"{profile['retrain_months']}MS")
    frozen_predictions = None
    for cutoff, next_cutoff in zip(cutoffs[:-1], cutoffs[1:]):
        fit_labels, validation = purged_split(labels, cutoff)
        mature = labels[labels.exit < cutoff]
        if len(mature) < 500:
            continue
        x = features.loc[fit_labels.index]
        ds = lgb.Dataset(x, label=fit_labels.label)
        rounds = MAX_ROUNDS
        if len(validation):
            trial = lgb.train(PARAMS, ds, num_boost_round=MAX_ROUNDS,
                              valid_sets=[lgb.Dataset(features.loc[validation.index], label=validation.label)],
                              callbacks=[lgb.early_stopping(20, verbose=False)])
            rounds = trial.best_iteration
        model = lgb.train(PARAMS, lgb.Dataset(features.loc[mature.index], label=mature.label), num_boost_round=rounds)
        model_id = cutoff.strftime("lgb-%Y%m%d")
        model.save_model(str(out / f"{model_id}.txt"))
        xpred = features[(feature_dates >= cutoff) & (feature_dates < next_cutoff)]
        prediction = pd.Series(model.predict(xpred), index=xpred.index, name="score")
        part = prediction.to_frame()
        part["model_id"] = model_id
        scores.append(part)
        models.append({"id": model_id, "available_from": cutoff.strftime("%Y-%m-%d"),
                       "trained_through": mature.exit.max().strftime("%Y-%m-%d"),
                       "train_feature_end": mature.index.get_level_values("datetime").max().strftime("%Y-%m-%d"),
                       "rows": len(mature), "validation_rows": len(validation), "rounds": rounds,
                       "sha256": digest(out / f"{model_id}.txt")})
        if cutoff == pd.Timestamp("2022-01-01"):
            frozen_x = features[feature_dates >= cutoff]
            frozen_predictions = pd.Series(model.predict(frozen_x), index=frozen_x.index, name="score")
        print(f"{model_id}: matured={len(mature):,}, validation={len(validation):,}, rounds={rounds}", flush=True)
    if not scores:
        raise ValueError("No matured training data")
    all_scores = pd.concat(scores).sort_index()
    all_scores.to_parquet(out / "scores.parquet")
    metrics, per_date = signal_metrics(all_scores.score, labels, profile["label_horizon"])
    per_date.to_csv(out / "walk_forward_signal_metrics.csv", index=False)
    frozen, frozen_dates = signal_metrics(frozen_predictions, labels, profile["label_horizon"]) if frozen_predictions is not None else ({}, pd.DataFrame())
    frozen_dates.to_csv(out / "frozen_test_signal_metrics.csv", index=False)
    schedule = label_schedule(sorted(daily.date.unique()), profile["label_horizon"])
    close_lookup = daily.set_index(["date", "asset_id"]).close
    sessions = {}
    for day, group in all_scores.groupby(level="datetime"):
        if profile["schema_version"] < 3 and day not in schedule.index:
            continue
        entry = (day.strftime("%Y-%m-%d") if profile["schema_version"] == 3 else
                 schedule.loc[day, "entry"].strftime("%Y-%m-%d"))
        ranked = group.reset_index().sort_values(["score", "instrument"], ascending=[False, True])
        sessions[entry] = {"signal_date": day.strftime("%Y-%m-%d"), "model_id": ranked.model_id.iloc[0],
                           "ranking": [[r.instrument, round(float(r.score), 10), float(close_lookup.loc[(day, r.instrument)])]
                                       for r in ranked.itertuples()]}
    payload = {**profile, "data_version": manifest["version"],
               "model_version": f"{manifest['version']}-{model_version}",
               "execution": profile.get("execution", "game_same_day_close_using_previous_market_day_features"),
               "price_basis": manifest["price_basis"],
               "limitations": ["supplied_game_universe", manifest["price_basis"], "no_separate_dividend_or_corporate_action_cashflows"],
               "models": models, "sessions": sessions}
    write_json(out / "evaluation.json", {"walk_forward": metrics, "frozen_test": frozen,
                                         "promoted_on_performance": False})
    # Last write publishes a completely trained artifact. Server pins its digest.
    write_json(out / "signals.json", payload)
    write_json(out / "artifact.json", {"status": "trained_game_research", "signals_sha256": digest(out / "signals.json"),
                                       "models": len(models), "signal_days": len(sessions),
                                       "spec_sha256": digest(out / "spec.json"), "evaluation": {"walk_forward": metrics, "frozen_test": frozen}})
    print(f"Completed: {out}", flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True)
    p.add_argument("--profile", choices=PROFILES, default="daily_open")
    p.add_argument("--model-version", help="New immutable output folder; default depends on profile")
    p.add_argument("--allow-unadjusted-research", action="store_true",
                   help="Allow a raw-price diagnostic; does not make it a validated competition model")
    p.add_argument("--benchmark", help="CSV with the profile's benchmark column; default depends on profile")
    train(p.parse_args())

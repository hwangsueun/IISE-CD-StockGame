"""Prepare a frozen, offline feasibility audit. Never writes deployed artifacts."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, allow_nan=False) + "\n")


def features(frame):
    close = frame.pivot(index="date", columns="asset_id", values="close").sort_index()
    volume = frame.pivot(index="date", columns="asset_id", values="volume").reindex_like(close)
    daily_return = close.pct_change(fill_method=None)
    f = {f"r{n}": close / close.shift(n) - 1 for n in [3, 5, 10, 20, 40, 60, 80]}
    f.update({f"v{n}": daily_return.rolling(n, min_periods=n).std() for n in [10, 20, 40]})
    f["volume20"] = volume / volume.shift(1).rolling(20, min_periods=20).mean() - 1
    f["ma20"] = close / close.rolling(20, min_periods=20).mean() - 1
    return {k: v.replace([np.inf, -np.inf], np.nan) for k, v in f.items()}


def main(args):
    repo = Path(__file__).resolve().parents[2]
    out, data = Path(args.out).resolve(), Path(args.data).resolve()
    out.mkdir(parents=True, exist_ok=True)
    if (out / "input.json").exists():
        raise FileExistsError("Use a new experiment directory; prepared inputs are immutable.")
    plan_path = Path(__file__).with_name("user_strategy_feasibility_v1.plan.json")
    plan = json.loads(plan_path.read_text())
    if (out / "plan.json").exists():
        assert (out / "plan.json").read_bytes() == plan_path.read_bytes()
    else:
        (out / "plan.json").write_bytes(plan_path.read_bytes())
    model_dir = data / "model-v4-adjusted-open"
    protected_paths = [data / "quant_daily.csv", data / "manifest.json", data / "instruments.csv",
                       model_dir / "signals.json", model_dir / "backtest.json",
                       model_dir / "backtest_input.json", Path(args.benchmark).resolve()]
    protected_paths += sorted(model_dir.glob("lgb-*.txt"))
    protected = {str(p): digest(p) for p in protected_paths}
    write(out / "input_hashes.json", protected)
    write(out / "STATUS.json", {"status": "running", "phase": "preparing",
          "scope": plan["scope"], "plan_sha256": digest(plan_path)})
    frame = pd.read_csv(data / "quant_daily.csv", parse_dates=["date"])
    frame = frame.sort_values(["asset_id", "date"])
    frame["observed_count"] = frame.groupby("asset_id").cumcount() + 1
    ids = sorted(frame.asset_id.unique())
    close = frame.pivot(index="date", columns="asset_id", values="close").reindex(columns=ids).sort_index()
    opens = frame.pivot(index="date", columns="asset_id", values="open").reindex_like(close)
    eligible = frame.assign(eligible=(frame.observed_count >= 60) & frame.tradable &
                            (frame.open > 0) & (frame.close > 0)).pivot(
                                index="date", columns="asset_id", values="eligible").reindex_like(close).fillna(False)
    raw = features(frame)
    # A future-tail removal must not change any feature available before removal.
    cut = pd.Timestamp("2018-12-31")
    truncated = features(frame[frame.date <= cut])
    for name in raw:
        # Later listings add all-missing earlier columns, not earlier information.
        pd.testing.assert_frame_equal(raw[name].loc[:cut],
                                      truncated[name].reindex(columns=raw[name].columns))
    ranked = {k: v.where(eligible).rank(axis=1, pct=True) - .5 for k, v in raw.items()}
    signals = {}
    for n in [40, 60, 80]:
        signals[f"momentum{n}"] = ranked[f"r{n}"]
    for n in [3, 5, 10]:
        signals[f"reversal{n}"] = -ranked[f"r{n}"]
    for n in [10, 20, 40]:
        signals[f"lowvol{n}"] = -ranked[f"v{n}"]
    for w in [.25, .5, .75]:
        name = "blend_momentum60_lowvol20" if w == .5 else f"blend_weight_{w}"
        signals[name] = w * ranked["r60"] - (1-w) * ranked["v20"]
    benchmark = pd.read_csv(args.benchmark, parse_dates=["date"]).set_index("date")
    assert not benchmark.index.duplicated().any()
    benchmark = benchmark.reindex(close.index)
    names = ["r5", "r20", "r60", "v20", "volume20", "ma20"]
    x = np.stack([ranked[n].fillna(0).to_numpy() for n in names], axis=-1)
    weights = []
    for horizon in [1, 20]:
        y = opens.shift(-(horizon+1)) / opens.shift(-1) - 1
        by = benchmark.open.shift(-(horizon+1)) / benchmark.open.shift(-1) - 1
        y = y.sub(by, axis=0).where(eligible).replace([np.inf, -np.inf], np.nan)
        exit_dates = pd.Series(close.index, index=close.index).shift(-(horizon+1))
        for alpha in [.03, .1, .3]:
            key = f"ridge_h{horizon}" + ("" if alpha == .1 else f"_alpha_{alpha}")
            result = pd.DataFrame(np.nan, index=close.index, columns=ids)
            for year in range(2014, 2024):
                cutoff = pd.Timestamp(year=year, month=1, day=1)
                mask = ((close.index >= cutoff - pd.DateOffset(years=3)) &
                        (exit_dates < cutoff).to_numpy())
                xx, yy = x[mask].reshape(-1, len(names)), y.to_numpy()[mask].reshape(-1)
                valid = np.isfinite(yy)
                xx, yy = xx[valid], yy[valid]
                if len(yy) < 500:
                    continue
                assert exit_dates[mask].max() < cutoff
                xm, ym = xx.mean(axis=0), yy.mean()
                xc = xx - xm
                coef = np.linalg.solve(xc.T @ xc / len(yy) + alpha * np.eye(len(names)),
                                       xc.T @ (yy - ym) / len(yy))
                intercept = float(ym - xm @ coef)
                forecast = (close.index >= cutoff) & (close.index < cutoff + pd.DateOffset(years=1))
                result.loc[forecast] = x[forecast] @ coef + intercept
                weights.append({"signal": key, "year": year, "train_rows": len(yy),
                                "train_exit_max": str(exit_dates[mask].max().date()),
                                "cutoff": str(cutoff.date()), "intercept": intercept,
                                "coefficients": dict(zip(names, map(float, coef)))})
            signals[key] = result.where(eligible)
            print(f"Prepared {key}", flush=True)
    quant = json.loads((model_dir / "signals.json").read_text())
    quant_scores = pd.DataFrame(np.nan, index=close.index, columns=ids)
    model_lookup = {m["id"]: m for m in quant["models"]}
    for date, session in quant["sessions"].items():
        model = model_lookup[session["model_id"]]
        assert model["trained_through"] < date and model["available_from"] <= date
        for asset_id, score, source_close in session["ranking"]:
            assert abs(close.loc[date, asset_id] - source_close) < .01
            quant_scores.loc[date, asset_id] = score
    signals["quant"] = quant_scores
    for seed in range(10):
        rng = np.random.default_rng(20261020 + seed)
        signals[f"random{seed}"] = pd.DataFrame(rng.random(close.shape), index=close.index,
                                               columns=ids).where(eligible)
    market = []
    gate = benchmark.close > benchmark.close.rolling(60, min_periods=60).mean()
    for i, date in enumerate(close.index):
        market.append({"date": str(date.date()),
                       "bars": [[j, None if not np.isfinite(opens.iloc[i, j]) else float(opens.iloc[i, j]),
                                 float(close.iloc[i, j])]
                                for j in range(len(ids)) if np.isfinite(close.iloc[i, j])],
                       "eligible": list(np.flatnonzero(eligible.iloc[i].to_numpy()).astype(int).tolist()),
                       "gate": bool(gate.iloc[i]),
                       "indexOpen": None if pd.isna(benchmark.open.iloc[i]) else float(benchmark.open.iloc[i]),
                       "indexClose": None if pd.isna(benchmark.close.iloc[i]) else float(benchmark.close.iloc[i])})
    signal_arrays = {name: [[None if not np.isfinite(v) else round(float(v), 10) for v in row]
                            for row in values.to_numpy()] for name, values in signals.items()}
    coverage = pd.read_csv(data / "instruments.csv").set_index("asset_id")
    assets = [{"asset_id": asset_id, "masked_name": asset_id, "is_active": True,
               "listed_from": coverage.loc[asset_id, "observed_from"],
               "listed_to": coverage.loc[asset_id, "observed_to"]} for asset_id in ids]
    calendar = pd.bdate_range(close.index.min(), close.index.max())
    market_dates = set(close.index)
    windows = []
    for year in range(2014, 2024):
        for month in [1, 4, 7, 10]:
            possible = [(i, d) for i, d in enumerate(calendar)
                        if d.year == year and d.month == month and d in market_dates and
                        i+239 < len(calendar) and calendar[i+239] in market_dates]
            if not possible:
                continue
            i, start = possible[0]
            dates = [str(d.date()) for d in calendar[i:i+240]]
            cohort = "development" if year <= 2018 else "validation" if year <= 2021 else "seen_confirmation"
            windows.append({"id": f"{year}Q{(month-1)//3+1}", "year": year, "cohort": cohort,
                            "primary": month == 1, "dates": dates})
    candidates = []
    for signal in plan["builder_boundary"]["signals"]:
        for policy in ["daily", "weekly"]:
            candidates.append({"id": f"{signal}__{policy}", "signal": signal, "policy": policy,
                               "interval": 1 if policy == "daily" else 5,
                               "nDrop": 1 if policy == "daily" else 10, "gate": False, "kind": "candidate"})
    for signal in ["momentum60", "blend_momentum60_lowvol20"]:
        candidates.append({"id": f"{signal}__weekly_gate", "signal": signal, "policy": "weekly",
                           "interval": 5, "nDrop": 10, "gate": True, "kind": "candidate"})
    controls = [{"id": "equal_weight", "kind": "hold"},
                {"id": "cash", "kind": "cash"}]
    for seed in range(10):
        for policy in ["daily", "weekly"]:
            controls.append({"id": f"random{seed}__{policy}", "signal": f"random{seed}",
                             "interval": 1 if policy == "daily" else 5,
                             "nDrop": 1 if policy == "daily" else 10, "gate": False, "kind": "random"})
    for name, interval, drop in [("quant_daily", 1, 1), ("quant_daily10", 1, 10), ("quant_twenty", 20, 10)]:
        controls.append({"id": name, "signal": "quant", "interval": interval, "nDrop": drop,
                         "gate": False, "kind": "quant"})
    assert len(candidates) == plan["builder_boundary"]["core_candidate_count"]
    payload = {"assets": assets, "market": market, "signals": signal_arrays, "windows": windows,
               "candidates": candidates, "controls": controls}
    write(out / "input.json", payload)
    write(out / "ridge_models.json", weights)
    write(out / "strategy_cards.json", {"core_candidates": candidates,
          "primitive_features": plan["builder_boundary"]["primitive_features"],
          "construction": "Named signal + optional market condition + explicit interval/dropout rule. No language model.",
          "status": "Machine-readable reproducible cards; no user-facing editor or human usability study."})
    checks = {"past_features_unchanged_when_future_removed": True,
              "all_ridge_labels_mature_before_vintage": True,
              "existing_quant_vintages_and_prices_verified": True,
              "core_candidates": len(candidates), "annual_windows": sum(w["primary"] for w in windows),
              "quarterly_windows": len(windows), "data_rows": len(frame), "assets": len(ids),
              "plan_sha256": digest(plan_path), "input_sha256": digest(out / "input.json"),
              "prepared_at": datetime.now(timezone.utc).isoformat(),
              "source_sha256": digest(__file__)}
    assert all(digest(p) == sha for p, sha in protected.items())
    write(out / "preparation_checks.json", checks)
    print(json.dumps(checks, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--benchmark", required=True)
    main(parser.parse_args())

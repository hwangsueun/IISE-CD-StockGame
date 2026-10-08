"""Audit every released score against its source close and historical model cutoff."""
import argparse
import json
import math
from pathlib import Path
import pandas as pd
from prepare import digest, write_json


def verify(data, model_version="model-v2-daily"):
    data = Path(data).resolve()
    manifest = json.loads((data / "manifest.json").read_text())
    model_dir = data / model_version
    metadata = json.loads((model_dir / "artifact.json").read_text())
    assert digest(model_dir / "signals.json") == metadata["signals_sha256"]
    assert digest(model_dir / "spec.json") == metadata["spec_sha256"]
    for name, sha in manifest["files"].items():
        assert digest(data / name) == sha, name
    artifact = json.loads((model_dir / "signals.json").read_text())
    spec = json.loads((model_dir / "spec.json").read_text())
    if artifact["schema_version"] in (2, 3):
        from train import label_schedule
        from profiles import get_profile
        profile = get_profile("daily_open" if artifact["schema_version"] == 3 else "daily_topk_dropout")
        for field in ["strategy", "rebalance_turns", "n_drop", "label_horizon", "top_k", "retrain_months"]:
            assert artifact[field] == spec[field] == profile[field], field
        labels = pd.read_parquet(model_dir / "labels.parquet")
        calendar = pd.read_csv(data / "quant_daily.csv", usecols=["date"], parse_dates=["date"]).date.unique()
        schedule = label_schedule(sorted(calendar), artifact["label_horizon"])
        for column in ["entry", "exit"]:
            expected = schedule.loc[labels.index.get_level_values("datetime"), column].to_numpy()
            assert (labels[column].to_numpy() == expected).all(), column
        if artifact["schema_version"] == 3:
            import numpy as np
            assert artifact["execution"] == "next_market_open" and spec["label_price"] == "open"
            assert digest(spec["benchmark_path"]) == spec["benchmark_sha256"]
            daily = pd.read_csv(data / "quant_daily.csv", parse_dates=["date"])
            opens = daily[["date", "asset_id", "open"]].rename(columns={"asset_id":"instrument"})
            flat = labels.reset_index()
            joined = flat.merge(opens.rename(columns={"date":"entry", "open":"entry_open"}), on=["entry","instrument"], validate="many_to_one")
            joined = joined.merge(opens.rename(columns={"date":"exit", "open":"exit_open"}), on=["exit","instrument"], validate="many_to_one")
            benchmark = pd.read_csv(spec["benchmark_path"],parse_dates=["date"]).set_index("date").open
            br = benchmark.reindex(joined.exit).to_numpy() / benchmark.reindex(joined.entry).to_numpy() - 1
            np.testing.assert_allclose(joined.label, joined.exit_open / joined.entry_open - 1 - br, atol=1e-12)
    models = {m["id"]: m for m in artifact["models"]}
    for model in models.values():
        assert model["trained_through"] < model["available_from"]
        assert digest(model_dir / f"{model['id']}.txt") == model["sha256"]
    frame = pd.read_csv(data / "quant_daily.csv", dtype={"code": str}).set_index(["date", "asset_id"])
    score_count = 0
    for date, decision in artifact["sessions"].items():
        model = models[decision["model_id"]]
        signal_date = decision["signal_date"]
        assert model["trained_through"] < model["available_from"] <= signal_date
        assert signal_date == date if artifact["schema_version"] == 3 else signal_date < date
        ids = [row[0] for row in decision["ranking"]]
        assert len(ids) == len(set(ids))
        previous = math.inf
        for symbol, score, close in decision["ranking"]:
            assert math.isfinite(score) and score <= previous
            assert math.isclose(close, frame.loc[(signal_date, symbol), "close"], abs_tol=.001)
            assert bool(frame.loc[(signal_date, symbol), "tradable"])
            previous = score
            score_count += 1
    report = {"status": "passed", "source_rows": len(frame), "models": len(models),
              "signal_days": len(artifact["sessions"]), "audited_scores": score_count,
              "checks": ["source_and_artifact_hashes", "training_label_maturity", "previous_day_information",
                         "ranking_order", "unique_instruments", "source_price_alignment", "past_tradability"],
              "scripts_sha256": {p.name: digest(p) for p in Path(__file__).parent.glob("*.py")}}
    write_json(model_dir / "verification.json", report)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--model-version", default="model-v3-open")
    args = parser.parse_args()
    verify(args.data, args.model_version)

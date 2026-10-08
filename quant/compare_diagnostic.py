"""Compare frozen v1/v2 on identical daily labels and the same game price path.

The daily execution of v1 scores is a diagnostic counterfactual, never a
deployable artifact. Test dates were already inspected; no tuning is performed.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess

import lightgbm as lgb
import numpy as np
import pandas as pd

from prepare import digest, write_json


def summarize(frame):
    result = {"dates": len(frame)}
    for column in ["old_ic", "new_ic", "old_rank_ic", "new_rank_ic", "rank_ic_delta"]:
        result[column] = float(frame[column].mean())
    return result


def paired_block_interval(deltas, block=20, repeats=2000):
    """Fixed-seed circular block bootstrap of the paired date-level difference."""
    values = np.asarray(deltas)
    rng = np.random.default_rng(42)
    starts = rng.integers(0, len(values), (repeats, int(np.ceil(len(values) / block))))
    positions = (starts[:, :, None] + np.arange(block)) % len(values)
    sample = values[positions.reshape(repeats, -1)[:, :len(values)]].mean(axis=1)
    low, high = np.quantile(sample, [.025, .975])
    return {"mean_delta": float(values.mean()), "lower_95": float(low), "upper_95": float(high),
            "block_market_days": block, "replicates": repeats, "seed": 42,
            "interpretation": "Descriptive paired uncertainty; not a fresh holdout or correction for repeated experiments"}


def compare(data, version):
    data = Path(data).resolve()
    old = data / "model-v1"
    new = data / version
    out = new / "comparison"
    out.mkdir(exist_ok=False)
    plan = json.loads((new / "diagnostic_plan.json").read_text())
    assert all(digest(Path(p)) == sha for p, sha in plan["preserved_artifacts_sha256"].items())
    assert digest(new / "features.parquet") == digest(old / "features.parquet")
    # Both model weights were fitted with only labels matured before 2022.
    features = pd.read_parquet(new / "features.parquet")
    labels = pd.read_parquet(new / "labels.parquet")
    labels = labels[labels.index.get_level_values("datetime") >= "2022-01-01"]
    x = features.loc[labels.index]
    frame = labels.copy()
    for name, folder in [("old", old), ("new", new)]:
        model = lgb.Booster(model_file=str(folder / "lgb-20220101.txt"))
        frame[name] = model.predict(x)
    rows = []
    excluded = []
    for date, group in frame.groupby(level="datetime"):
        group = group.dropna(subset=["label", "old", "new"])
        if len(group) < 20 or min(group.old.nunique(), group.new.nunique(), group.label.nunique()) < 2:
            excluded.append(str(date.date()))
            continue
        row = {"date": str(date.date()), "n": len(group)}
        for name in ["old", "new"]:
            row[f"{name}_ic"] = float(group[name].corr(group.label))
            row[f"{name}_rank_ic"] = float(group[name].corr(group.label, method="spearman"))
        row["rank_ic_delta"] = row["new_rank_ic"] - row["old_rank_ic"]
        rows.append(row)
    dates = pd.DataFrame(rows)
    if dates.empty:
        raise ValueError("No dates with defined paired Rank IC")
    dates.to_csv(out / "matched_daily_rank_ic.csv", index=False)
    matched = {**summarize(dates), "label": "next close to following close minus matching KOSPI return",
               "from": dates.date.min(), "to": dates.date.max(), "excluded_dates": excluded,
               "by_year": {year: summarize(part) for year, part in dates.groupby(dates.date.str[:4])},
               "paired_block_bootstrap": paired_block_interval(dates.rank_ic_delta)}

    original_input = json.loads((old / "backtest_input.json").read_text())
    new_input = json.loads((new / "backtest_input.json").read_text())
    assert original_input["turns"] == new_input["turns"]
    assert original_input["prices"] == new_input["prices"]
    assert original_input["assets"] == new_input["assets"]
    old_strategy = original_input["strategies"]["frozen_alpha158"]
    # Retain the true old label period in metadata. Runtime artifact validation
    # deliberately rejects this schema-1 daily counterfactual for deployment.
    old_daily = {**old_strategy, "strategy": "topk_dropout", "rebalance_turns": 1, "n_drop": 1,
                 "label_horizon": {"unit": "weekdays", "value": 120}, "diagnostic_only": True}
    new_input["strategies"].update(old_alpha158_120=old_strategy, old_scores_daily_dropout=old_daily)
    write_json(out / "backtest_input.json", new_input)
    with (out / "backtest.log").open("x") as log:
        subprocess.run(["node", str(Path(__file__).with_name("backtest.cjs")),
                        str(out / "backtest_input.json")], check=True, stdout=log)
    portfolio = json.loads((out / "backtest.json").read_text())
    previous_portfolio = json.loads((old / "backtest.json").read_text())
    assert portfolio["results"]["old_alpha158_120"] == previous_portfolio["results"]["frozen_alpha158"]
    original_new = json.loads((new / "backtest.json").read_text())
    assert portfolio["results"]["frozen_alpha158"] == original_new["results"]["frozen_alpha158"]

    old_evaluation = json.loads((old / "evaluation.json").read_text())
    new_evaluation = json.loads((new / "evaluation.json").read_text())
    old_model = json.loads((old / "signals.json").read_text())
    new_model = json.loads((new / "signals.json").read_text())
    summary = {"status": "complete", "completed_at_utc": datetime.now(timezone.utc).isoformat(),
               "scope": "Raw-price historical diagnostic; no deployment or fresh holdout claim",
               "matched_one_day_labels": matched,
               "own_horizon_frozen_metrics_not_directly_comparable": {
                   "old_120_weekdays": old_evaluation["frozen_test"],
                   "new_one_market_day": new_evaluation["frozen_test"]},
               "portfolio": portfolio,
               "net_return_delta_vs_old_120": portfolio["results"]["frozen_alpha158"]["net_return"] -
                   portfolio["results"]["old_alpha158_120"]["net_return"],
               "frozen_models": {name: next(m for m in a["models"] if m["id"] == "lgb-20220101")
                                 for name, a in [("old", old_model), ("new", new_model)]},
               "checks": {"identical_source_features": True, "identical_backtest_dates_and_prices": True,
                          "old_portfolio_reproduced_exactly": True, "new_portfolio_reproduced_exactly": True,
                          "protected_artifacts_unchanged": True},
               "comparison_script_sha256": digest(__file__)}
    assert all(digest(Path(p)) == sha for p, sha in plan["preserved_artifacts_sha256"].items())
    write_json(out / "summary.json", summary)
    lines = ["# 일별 Alpha158 모델 진단", "", "현재 수정 전 가격으로 학습한 결과이며 게임 배포 모델은 변경하지 않았습니다.",
             "2022~2023은 기존 결과를 이미 확인한 기간이므로 후속 진단으로 해석합니다.", "",
             "## 동일한 1거래일 정답으로 비교", "", "| 항목 | 기존 120턴 학습 모델 | 새 일별 학습 모델 |", "|---|---:|---:|",
             f"| 평균 Rank IC | {matched['old_rank_ic']:.6f} | {matched['new_rank_ic']:.6f} |",
             f"| 평균 IC | {matched['old_ic']:.6f} | {matched['new_ic']:.6f} |", "",
             f"동일 날짜 {matched['dates']}개, 날짜별로 동일 종목·정답 사용. Rank IC 차이 {matched['rank_ic_delta']:+.6f}.",
             f"차이의 20거래일 블록 부트스트랩 95% 구간: [{matched['paired_block_bootstrap']['lower_95']:.6f}, {matched['paired_block_bootstrap']['upper_95']:.6f}].", "",
             "## 같은 기간·가격·체결기로 비교", "", "| 전략 | 누적 수익률 | CAGR | MDD | 매매 건수 |", "|---|---:|---:|---:|---:|"]
    names = {"old_alpha158_120": "기존 모델 / 120턴 전체 교체", "old_scores_daily_dropout": "기존 점수 / 매일 부분 교체 (진단)",
             "frozen_alpha158": "새 모델 / 매일 부분 교체", "momentum60": "60일 모멘텀 / 매일 부분 교체", "equal_weight": "전체 동일가중 / 매일 재조정"}
    for key, title in names.items():
        r = portfolio["results"][key]
        lines.append(f"| {title} | {r['net_return']:.2%} | {r['cagr']:.2%} | {r['mdd']:.2%} | {r['trades']} |")
    lines += ["", "게임의 현행 거래비용은 0이며 수정주가·배당 보정은 반영하지 않았습니다.",
              "기존 점수를 일별로 매매한 비교군은 원인 구분을 위한 진단용이며 배포 파일이 아닙니다.",
              "예측 기간을 바꿨으므로 각 모델의 원래 label 기준 Rank IC끼리는 직접 비교하지 않습니다.",
              "기존 모델의 미래 시점 학습, 가격 변경, 결과 확인 후 파라미터 변경은 적용하지 않았습니다."]
    (out / "comparison.md").write_text("\n".join(lines) + "\n")
    status = json.loads((new / "STATUS.json").read_text())
    status.update(status="complete", phase="comparison_complete", comparison_report=str(out / "comparison.md"),
                  protected_artifacts_unchanged=True, completed_at_utc=summary["completed_at_utc"])
    write_json(new / "STATUS.json", status)
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--model-version", default="model-v2-daily-raw-diagnostic")
    args = parser.parse_args()
    compare(args.data, args.model_version)

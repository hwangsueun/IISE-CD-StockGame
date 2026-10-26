"""Readable audit report, descriptive results and preregistered gate evaluation."""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
from html import escape
import json
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")


def pct(value):
    return "—" if pd.isna(value) else f"{value:+.1%}"


def table(frame):
    return frame.to_html(index=False, border=0, escape=True, classes="data")


def main(out):
    out = Path(out).resolve()
    payload = json.loads((out / "results.json").read_text())
    plan = json.loads((out / "plan.json").read_text())
    selection = json.loads((out / "selection.json").read_text())
    df = pd.DataFrame(payload["rows"])
    df.drop(columns=["monthlyReturns"]).to_csv(out / "results.csv", index=False)
    annual = df[df.primary & ~df.cashflow & (df.initialCash == 50_000_000)]
    late = annual[(annual.year >= 2019) & (annual.fee == .001)]
    equal = late[late.strategy == "equal_weight"].set_index("window").netReturn
    quant = late[late.strategy == "quant_daily"].set_index("window")
    selected_ids = [c["id"] for c in payload["selected"]]
    metrics, decisions = {}, {}
    for config in payload["selected"]:
        name = config["id"]
        rows = late[late.strategy == name].set_index("window")
        excess = rows.netReturn - equal
        neighbors = [n["id"] for n in payload["neighbors"] if n["id"].startswith(name + "__neighbor_")]
        neighbor_medians = {n: float(late[late.strategy == n].netReturn.median()) for n in neighbors}
        capital_medians = {str(cap): float(df[(df.strategy == name) & df.primary & ~df.cashflow &
                                             (df.year >= 2019) & (df.fee == .001) &
                                             (df.initialCash == cap)].netReturn.median())
                           for cap in plan["cost_and_capital"]["selected_capital_checks"]}
        month_wins = []
        for w, row in rows.iterrows():
            month_wins += [float(a > b) for a, b in zip(row.monthlyReturns, quant.loc[w].monthlyReturns)
                           if a is not None and b is not None]
        # Descriptive paired annual resampling; five years cannot certify alpha.
        rng = np.random.default_rng(20261020)
        sampled = rng.choice(excess.to_numpy(), (5000, len(excess)), replace=True).mean(axis=1)
        m = {
            "annual_windows": len(rows), "median_net_return": float(rows.netReturn.median()),
            "positive_fraction": float((rows.netReturn > 0).mean()),
            "median_excess_equal": float(excess.median()), "beat_equal_fraction": float((excess > 0).mean()),
            "median_mdd": float(rows.mdd.median()), "worst_mdd": float(rows.mdd.min()),
            "confirmation_median": float(rows[rows.year >= 2022].netReturn.median()),
            "monthly_quant_win_fraction": float(np.mean(month_wins)),
            "median_excess_quant": float((rows.netReturn - quant.netReturn).median()),
            "neighbor_medians": neighbor_medians, "capital_medians": capital_medians,
            "paired_mean_excess_descriptive_interval": list(map(float,np.quantile(sampled,[.025,.975]))),
            "interval_note": "Resamples five annual windows; descriptive only, no multiple-search correction or fresh holdout."
        }
        g = plan["provisional_practical_gate"]
        gates = {
            "median_return_5pct": m["median_net_return"] >= g["median_240_turn_return_at_least"],
            "positive_60pct": m["positive_fraction"] >= g["positive_return_fraction_at_least"],
            "positive_median_excess_equal": m["median_excess_equal"] > 0,
            "beat_equal_60pct": m["beat_equal_fraction"] >= .6,
            "median_drawdown_25pct": m["median_mdd"] >= -.25,
            "worst_drawdown_50pct": m["worst_mdd"] >= -.5,
            "positive_seen_confirmation": m["confirmation_median"] > 0,
            "neighbor_stability": all(v > 0 for v in neighbor_medians.values()),
            "capital_stability": all(v > 0 for v in capital_medians.values())
        }
        metrics[name], decisions[name] = m, {"checks": gates, "practical_pass": all(gates.values())}
    summaries = []
    ids = [c["id"] for c in json.loads((out / "input.json").read_text())["candidates"]]
    ids += ["quant_daily","quant_daily10","quant_twenty","equal_weight","cash"]
    for name in ids:
        row = {"전략": name, "개발에서 선정": "선정" if name in selected_ids else ""}
        for label, years in [("개발",range(2014,2019)),("후속",range(2019,2022)),("기존 확인 구간",[2022,2023])]:
            part = annual[(annual.strategy == name) & annual.year.isin(years) & (annual.fee == .001)]
            row[label+" 중앙 수익률"] = pct(part.netReturn.median())
        part = late[late.strategy == name]
        row["2019–23 수익 발생"] = f"{int((part.netReturn>0).sum())}/{len(part)}"
        row["중앙 최대 낙폭"] = pct(part.mdd.median())
        summaries.append(row)
    summary_table = pd.DataFrame(summaries)
    annual_table = late[late.strategy.isin(selected_ids+["quant_daily","equal_weight"])][
        ["year","strategy","netReturn","mdd","trades","averageExposure"]].copy()
    annual_table = annual_table.sort_values(["year","strategy"])
    for col in ["netReturn","mdd","averageExposure"]:
        annual_table[col] = annual_table[col].map(pct)
    annual_table.columns = ["시작 연도","전략","240턴 수익률","최대 낙폭","체결 수","평균 투자 비중"]
    gate_rows=[]
    for name,d in decisions.items():
        for gate,passed in d["checks"].items():
            gate_rows.append({"전략":name,"사전 고정 조건":gate,"판정":"통과" if passed else "미충족"})
    sensitivity = df[df.strategy.isin(selected_ids) & df.primary & ~df.cashflow & (df.year>=2019)].groupby(
        ["strategy","initialCash","fee"],as_index=False).agg(
            median_return=("netReturn","median"),positive=("netReturn",lambda s:(s>0).mean()),
            median_mdd=("mdd","median"))
    for col in ["median_return","positive","median_mdd"]:sensitivity[col]=sensitivity[col].map(pct)
    flow = df[df.cashflow & (df.year>=2019)][
        ["strategy","year","fee","netReturn","investmentPnl","remainingDebt","missedPayments"]].copy()
    flow.netReturn=flow.netReturn.map(pct)
    for col in ["investmentPnl","remainingDebt"]:flow[col]=flow[col].map(lambda x:f"{x:,.0f}")
    diagnostics={}
    for name in selected_ids+["quant_daily","quant_daily10","quant_twenty","equal_weight"]:
        rows=annual[(annual.strategy==name)&(annual.year>=2019)]
        zero=rows[rows.fee==0].set_index("window")
        cost=rows[rows.fee==.001].set_index("window")
        diagnostics[name]={"median_zero_cost_return":float(zero.netReturn.median()),
                           "median_10bps_return":float(cost.netReturn.median()),
                           "median_paired_cost_drag":float((cost.netReturn-zero.netReturn).median()),
                           "median_trades_at_10bps":float(cost.trades.median()),
                           "median_turnover_at_10bps":float(cost.turnover.median())}
    random_comparison={}
    for name in selected_ids:
        config=next(c for c in payload["selected"] if c["id"]==name)
        candidate=late[late.strategy==name].set_index("window")
        controls=late[(late.kind=="random") & late.strategy.str.endswith("__"+config["policy"])]
        by_seed=[]
        for strategy,part in controls.groupby("strategy"):
            delta=candidate.netReturn-part.set_index("window").netReturn
            by_seed.append({"control":strategy,"median_return":float(part.netReturn.median()),
                            "candidate_median_paired_advantage":float(delta.median())})
        random_comparison[name]=by_seed
    # This candidate was included before outcomes, but was NOT development-selected.
    # Its attractive later result is an observation, never a replacement winner.
    gate_candidate=late[late.strategy=="momentum60__weekly_gate"].sort_values("year")
    gate_quarterly=df[(df.strategy=="momentum60__weekly_gate") & (df.year>=2019) &
                      ~df.cashflow & (df.initialCash==50000000) & (df.fee==.001)]
    ungated=late[late.strategy=="momentum60__weekly"].set_index("year")
    exploratory_gate={
        "strategy":"momentum60__weekly_gate",
        "preincluded":True,"development_selected":False,"promoted":False,
        "median_return":float(gate_candidate.netReturn.median()),
        "positive_windows":int((gate_candidate.netReturn>0).sum()),
        "windows":len(gate_candidate),
        "median_mdd":float(gate_candidate.mdd.median()),
        "worst_mdd":float(gate_candidate.mdd.min()),
        "overlapping_quarterly_windows":len(gate_quarterly),
        "quarterly_positive_windows":int((gate_quarterly.netReturn>0).sum()),
        "quarterly_median_return":float(gate_quarterly.netReturn.median()),
        "annual":[{"year":int(r.year),"net_return":float(r.netReturn),
                   "ungated_return":float(ungated.loc[r.year].netReturn),"mdd":float(r.mdd)}
                  for r in gate_candidate.itertuples()],
        "interpretation":"Post-result observation of a preincluded candidate; requires a new frozen validation before selection."
    }
    summary={"status":"completed","scope":plan["scope"],"selected":selected_ids,
             "metrics":metrics,"gates":decisions,"diagnostics":diagnostics,"random_controls":random_comparison,
             "exploratory_gate_observation":exploratory_gate,
             "fresh_holdout_pass":False,"human_accessibility_tested":False,
             "representation_reproducible":True,
             "full_game_survival_tested":False,
             "decision":"provisional_evidence_only" if any(v["practical_pass"] for v in decisions.values()) else
                        "practical_screen_not_met",
             "source_sha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
             "completed_at":datetime.now(timezone.utc).isoformat()}
    write(out/"summary.json",summary)
    plt.rcParams.update({"figure.dpi":160,"font.size":10})
    fig,axs=plt.subplots(1,2,figsize=(12,4.8))
    display_names={selected_ids[0]:"Selected A",selected_ids[1]:"Selected B",
                   "quant_daily":"Existing quant","equal_weight":"Equal-weight hold"}
    colors=["#155f66","#c17c2f","#657a9d","#999999"]
    for i,(name,label) in enumerate(display_names.items()):
        rows=late[late.strategy==name].sort_values("year")
        axs[0].plot(rows.year,100*rows.netReturn,marker="o",label=label,color=colors[i])
        axs[1].scatter(100*rows.mdd,100*rows.netReturn,label=label,color=colors[i],s=45)
    axs[0].axhline(0,color="#555",linewidth=.7)
    axs[0].set(xlabel="240-weekday window start year",ylabel="Net investment return (%)",
               title="Historical windows | 10 bps each side")
    axs[0].set_xticks([2019,2020,2021,2022,2023])
    axs[1].axhline(0,color="#555",linewidth=.7)
    axs[1].set(xlabel="Maximum drawdown (%)",ylabel="Net investment return (%)",
               title="Return and downside | same windows")
    for ax in axs:
        ax.grid(alpha=.2);ax.spines[["top","right"]].set_visible(False)
    axs[0].legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(out/"performance.png")
    plt.close(fig)
    png=base64.b64encode((out/"performance.png").read_bytes()).decode()
    passed=[n for n,d in decisions.items() if d["practical_pass"]]
    verdict=("사전 고정한 실용성 기준을 통과한 후보가 있습니다. 다만 독립된 새 평가와 실제 사용자 검증은 남아 있습니다."
             if passed else "정해진 도구 안에서 수익이 나는 역사적 사례는 확인했습니다. 다만 개발 기간에서 선정한 두 후보 모두 "
             "실용성 기준 전체를 통과하지 못해, 안정적인 수익 경험을 제공하는 환경으로 확정할 수는 없습니다.")
    selected_text=" / ".join(selected_ids)
    html=f"""<!doctype html><html lang="ko"><meta charset="utf-8">
<title>사용자 퀀트 전략 제작 가능성 검증</title>
<style>body{{font:16px/1.7 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;color:#24313a;max-width:1180px;margin:48px auto;padding:0 28px;background:#fafbfc}}
h1{{font-size:32px}}h2{{margin-top:38px;font-size:22px}}.lead{{background:#edf4f4;border-left:5px solid #155f66;padding:20px}}
table{{border-collapse:collapse;width:100%;font-size:12px;line-height:1.5;background:white}}th,td{{padding:9px;border-bottom:1px solid #dde3e7;text-align:left}}th{{background:#edf1f4}}
.scroll{{overflow-x:auto}}img{{width:100%;background:white}}code{{font-size:13px}}.muted{{color:#65717b}}li{{margin:7px 0}}</style>
<h1>사용자 퀀트 전략 제작 가능성 검증</h1>
<p class="muted">2026-10-20 · 기존 게임의 주식·현금 운용 조건 · 역사적 진단</p>
<div class="lead"><strong>{verdict}</strong><p>개발 구간에서 확정한 후보: {escape(selected_text)}</p></div>
<p>이 결과는 실제 시세와 게임 체결기를 이용한 새 계산입니다. 다만 2014–2023년 자료는 과거 분석에 노출됐으므로,
처음 보는 시장에 대한 검증이나 현실 투자 수익 보장이 아닙니다. 모델 제작 화면·실사용자 실험·배포는 수행하지 않았습니다.</p>
<h2>실험 범위와 사전 기준</h2>
<ul><li>가격·거래량 기반 6개 신호 × 2개 운용 방식, 시장 조건을 붙인 2개 전략: 핵심 후보 14개.</li>
<li>2014–2018년 연초 시작 240턴 성과로 후보 2개를 선정. 이후 2019–2021년과 기존 확인 구간 2022–2023년은 설정 변경 없이 평가.</li>
<li>초기 5천만 원, 다음 시가 체결, 정수 주식·예산·반올림·휴장·주문 거절은 게임과 같은 처리. 주식·현금만 사용.</li>
<li>0비용과 편도 10bp 비용을 비교. 10bp는 임의의 비용 스트레스이며 실제 세율·증권사 요율을 뜻하지 않음.</li>
<li>2019–2023년 5개 연간 창의 중앙 수익률 ≥5%, 양수 수익 ≥60%, 동일금액 보유 대비 중앙 우위 >0 및 승률 ≥60%,
중앙 최대 낙폭 ≥−25%, 최악 낙폭 ≥−50%, 기존 확인 구간의 중앙 수익률 >0. 이웃 설정·다른 초기 자본에서도 중앙 수익률 >0.</li>
<li>5개 연간 표본에 대한 실용적 진단 기준이며 통계적 우위 인증 기준이 아님. 기준은 결과 확인 전에 고정했음.</li></ul>
<img src="data:image/png;base64,{png}" alt="Selected strategies and baseline performance across annual windows">
<p class="muted">Selected A: {escape(selected_ids[0])}<br>Selected B: {escape(selected_ids[1])}</p>
<h2>핵심 후보와 비교군 전체 결과</h2><p>모두 편도 10bp, 초기 5천만 원. 뒤 기간에서 잘 나온 후보로 선정 결과를 교체하지 않았습니다.</p>
<div class="scroll">{table(summary_table)}</div>
<h2>선정 후보의 사전 기준 판정</h2><div class="scroll">{table(pd.DataFrame(gate_rows))}</div>
<h2>환경 개선의 단서: 시장 조건과 현금 유지</h2>
<p>사전에 포함한 <code>momentum60__weekly_gate</code>는 KOSPI가 60거래일 이동평균 위일 때만 투자하고,
그 외에는 보유 주식을 매도하는 전략입니다. 2019–2023년 연초 시작 5개 창에서 모두 비용 후 양수 수익을 냈고,
중앙 수익률은 {pct(exploratory_gate["median_return"])}, 중앙 최대 낙폭은 {pct(exploratory_gate["median_mdd"])}였습니다.
2022년에는 같은 종목선정 규칙의 상시 투자 {pct(ungated.loc[2022].netReturn)}에서
조건부 투자 {pct(gate_candidate.set_index("year").loc[2022].netReturn)}로 달라졌습니다.</p>
<p><strong>이 후보는 개발 구간에서 선정되지 않았습니다.</strong> 후속 결과를 보고 최종 선정 전략으로 바꾸거나 성공으로 승격하지 않습니다.
이는 새 검증을 설계할 때 종목 점수뿐 아니라 시장 노출·현금 유지 조건을 포함할 근거입니다.
분기 시작을 포함한 후속 구간은 {len(gate_quarterly)}개 중 {int((gate_quarterly.netReturn>0).sum())}개가 양수이고
중앙 수익률은 {pct(gate_quarterly.netReturn.median())}였습니다. 이 창들은 서로 겹쳐 독립된 반복 검증으로 셀 수 없습니다.
이동평균 기간 주변 설정과 새로운 데이터에 대한 강건성은 미검증입니다.</p>
<h2>연도별 결과</h2><div class="scroll">{table(annual_table)}</div>
<h2>초기 자본·비용 민감도</h2><p>2019–2023년 연초 시작 창의 중앙값. 금액은 원, fee는 편도 비율입니다.</p>
<div class="scroll">{table(sensitivity)}</div>
<h2>상환과 생활 현금흐름을 붙인 부분 스트레스</h2>
<p>초기 자산 5천만 원·부채 1억 원. 게임의 기본 급여−생활비 220만 원을 21·41·…·221턴에 반영하고,
20턴마다 원금/12를 상환 시도합니다. 한 회분 상환액을 현금으로 남기고 상환 3턴 전부터 필요 자산을 매도합니다.
수익률은 입출금을 제외한 시간가중수익률입니다. 상금·부업·병원비·확률 이벤트·신뢰도 종료를 제외했으므로 게임 승리 검증이 아닙니다.</p>
<p>상환으로 투자계좌가 0원이 된 경우 연결 수익률은 정의할 수 없어 ‘—’로 표시합니다.
이는 투자 손실 −100%를 뜻하지 않습니다. investmentPnl은 모든 입출금을 제외한 실제 투자 손익(원)입니다.</p>
<div class="scroll">{table(flow)}</div>
<h2>접근 가능성과 검증 한계</h2>
<ul><li>전략은 지표 선택, 공개된 조합식, 운용 주기와 현금 조건으로 재현됩니다. 학습 모델은 6개 입력의 Ridge 회귀입니다.</li>
<li>초보자가 스스로 발견하거나 이해할 수 있는지는 실제 사용자 실험 전에는 확인했다고 말할 수 없습니다.</li>
<li>분기별 시작 창은 서로 겹칩니다. 전체 결과 CSV에 공개하되 독립 표본 수로 세지 않았습니다.</li>
<li>무작위 종목 순위 10개 seed를 같은 운용 규칙으로 비교한 결과와 설정 주변 검증은 summary.json/results.csv에 포함됩니다.</li>
<li>117개 제공 종목 집합, 과거 시장 전체 구성 부재, 2026년 시점 소급 수정가격, 현금배당 별도 지급 부재가 남습니다.</li>
<li>과거 양수 수익이나 이 사전 기준 통과만으로 실거래·새 시장 수익 능력 또는 인과적인 투자 가설을 입증하지 않습니다.</li></ul>
<h2>재현 자료</h2><p><a href="plan.json">사전 계획</a> · <a href="summary.json">요약 수치와 판정</a> ·
<a href="results.csv">전체 비교 결과</a> · <a href="selection.json">개발 구간 선정 기록</a> ·
<a href="strategy_cards.json">재현 가능한 전략 정의</a> · <a href="execution_checks.json">게임 체결기 대조</a> ·
<a href="final_checks.json">원본 보존과 회계 검증</a></p></html>"""
    (out/"report.html").write_text(html)
    write(out/"STATUS.json",{"status":"completed","phase":"report_complete","decision":summary["decision"],
          "scope":plan["scope"],"completed_at":summary["completed_at"],"report":str(out/"report.html")})
    print(json.dumps(summary,indent=2,ensure_ascii=False))


if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("out")
    main(p.parse_args().out)

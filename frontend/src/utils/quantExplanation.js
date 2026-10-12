import { won } from './format.js';

const positiveInteger = (value) => Number.isInteger(value) && value > 0;

// 운용 숫자는 이 세션의 API 응답에서만 가져온다. 이전 모델에도 현재 모델의 규칙을 덮어쓰지 않는다.
export function getQuantExplanation(data) {
  if (!data || data.status === 'unavailable' || !positiveInteger(data.topK)) return null;
  const dropout = data.strategy === 'topk_dropout';
  const periodic = data.strategy === 'equal_weight_rebalance';
  if ((!dropout && !periodic) || (dropout && !positiveInteger(data.nDrop)) ||
      (periodic && !positiveInteger(data.rebalanceTurns))) return null;

  const nextOpen = data.executionRule === 'next_market_open';
  const point = nextOpen ? '시가' : '종가';
  const horizon = data.labelHorizon;
  let predictionPeriod = null;
  if (horizon?.unit === 'market_sessions' && horizon.value === 1) {
    predictionPeriod = `다음 개장일 ${point}부터 그다음 개장일 ${point}까지`;
  } else if (horizon?.unit === 'weekdays' && positiveInteger(horizon.value)) {
    predictionPeriod = `다음 개장일 ${point}부터 ${horizon.value}턴 뒤의 첫 개장일 ${point}까지`;
  }

  return {
    summary: dropout
      ? `상위 최대 ${data.topK}종목으로 시작하고, 이후 매 턴 비교해 최대 ${data.nDrop}종목씩 교체해요.`
      : `상위 최대 ${data.topK}종목을 고르고, ${data.rebalanceTurns}턴마다 구성을 다시 정해요.`,
    steps: [
      { title: '학습된 AI가 점수 계산',
        body: '과거 지표와 실제 성과를 배운 LightGBM에 오늘의 158개 지표를 넣어, 코스피 대비 수익률을 예측해요.' },
      { title: `상위 최대 ${data.topK}종목에 분산`,
        body: dropout
          ? '처음에는 거래 가능한 상위 종목에 같은 금액씩 배분해요. 이후 비중은 주가에 따라 달라져요.'
          : '교체할 때 거래 가능한 상위 종목에 같은 금액씩 배분하고, 남은 돈은 현금으로 보유해요.' },
      { title: dropout ? `최대 ${data.nDrop}종목씩 교체` : `${data.rebalanceTurns}턴마다 다시 고르기`,
        body: dropout
          ? '매 턴 더 높은 점수의 후보와 비교해요. 더 좋은 후보가 없으면 기존 종목을 유지해요.'
          : '교체 시점에 새 순위로 구성을 바꿔요. 휴장일이면 다음 개장일까지 기다려요.' },
    ],
    allocationExample: Number.isFinite(data.initialCash) && data.initialCash > 0
      ? `예를 들어 초기 투자금 ${won(data.initialCash)}으로 ${data.topK}종목을 모두 담는다면, 종목당 약 ${won(data.initialCash / data.topK)}씩 배분해요. 실제 매수액은 수수료·주식 수량·체결 가격에 따라 달라져요.`
      : null,
    prediction: predictionPeriod
      ? `${predictionPeriod}, 코스피 대비 수익률을 예측하도록 학습했어요. 점수는 종목 간 우선순위를 비교하는 데 사용해요.`
      : '코스피 대비 수익률을 예측하도록 학습하고, 그 점수로 종목 간 우선순위를 비교해요.',
    execution: nextOpen
      ? '오늘 장이 끝난 뒤 주문을 예약하고, 다음 개장일 시가로 체결해요. 주문 때 정한 예산이 부족하면 일부만 체결될 수 있어요.'
      : '이전 개장일까지의 정보로 종목을 고르고, 거래일 종가 기준으로 매매해요.',
    replacement: dropout
      ? `처음 구성하거나 빈 자리를 채울 때에는 여러 종목을 살 수 있어요. 이후 교체는 한 번에 최대 ${data.nDrop}종목이며, 동점이면 기존 종목을 유지해요. 휴장일에는 매매를 쉬어요. 남은 현금과 매도 대금을 새로 살 종목에 나누고, 기존 종목의 비중을 매일 같게 맞추지는 않아요.`
      : `게임의 1턴부터 ${data.rebalanceTurns}턴 간격으로 다시 구성해요. 교체 사이에는 보유 종목을 유지하며 수익률을 확인할 수 있어요.`,
  };
}

// 체결 금액(KRW) 반올림 규칙 (tradeService 매수/매도, turnService 강제청산 공용)
//
// 코인은 소수 수량 거래를 허용하므로 price * quantity가 정수 원이 아닐 수 있다.
// game_sessions.cash는 정수 KRW(BIGINT, Math.round 저장)인데 trades.amount를 반올림 없이
// 그대로 쌓으면 두 값이 서서히 어긋난다(누적 드리프트). 체결 시점에 딱 한 번만 반올림하고,
// 그 반올림된 amount를 cash 증감과 trades.amount에 동일하게 써야 항상 정합이 유지된다.
//
// 규칙: 매수는 원 단위 올림(ceil) = 플레이어가 최대 1원 더 낸다.
//       매도는 원 단위 내림(floor) = 플레이어가 최대 1원 덜 받는다.
// 두 방향 모두 "시스템이 실제 가치보다 많은 현금을 만들어내지 않는" 쪽으로만 반올림한다.
// 반대로(매수 내림/매도 올림) 하면 극소 금액을 반복 매매해 원 단위 이하 현금을 계속
// 만들어내는 차익거래가 가능해진다. 플레이어가 보는 손해는 거래당 최대 1원으로 무시할 수준이다.
// 강제청산(상장폐지)도 매도이므로 동일하게 내림을 적용한다.
function roundTradeAmount(tradeType, rawAmount) {
  return tradeType === 'buy' ? Math.ceil(rawAmount) : Math.floor(rawAmount);
}

module.exports = { roundTradeAmount };

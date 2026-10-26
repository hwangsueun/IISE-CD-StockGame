const C = require('../config/constants');

// 직접 주문과 모델 주문은 같은 계좌의 같은 투자 제한을 따른다.
function restriction(session) {
  const turn = Number(session.current_turn);
  if (turn <= Number(session.action_locked_until_turn || 0)) {
    return {
      code: 'hospitalized', orderReason: 'investment_locked_hospital',
      message: '입원 중에는 직접 주문과 자동 투자를 쉬어야 합니다.',
      resumeTurn: Number(session.action_locked_until_turn) + 1,
    };
  }
  // 스트레스가 다른 행동으로 100에 도달한 뒤 입원 이벤트를 판정하기 전의 틈도 막는다.
  if (Number(session.stress) >= C.STRESS_FAINT_THRESHOLD) {
    return {
      code: 'stress_limit', orderReason: 'investment_locked_stress',
      message: '스트레스가 한계에 도달해 직접 주문과 자동 투자를 쉬어야 합니다.',
      resumeTurn: null,
    };
  }
  if (Number(session.side_job_turn) === turn) {
    return {
      code: 'side_job', orderReason: 'investment_locked_side_job',
      message: '부업을 한 날에는 직접 주문과 자동 투자를 쉬어야 합니다.',
      resumeTurn: turn + 1,
    };
  }
  return null;
}

// 반드시 세션 행 잠금을 가진 트랜잭션에서 호출한다.
// 이미 체결된 거래와 보유분은 건드리지 않는다. 비교 대상 Alpha158 계좌도 제외한다.
async function enforce(client, session) {
  const blocked = restriction(session);
  if (!blocked) return null;
  const { rows } = await client.query(
    `UPDATE market_orders SET status='cancelled',reason=$2,updated_at=NOW()
     WHERE session_id=$1 AND owner='player' AND status='pending' RETURNING id`,
    [session.id, blocked.orderReason],
  );
  // 취소된 주문의 오래된 목표를 재실행하지 않고 재개 첫날 최신 가격/잔액으로 다시 판단한다.
  await client.query(
    `UPDATE user_strategy_automation SET next_review_turn=LEAST(next_review_turn,$2),updated_at=NOW()
     WHERE session_id=$1 AND enabled=TRUE`,
    [session.id, Number(session.current_turn) + 1],
  );
  return { ...blocked, cancelledOrderCount: rows.length };
}

module.exports = { restriction, enforce };

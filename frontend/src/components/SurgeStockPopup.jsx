// 급등주 이벤트 (미팅5 §4) — 친구 재현의 스마트폰 메시지로 소식이 전해지는 형식으로 이식
// 디자인 원본: public/game/Surge Stock Event.html (Phase D)
// 서버는 immediate + 별도 REST(/surge/active, /surge/buy)로 동작하며 pendingEvents/resolveEvent와는
// 무관하다. 매수 결과는 이 팝업이 아니라, 다음 턴에 SurgeResultPopup으로 별도 공개된다.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGameStore } from '../state/gameStore';
import { useTypewriter } from '../hooks/useTypewriter';
import { won, signed } from '../utils/format';

const FRIEND = { name: '재현', avatar: '😏' };

// 서버 OUTCOMES(key)에는 문구가 없어, 결과 카드에 붙일 한 줄 설명만 프론트에서 관리한다.
const OUTCOME_LABEL = {
  surge: '소문이 맞았다! 상한가를 찍었다.',
  rise: '기대만큼은 아니어도 확실히 올랐다.',
  small_rise: '소폭 상승, 나쁘지 않은 결과다.',
  fall: '기대와 달리 소폭 하락했다.',
  plunge: '작전주였다... 크게 물렸다.',
  crash: '휴지조각이 됐다. 완전히 속았다.',
};

/**
 * activeOverride/onBuy/onDismiss: 실제 게임에서는 생략하면 스토어/실서버 API를 그대로 쓴다.
 * IntroPage의 [개발용] 미리보기처럼 세션 없이 렌더링할 때만 목업 값으로 대체해서 넘긴다.
 */
export function SurgeStockPopup({ activeOverride, onBuy, onDismiss } = {}) {
  const { sessionId, turn } = useGameStore();
  const [active, setActive] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [phase, setPhase] = useState('phone'); // 'phone' | 'chat' | 'decision' | 'bought' | 'watched'
  const [chatIdx, setChatIdx] = useState(0);
  const [quantity, setQuantity] = useState('');
  const [bought, setBought] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDismissed(false);
    setBought(null);
    setPhase('phone');
    setChatIdx(0);
    setQuantity('');
    setError(null);
    if (activeOverride) { setActive(activeOverride); return; }
    api.getActiveSurge(sessionId).then(setActive).catch(console.error);
  }, [sessionId, turn?.turnNumber, activeOverride]);

  const close = () => { setDismissed(true); onDismiss?.(); };

  // 폰이 울리다가, 탭 없이 잠시 후 자동으로 재현의 메시지로 넘어간다
  useEffect(() => {
    if (phase !== 'phone' || !active?.canBuy || dismissed) return undefined;
    const t = setTimeout(() => setPhase('chat'), 1800);
    return () => clearTimeout(t);
  }, [phase, active, dismissed]);

  const stockName = active?.displayName || '';
  const chatLines = [
    '야 자냐?',
    `<span class="em">${stockName}</span> 얘기 들었어?`,
    '사촌이 그러는데 내일 완전 터진다던데 ㄷㄷ',
    '나만 알고 있으라 했는데... 너한테만 말해주는거야',
  ];
  const atLastLine = chatIdx === chatLines.length - 1;
  const { html, done, skip } = useTypewriter(chatLines[chatIdx], phase === 'chat');

  if (!active || !active.canBuy || dismissed) return null;

  const advanceChat = () => {
    if (!done) { skip(); return; }
    if (!atLastLine) { setChatIdx((i) => i + 1); return; }
    setPhase('decision');
  };

  const qty = Number(quantity) || 0;
  const estAmount = Math.round(active.buyPrice * qty);

  const buy = async () => {
    try {
      if (onBuy) await onBuy(active.surgeStockId, estAmount);
      else await api.buySurge(sessionId, active.surgeStockId, estAmount);
      setBought({ qty, amount: estAmount });
      setPhase('bought');
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="cutscene-overlay">
      <div className="game-frame surge-frame">
        <div className="title-plate">★ EVENT · 급등주 정보 ★</div>
        <div className="surge-stage" />

        {phase === 'phone' && (
          <div className="surge-phone-wrap ringing">
            <div className="surge-phone-glow" />
            <div className="surge-ring-waves"><span /><span /><span /></div>
            <img src="/game/assets/phone.png" alt="phone" />
            <div className="surge-phone-screen">
              <div className="surge-notif-banner show">
                <div className="surge-notif-icon">💬</div>
                <div className="surge-notif-body">
                  <div className="surge-notif-name">{FRIEND.name}</div>
                  <div className="surge-notif-preview">야 이거 봐봐... ㄷㄷ</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {phase === 'chat' && (
          <div className="narration" onClick={advanceChat}>
            <div className="nar-head">
              <div className="nar-portrait">{FRIEND.avatar}</div>
              <span className="nar-name">{FRIEND.name}</span>
              <span className="nar-tag">친구</span>
            </div>
            <div className="nar-body">
              <span dangerouslySetInnerHTML={{ __html: html }} />
              {!done && <span className="cursor" />}
            </div>
          </div>
        )}

        {phase === 'decision' && (
          <>
            <div className="surge-tip-card">
              <div className="surge-tip-head">
                <span className="surge-tip-name">{active.displayName}</span>
                <span className="surge-hot-tag">떡상예감</span>
              </div>
              <div className="surge-tip-sub">{FRIEND.name} (친구) · 대화방에서 공유됨</div>
              <div className="surge-tip-divider" />
              <div className="surge-tip-row"><span className="k">현재가</span><span className="v gold">{won(active.buyPrice)}</span></div>
              <div className="surge-tip-row"><span className="k">매수 가능 시간</span><span className="v">오늘 하루만</span></div>
              <p className="surge-tip-warn">
                "내일 <span className="em">{active.displayName}</span> 터진다던데..."{' '}
                <span className="red">친구 말이라고 다 믿을 건 아니다</span>. 판단은 내 몫이다.
              </p>
              <div className="surge-qty-row">
                <label>매수 수량</label>
                <input
                  type="number" min="0" step="1" value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
              <div className="surge-est-row">예상 매수금액 <b>{won(estAmount)}</b></div>
            </div>

            <div className="choice-strip pair">
              <button className="choice-btn gold" disabled={!(qty > 0)} onClick={buy}>
                <span className="num">［ 1 ］</span>
                <span className="text">매수한다</span>
              </button>
              <button className="choice-btn" onClick={() => setPhase('watched')}>
                <span className="num">［ 2 ］</span>
                <span className="text">관망한다</span>
              </button>
            </div>
            {error && <p className="error-text">{error}</p>}
          </>
        )}

        {phase === 'bought' && bought && (
          <div className="narration">
            <div className="nar-head">
              <div className="nar-portrait">📈</div>
              <span className="nar-name">시스템</span>
              <span className="nar-tag">PENDING</span>
            </div>
            <div className="nar-body">
              <span className="em">{active.displayName}</span> {bought.qty}주, {won(bought.amount)}어치를 매수했다.
              결과는 <span className="em">다음 턴</span>에 공개된다...
            </div>
            <div className="nar-next" onClick={close}>▶ 확인</div>
          </div>
        )}

        {phase === 'watched' && (
          <div className="narration">
            <div className="nar-head">
              <div className="nar-portrait">{FRIEND.avatar}</div>
              <span className="nar-name">{FRIEND.name}</span>
              <span className="nar-tag">친구</span>
            </div>
            <div className="nar-body">
              {FRIEND.name}의 메시지를 <span className="em">무시했다.</span> 친구 말이라고 굳이 움직일 필요는 없었다.
            </div>
            <div className="nar-next" onClick={close}>▶ 확인</div>
          </div>
        )}

        <div className="crt" />
      </div>
    </div>
  );
}

/** 다음 턴 급등주 정산 결과 팝업. resultOverride/onDismiss는 [개발용] 미리보기 전용. */
export function SurgeResultPopup({ resultOverride, onDismiss } = {}) {
  const { surgeResults, dismissSurgeResults } = useGameStore();
  const r = resultOverride || surgeResults[0];
  if (!r) return null;
  const gain = r.pnl >= 0;
  const cls = gain ? 'gain' : 'loss';
  const stressCls = r.stressDelta < 0 ? 'down' : r.stressDelta > 0 ? 'up' : '';

  return (
    <div className="cutscene-overlay">
      <div className="game-frame surge-frame">
        <div className="title-plate">★ EVENT · 급등주 결과 ★</div>
        <div className="surge-stage" />

        <div className="surge-result-card">
          <div className="surge-rc-head">
            <div className={`surge-rc-icon ${cls}`}>{gain ? '📈' : '📉'}</div>
            <div className="surge-rc-title">급등주 결과</div>
            <div className="surge-rc-sub">{r.displayName} · 자동 매도 정산</div>
          </div>
          <div className="surge-rc-row"><span className="k">수익률</span><span className={`v ${cls}`}>{signed(r.returnRate)}</span></div>
          <div className="surge-rc-row"><span className="k">손익</span><span className={`v ${cls}`}>{r.pnl >= 0 ? '+' : ''}{won(r.pnl)}</span></div>
          <div className="surge-rc-row"><span className="k">스트레스 변화</span><span className={`v ${stressCls}`}>{r.stressDelta > 0 ? '+' : ''}{r.stressDelta}</span></div>
          <div className="surge-rc-row result">
            <span className="k">결과</span>
            <span className={`v ${cls}`}>{OUTCOME_LABEL[r.outcome] || (gain ? '수익을 실현했다.' : '손실을 봤다.')}</span>
          </div>
        </div>

        <button className="surge-confirm-btn" onClick={() => (resultOverride ? onDismiss?.() : dismissSurgeResults())}>
          <span className="arr">▶</span>확인
        </button>

        <div className="crt" />
      </div>
    </div>
  );
}

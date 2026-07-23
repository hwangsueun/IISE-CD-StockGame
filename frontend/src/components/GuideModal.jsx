// 게임 가이드 모달: 상단 상태바 스탯 의미 + 게임 목표를 한 화면에 정리.
// 메인화면 상태바의 ? 버튼(StatusBar)에서 openModal('guide')로 연다.
import Modal from './Modal';

const STATS = [
  { ic: '♥', cls: 'trust-ic', name: '신뢰도',
    desc: '빚을 갚을 능력에 대한 사채업자의 신뢰. 낮아지면 독촉전화·불이익이 심해지고, 제때 상환하면 오른다.' },
  { ic: '⚡', cls: 'stress-ic', name: '스트레스',
    desc: '높을수록 그날 뉴스를 일부 놓치고, 100이 되면 쓰러져(입원) 며칠간 투자할 수 없다. 부업·이벤트로 오른다.' },
  { ic: '₩', cls: 'gold-ic', name: '총자산 / 현금',
    desc: '총자산 = 현금 + 보유 자산 평가액. 게임의 최종 성적이다. 현금이 있어야 매수·상환·생활비를 감당한다.' },
  { ic: '☠', cls: 'stress-ic', name: '빚 상환',
    desc: '사채업자에게 갚은 빚. 20일마다 상환일이 돌아오고, 이 막대를 끝까지 채우는 것이 목표다.' },
  { ic: 'DAY', cls: 'day-ic', name: '남은 일수',
    desc: '총 240일(턴). 이 안에 빚을 갚고 살아남아야 한다. 매일 「다음 날」로 하루가 지나간다.' },
];

export default function GuideModal() {
  return (
    <Modal title="게임 가이드">
      <p className="guide-intro">
        사채 빚을 <b>240일</b> 안에 갚고 살아남는 것이 목표다. 상단 상태바가 지금 내 상황을 보여준다.
      </p>
      <dl className="guide-stats">
        {STATS.map((s) => (
          <div className="guide-stat" key={s.name}>
            <span className={`guide-stat-ic ${s.cls}`}>{s.ic}</span>
            <div className="guide-stat-txt">
              <dt>{s.name}</dt>
              <dd>{s.desc}</dd>
            </div>
          </div>
        ))}
      </dl>
      <p className="guide-tip">💡 각 항목에 마우스를 올리면 간단 설명이 바로 뜬다.</p>
    </Modal>
  );
}

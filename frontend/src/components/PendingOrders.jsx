import { useEffect,useState } from 'react';
import { api } from '../api/client';
import { won } from '../utils/format';

const STATUS={pending:'다음 시가 대기',filled:'체결',partial:'일부 체결',cancelled:'취소',rejected:'미체결'};
const REASON={no_open_price:'시가 없음',insufficient_cash:'현금 부족',insufficient_holdings:'보유 부족',user_cancelled:'직접 취소',game_ended:'게임 종료',unfilled_remainder_cancelled:'남은 수량 취소'};
export default function PendingOrders({sessionId}){
 const [orders,setOrders]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(null);
 useEffect(()=>{api.getOrders(sessionId).then(setOrders).catch(e=>setError(e.message));},[sessionId]);
 const cancel=async id=>{setBusy(id);setError('');try{await api.cancelOrder(sessionId,id);setOrders(await api.getOrders(sessionId));}catch(e){setError(e.message);}finally{setBusy(null);}};
 return <><p>매도 주문을 먼저 처리하고 매수 주문을 다음 개장일 시가에 체결합니다. 휴장일에는 대기하며, 매수 예산을 넘는 수량은 체결하지 않습니다.</p>
  {error&&<p role="alert">{error}</p>}
  <table className="data-table" data-tutorial="order-history"><thead><tr><th>주문 턴</th><th>종목</th><th>주문</th><th>수량 / 체결</th><th>상태</th><th>체결가</th><th></th></tr></thead>
   <tbody>{(orders||[]).map(o=><tr key={o.orderId}><td>{o.decisionTurn}턴</td><td>{o.name||o.assetId}</td><td>{o.tradeType==='buy'?'매수':'매도'}</td><td>{o.quantity} / {o.filledQuantity}</td>
    <td>{STATUS[o.status]}{o.reason&&<small> · {REASON[o.reason]||o.reason}</small>}</td><td>{o.price==null?'—':won(o.price)}</td>
    <td>{o.status==='pending'&&<button disabled={busy!==null} onClick={()=>cancel(o.orderId)}>취소</button>}</td></tr>)}
    {orders?.length===0&&<tr><td colSpan="7">예약한 주문이 없습니다.</td></tr>}
   </tbody></table></>;
}

import { useEffect,useState } from 'react';
import { api } from '../api/client';
import { won } from '../utils/format';
import { ORDER_REASONS } from '../utils/orderPresentation';

const STATUS={pending:'체결 대기',filled:'체결',partial:'일부 체결',cancelled:'취소',rejected:'미체결'};
export default function PendingOrders({sessionId}){
 const [orders,setOrders]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(null);
 useEffect(()=>{api.getOrders(sessionId).then(setOrders).catch(e=>setError(e.message));},[sessionId]);
 const cancel=async id=>{setBusy(id);setError('');try{await api.cancelOrder(sessionId,id);setOrders(await api.getOrders(sessionId));}catch(e){setError(e.message);}finally{setBusy(null);}};
 return <><p>주식 주문은 다음 개장일 시가로 체결합니다. 매도 후 매수합니다. 매수 예산을 넘는 수량은 체결하지 않습니다.</p>
  <p>입원·부업 등으로 투자가 제한되면 미체결 주문은 취소됩니다. 자동 투자 주문도 같은 규칙을 따릅니다.</p>
  {error&&<p role="alert">{error}</p>}
  <table className="data-table" data-tutorial="order-history"><thead><tr><th>주문 턴</th><th>종목</th><th>주문</th><th>수량 / 체결</th><th>상태</th><th>체결가</th><th></th></tr></thead>
   <tbody>{(orders||[]).map(o=><tr key={o.orderId}><td>{o.decisionTurn}턴</td><td>{o.name||o.assetId}</td><td>{o.tradeType==='buy'?'매수':'매도'}{o.strategyVersionId && <small> · 모델 자동 투자</small>}</td><td>{o.quantity} / {o.filledQuantity}</td>
    <td>{STATUS[o.status]}{o.status==='pending'&&<small> · 다음 개장일 시가</small>}{o.reason&&<small> · {ORDER_REASONS[o.reason]||o.reason}</small>}</td><td>{o.price==null?'—':won(o.price)}</td>
    <td>{o.status==='pending'&&<button disabled={busy!==null} onClick={()=>cancel(o.orderId)}>취소</button>}</td></tr>)}
    {orders?.length===0&&<tr><td colSpan="7">예약한 주문이 없습니다.</td></tr>}
   </tbody></table></>;
}

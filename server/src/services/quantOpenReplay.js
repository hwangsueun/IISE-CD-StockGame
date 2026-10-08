const { quoteTradeAmount, affordableShares, fillOpenOrder } = require('./executionService');

// Called only after close t. No price at t+1 is passed to this planner.
function planOrders({ ranking, holdings, cash, bars, assets, topK, nDrop, turn, date }) {
  const scores=new Map(ranking.map(([id,score])=>[id,score]));
  const wasHeld=new Set(holdings.keys());
  const order=(a,b)=>(scores.get(b)??-Infinity)-(scores.get(a)??-Infinity) ||
    Number(wasHeld.has(b))-Number(wasHeld.has(a)) || a.localeCompare(b);
  const available=id=>{
    const a=assets.get(id),p=bars.get(id);
    return a && a.is_active!==false && p?.open>0 && p?.close>0 &&
      (!a.listed_from || date>=a.listed_from) && (!a.listed_to || date<=a.listed_to);
  };
  const candidates=ranking.filter(([id,score])=>Number.isFinite(score)&&!wasHeld.has(id)&&available(id))
    .slice(0,nDrop+Math.max(0,topK-holdings.size)).map(([id])=>id);
  const combined=[...holdings.keys(),...candidates].sort(order);
  const sells=candidates.length ? combined.slice(-nDrop).filter(id=>wasHeld.has(id)&&available(id)) : [];
  const buys=candidates.slice(0,Math.max(0,topK-holdings.size+sells.length));
  const budget=cash+sells.reduce((sum,id)=>sum+quoteTradeAmount('sell',bars.get(id).close,holdings.get(id).quantity),0);
  const allocation=buys.length ? Math.floor(budget/buys.length) : 0;
  const make=(id,side,quantity)=>({orderKey:`${turn}:${id}:${side}`,assetId:id,side,quantity,
    decisionTurn:turn,decisionDate:date,referencePrice:bars.get(id).close,
    cashBudget:side==='buy'?quoteTradeAmount('buy',bars.get(id).close,quantity):0,
    status:'pending',filledQuantity:0,score:scores.get(id)??null});
  return [...sells.map(id=>make(id,'sell',holdings.get(id).quantity)),
    ...buys.map(id=>[id,affordableShares(allocation,bars.get(id).close)])
      .filter(([,quantity])=>quantity>0).map(([id,quantity])=>make(id,'buy',quantity))];
}

function replayOpenQuant({turns,prices,assets,artifact,initialCash,totalTurns=240}) {
  const byDate=new Map(),lastPrices=new Map(),holdings=new Map();
  for(const p of prices){
    if(!byDate.has(p.trade_date))byDate.set(p.trade_date,new Map());
    byDate.get(p.trade_date).set(p.asset_id,{open:Number(p.open_price),close:Number(p.close_price)});
  }
  const assetMap=new Map(assets.map(a=>[a.asset_id,a]));
  const models=new Map(artifact.models.map(m=>[m.id,m]));
  let cash=initialCash,pending=[],decision=null;
  const orders=[],trades=[],history=[],decisions=[];
  for(const turn of turns){
    const date=turn.trade_date,bars=byDate.get(date)||new Map();
    for(const [id,h] of holdings){
      if(assetMap.get(id)?.listed_to && date>assetMap.get(id).listed_to){
        const price=lastPrices.get(id)||h.avgPrice,amount=quoteTradeAmount('sell',price,h.quantity);
        cash+=amount;holdings.delete(id);
        trades.push({turn:turn.turn_number,assetId:id,side:'sell',quantity:h.quantity,price,amount,reason:'delisted'});
      }
    }
    // A weekday holiday has no stock bars: keep the prior pending orders unchanged.
    if(bars.size && pending.length){
      for(const o of pending.sort((a,b)=>Number(a.side==='buy')-Number(b.side==='buy') || a.assetId.localeCompare(b.assetId))){
        if(o.decisionTurn>=turn.turn_number)throw Error('같은 턴에는 예약 주문을 체결할 수 없습니다');
        const h=holdings.get(o.assetId),a=assetMap.get(o.assetId);
        const listed=a&&(!a.listed_from||date>=a.listed_from)&&(!a.listed_to||date<=a.listed_to);
        const fill=fillOpenOrder(o,{openPrice:listed?bars.get(o.assetId)?.open:NaN,cash,
          heldQuantity:h?.quantity||0,avgPrice:h?.avgPrice||0});
        Object.assign(o,fill,{executionTurn:turn.turn_number,executionDate:date});
        if(fill.filledQuantity){
          const qty=(h?.quantity||0)+(o.side==='buy'?fill.filledQuantity:-fill.filledQuantity);
          if(!qty)holdings.delete(o.assetId);
          else holdings.set(o.assetId,{quantity:qty,avgPrice:o.side==='buy'?
            ((h?.quantity||0)*(h?.avgPrice||0)+fill.filledQuantity*fill.price)/qty:h.avgPrice,score:o.score});
          cash+=o.side==='buy'?-fill.amount:fill.amount;
          trades.push({turn:turn.turn_number,decisionTurn:o.decisionTurn,assetId:o.assetId,side:o.side,
            quantity:fill.filledQuantity,price:fill.price,amount:fill.amount,reason:'next_market_open'});
        }
      }
      pending=[];
    }
    // Valuation and the next decision happen after this day's close.
    for(const [id,p] of bars)if(p.close>0)lastPrices.set(id,p.close);
    const signal=artifact.sessions[date];
    if(bars.size && turn.turn_number<totalTurns){
      if(signal){
        const model=models.get(signal.model_id);
        if(!model||signal.signal_date!==date||model.trained_through>=date||model.available_from>date)throw Error('퀀트 모델의 학습·예측 날짜가 올바르지 않습니다');
        for(const [id,,sourceClose] of signal.ranking){
          if(assetMap.has(id)&&(!(bars.get(id)?.close>0)||Math.abs(bars.get(id).close-sourceClose)>.01))throw Error('퀀트 데이터와 게임 시세가 일치하지 않습니다');
        }
        pending=planOrders({ranking:signal.ranking,holdings,cash,bars,assets:assetMap,topK:artifact.top_k,nDrop:artifact.n_drop,turn:turn.turn_number,date});
        orders.push(...pending);
        const ranks=new Map(signal.ranking.map(([id,score],i)=>[id,{rank:i+1,score}]));
        for(const [id,h] of holdings)h.score=ranks.get(id)?.score??null;
        const ids=new Set([...holdings.keys(),...pending.filter(o=>o.side==='buy').map(o=>o.assetId)]);
        decision={status:'ready',turn:turn.turn_number,date,signalDate:date,modelId:model.id,trainedThrough:model.trained_through,
          selections:[...ids].sort((a,b)=>(ranks.get(a)?.rank??Infinity)-(ranks.get(b)?.rank??Infinity)).map(id=>({assetId:id,
            name:assetMap.get(id)?.masked_name||'이름 미등록',rank:ranks.get(id)?.rank??null,score:ranks.get(id)?.score??null,
            action:pending.find(o=>o.assetId===id)?.side==='sell'?'sell_pending':pending.find(o=>o.assetId===id)?.side==='buy'?'buy_pending':'held'}))};
      }else decision={status:'no_signal',turn:turn.turn_number,date,selections:[]};
      decisions.push(decision);
    }
    const totalAsset=cash+[...holdings].reduce((sum,[id,h])=>sum+h.quantity*(lastPrices.get(id)||h.avgPrice),0);
    history.push({turn:turn.turn_number,date,totalAsset,cash,returnRate:totalAsset/initialCash-1});
    if(decision?.turn===turn.turn_number)for(const s of decision.selections){
      const h=holdings.get(s.assetId);
      s.weight=h?h.quantity*(lastPrices.get(s.assetId)||h.avgPrice)/totalAsset:0;
    }
  }
  const last=history.at(-1),totalAsset=last?.totalAsset??initialCash;
  return {status:decision?.status||'waiting',decision,decisions,initialCash,cash,totalAsset,returnRate:totalAsset/initialCash-1,
    rebalancePending:pending.length>0,nextRebalanceTurn:(last?.turn??0)+1,
    pendingOrders:pending.map(o=>({...o,name:assetMap.get(o.assetId)?.masked_name||'이름 미등록'})),orders,trades,history,
    holdings:[...holdings].map(([id,h])=>{const price=lastPrices.get(id)||h.avgPrice;return {assetId:id,
      name:assetMap.get(id)?.masked_name||'이름 미등록',...h,price,value:price*h.quantity,weight:price*h.quantity/totalAsset,returnRate:price/h.avgPrice-1};})};
}

module.exports={replayOpenQuant,planOrders};

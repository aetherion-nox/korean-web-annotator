// Per-tab review queue. A frame may have only one unresolved batch at a time;
// matching ACCEPTED releases the next queued frame. API reviews bypass this.
export function createUnifiedManualQueue(deliver){
 const tabs=new Map();
 function state(tabId){
  if(!tabs.has(tabId))tabs.set(tabId,{active:null,pending:[]});
  return tabs.get(tabId);
 }
 function pump(tabId){
  const tab=tabs.get(tabId);
  if(!tab||tab.active||!tab.pending.length)return;
  tab.active=tab.pending.shift();
  const next=tab.active;
  void Promise.resolve().then(()=>deliver(next,next.request)).catch(()=>{});
 }
 function hasSame(item,other){return item.port===other.port&&item.operationId===other.operationId;}
 function submit(item,event){
  const tab=state(item.tabId);
  if(event.type==='MANUAL_REVIEW_REQUEST'){
   const next={...item,request:event,requestId:event.requestId};
   if(tab.active&&hasSame(tab.active,next)&&tab.active.requestId===event.requestId)return;
   if(tab.pending.some(row=>hasSame(row,next)&&row.requestId===event.requestId))return;
   tab.pending.push(next);pump(item.tabId);return;
  }
  const active=tab.active;
  if(!active||!hasSame(active,item)||active.requestId!==event.requestId)return;
  if(event.type==='MANUAL_REVIEW_ERROR'){
   void Promise.resolve().then(()=>deliver(active,event)).catch(()=>{});
  }else if(event.type==='MANUAL_REVIEW_ACCEPTED'){
   // The source frame and the central panel must process acceptance before
   // another frame can overwrite the one visible manual review panel.
   void Promise.resolve().then(()=>deliver(active,event)).catch(()=>{}).finally(()=>{
    if(tab.active===active){tab.active=null;pump(item.tabId);}
   });
  }
 }
 function drop(item){
  const tab=tabs.get(item.tabId);if(!tab)return;
  tab.pending=tab.pending.filter(row=>!hasSame(row,item));
  if(tab.active&&hasSame(tab.active,item)){
   const old=tab.active;tab.active=null;
   void Promise.resolve().then(()=>deliver(old,{type:'MANUAL_REVIEW_CANCELLED',
    requestId:old.requestId,operationId:old.operationId})).catch(()=>{}).finally(()=>pump(item.tabId));
  }else if(!tab.active)pump(item.tabId);
 }
 function active(tabId,frameId,operationId,requestId){
  const item=tabs.get(tabId)?.active;
  return item&&item.frameId===frameId&&item.operationId===operationId&&
   item.requestId===requestId?item:null;
 }
 return {submit,drop,active,stats:tabId=>({
  active:tabs.get(tabId)?.active?.requestId||null,
  queued:tabs.get(tabId)?.pending.length||0
 })};
}

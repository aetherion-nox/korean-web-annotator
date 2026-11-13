// Assemble a single dictionary/LLM run across independent frame sources.
// Each frame keeps its original DOM and operationId; only the worker sees the
// merged sentence IDs, origin context and shared manual/model batches.
export function createMergedFrameReviewCoordinator({run,createSession}){
 const groups=new Map();
 const key=(part,id)=>'f'+part.frameId+'_s'+id;
 function open(id,tabId){
  if(typeof id!=='string'||!id||!Number.isInteger(tabId)||groups.has(id))
   throw Error('Invalid or duplicate merged-frame review group');
  const group={id,tabId,parts:[],closed:false,controller:new AbortController(),
   session:null,runPromise:null,finished:false};
  groups.set(id,group);return group;
 }
 function join(id,part){
  const group=groups.get(id);
  if(!group||group.closed||group.controller.signal.aborted)
   throw Error('Merged-frame batch already closed; start a new page review');
  if(part.tabId!==group.tabId||!Number.isInteger(part.frameId)||
     !part.port||!part.message||typeof part.operationId!=='string')
   throw Error('Invalid merged-frame participant');
  if(!Array.isArray(part.message.sentences))throw Error('Invalid frame sentences');
  if(group.parts.some(existing=>existing.frameId===part.frameId))
   throw Error('Frame already registered in merged batch');
  group.parts.push(part);
  return {joined:true,count:group.parts.length};
 }
 function send(part,event){
  try{part.port.postMessage({...event,operationId:part.operationId});}
  catch{/* A navigated/unloaded frame cannot accept old DOM changes. */}
 }
 function broadcast(group,event){
  if(event.type==='RESULTS'){
   const byPart=new Map();
   for(const result of event.results||[]){
    const owner=group.owners.get(result.id);
    if(!owner)continue;
    const rows=byPart.get(owner.part)||[];
    rows.push({...result,id:owner.id});byPart.set(owner.part,rows);
   }
   for(const [part,results] of byPart)send(part,{...event,results});
   return;
  }
  if(['MANUAL_REVIEW_PLAN','MANUAL_REVIEW_REQUEST','MANUAL_REVIEW_ERROR','MANUAL_REVIEW_ACCEPTED'].includes(event.type)){
   if(group.host)send(group.host,event);
   return;
  }
  for(const part of group.parts)send(part,event);
 }
 function mergedPayload(group){
  const owners=new Map(),sentences=[],contextPieces=[];
  const modes=group.parts[0]?.message?.modes||{hanja:true,loanword:true};
  for(const part of group.parts){
   const p=part.message;
   if(Boolean(p.modes?.hanja)!==Boolean(modes.hanja)||
      Boolean(p.modes?.loanword)!==Boolean(modes.loanword))
    throw Error('Inconsistent annotation mode across frames');
   if(!p.sentences.length)continue;
   const localContext=typeof p.context==='string'&&p.context?
    p.context:p.sentences.map(sentence=>sentence.text).join('\n');
   // Distinct frame contexts are explicitly separated: never pretend that
   // unrelated article/advertorial paragraphs are adjacent sentences.
   contextPieces.push('【iframe '+part.frameId+' 独立文本】\n'+localContext);
   for(let i=0;i<p.sentences.length;i++){
    const sentence=p.sentences[i];
    const canonical=key(part,i);
    owners.set(canonical,{part,id:sentence.id});
    sentences.push({...sentence,id:canonical});
   }
  }
  group.owners=owners;
  return {...group.parts[0].message,operationId:group.id,
   sentences,context:contextPieces.join('\n\n')};
 }
 function finalize(id){
  const group=groups.get(id);
  if(!group)return Promise.resolve({missing:true});
  if(group.runPromise)return group.runPromise;
  group.closed=true;
  group.host=group.parts.find(p=>p.frameId===0)||group.parts[0];
  if(!group.host){
   groups.delete(id);return Promise.resolve({empty:true});
  }
  let message;
  try{message=mergedPayload(group);}
  catch(error){
   broadcast(group,{type:'ERROR',operationId:id,error:error.message});
   groups.delete(id);return Promise.resolve({error:error.message});
  }
  if(!message.sentences.length){
   broadcast(group,{type:'DONE',operationId:id,stats:{},completedSentences:0,totalSentences:0,percent:100});
   groups.delete(id);return Promise.resolve({empty:true});
  }
  group.session=createSession({operationId:id,post:event=>broadcast(group,event),
   signal:group.controller.signal});
  group.runPromise=Promise.resolve().then(()=>
   run(message,event=>broadcast(group,event),group.controller.signal,group.session)
  ).catch(error=>{
   if(!group.controller.signal.aborted)
    broadcast(group,{type:'ERROR',operationId:id,error:error.message});
   return {error:error.message};
  }).finally(()=>{group.finished=true;groups.delete(id);});
  return group.runPromise;
 }
 function respond(id,part,message){
  const group=groups.get(id);
  if(!group||!group.session||!group.host||
     group.host.port!==part.port||group.finished)return false;
  return group.session.submit({...message,operationId:id});
 }
 function detach(id,part){
  const group=groups.get(id);if(!group)return;
  if(group.finished)return;
  // Running a shared analysis against a navigated frame could misapply
  // annotations. Abort the full group rather than silently losing one frame.
  group.controller.abort();
  for(const other of group.parts)if(other.port!==part.port)
   send(other,{type:'ERROR',operationId:id,error:'合并审核的某个子框架已断开连接，整批已安全取消；请重新执行整页分析。'});
  groups.delete(id);
 }
 function abort(id,reason='Shared page review cancelled'){
  const group=groups.get(id);
  if(!group)return;
  group.controller.abort(reason);
  for(const part of group.parts)send(part,{type:'ERROR',operationId:id,error:reason});
  groups.delete(id);
 }
 return {open,join,finalize,respond,detach,abort,
  state:id=>{const g=groups.get(id);return g?{joined:g.parts.length,closed:g.closed,
   frames:g.parts.map(p=>p.frameId),host:g.host?.frameId}:null;}};
}

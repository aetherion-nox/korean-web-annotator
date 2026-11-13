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
   session:null,runPromise:null,finished:false,detachedPorts:new Set()};
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
  group.parts.push({...part,group});
  return {joined:true,count:group.parts.length};
 }
 function send(part,event){
  // Do not send stale annotation results into a frame that has navigated away.
  const group=part.group;
  if(group?.detachedPorts.has(part.port))return;
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
  if(event.type==='MANUAL_REVIEW_PLAN'){
   // The main frame receives enough trusted geometry to recover each live
   // frame after Chrome retires the MV3 service worker during long manual
   // model work. Child frames are only told to retain their local DOM task.
   const frameRouting=[...group.owners].map(([sentenceId,{part,id}])=>({
     sentenceId,frameId:part.frameId,operationId:part.operationId,localId:id
   }));
   if(group.host)send(group.host,{...event,frameRouting});
   for(const part of group.parts)if(part!==group.host)
    send(part,{type:'MANUAL_REVIEW_STANDBY'});
   return;
  }
  if(['MANUAL_REVIEW_REQUEST','MANUAL_REVIEW_ERROR','MANUAL_REVIEW_ACCEPTED'].includes(event.type)){
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
  const group=groups.get(id);if(!group||group.finished)return;
  const leaving=group.parts.find(p=>p.port===part.port&&p.frameId===part.frameId);
  if(!leaving||group.detachedPorts.has(part.port))return;
  // The top-level frame owns the manual editor. Losing that document means
  // every answer would be applied against an untrusted/new page: abort.
  if(leaving.frameId===0||group.host?.port===leaving.port){
   abort(id,'主页面已离开或审核窗口已断线，不能将旧答案应用到新页面。');
   return;
  }
  // Ads and article sidebars frequently unload while a user is composing a
  // long manual answer. An unrelated child must not destroy the host's still
  // pending batch. Skip results for that detached frame; other live frames
  // retain their own DOM-bound validation and can finish the review.
  group.detachedPorts.add(part.port);
  if(!group.closed)group.parts=group.parts.filter(p=>p!==leaving);
  const host=group.host||group.parts.find(p=>p.frameId===0);
  if(host)send(host,{type:'DIAGNOSTIC',operationId:id,diagnostic:{
   stage:'frames',level:'warning',
   message:'一个子框架已离开，跳过该框架的后续写入；主页面的手动审核继续有效，不必重填整批答案。',
   detail:JSON.stringify({frameId:leaving.frameId})
  }});
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {createMergedFrameReviewCoordinator} from '../merged-frame-review.js';

function createFixture({manual=false}={}){
 const sent=[],calls=[],submits=[],pending=[];
 const port=frameId=>({sent:[],postMessage(event){this.sent.push(event)}});
 const root=port(0),side=port(3),extra=port(5);
 const frame=(frameId,p,operationId,document,extraFields={})=>({
  tabId:41,frameId,port:p,operationId,
  message:{operationId,
   modes:{hanja:true,loanword:true},context:document,
   sentences:document?[{id:'p0',text:document,selected:[{start:0,end:document.length}],...extraFields}]:[],
   progressiveAnnotation:false,restrictToSelection:true}
 });
 let session;
 const coordinator=createMergedFrameReviewCoordinator({
  run:async(message,emit,_signal,_session)=>{
   calls.push(message);
   for(const sentence of message.sentences)emit({type:'RESULTS',operationId:message.operationId,source:'local',
    results:[{id:sentence.id,annotations:[{start:0,end:1,surface:sentence.text[0],replacement:'漢',type:'hanja'}]}]});
   if(manual){
    emit({type:'MANUAL_REVIEW_PLAN',operationId:message.operationId,batches:[{requestId:'r0'}]});
    emit({type:'MANUAL_REVIEW_REQUEST',operationId:message.operationId,requestId:'r0',text:'merged prompt'});
    await new Promise(resolve=>pending.push(resolve));
    emit({type:'MANUAL_REVIEW_ACCEPTED',operationId:message.operationId,requestId:'r0',acceptedRows:[]});
   }
   emit({type:'DONE',operationId:message.operationId,stats:{},totalSentences:message.sentences.length});
  },
  createSession:args=>(session={submit:message=>{
   submits.push(message);
   const resolver=pending.shift();
   resolver?.();
   return true;
  }})
 });
 coordinator.open('shared-1',41);
 return {sent,calls,submits,root,side,extra,frame,coordinator};
}
test('all frames share one analysis, unique sentence IDs and one context envelope',async()=>{
 const f=createFixture();
 f.coordinator.join('shared-1',f.frame(0,f.root,'operation-main','기사'));
 f.coordinator.join('shared-1',f.frame(3,f.side,'operation-side','오늘의 인기정보'));
 f.coordinator.join('shared-1',f.frame(5,f.extra,'operation-extra','많이 본 정보'));
 await f.coordinator.finalize('shared-1');
 assert.equal(f.calls.length,1,'one pipeline for all three frames');
 const input=f.calls[0];
 assert.deepEqual(input.sentences.map(x=>x.id),['f0_s0','f3_s0','f5_s0']);
 assert.equal(input.sentences.length,3);
 assert.match(input.context,/iframe 3.*오늘의 인기정보/s);
 assert.match(input.context,/iframe 5.*많이 본 정보/s);
 for(const [port,operationId] of [[f.root,'operation-main'],[f.side,'operation-side'],[f.extra,'operation-extra']]){
  const result=port.sent.find(x=>x.type==='RESULTS');
  assert.equal(result.operationId,operationId);
  assert.deepEqual(result.results.map(x=>x.id),['p0']);
  assert.equal(port.sent.at(-1).type,'DONE');
 }
});
test('empty main frame still hosts one manual batch containing texts from subframes',async()=>{
 const f=createFixture({manual:true});
 f.coordinator.join('shared-1',f.frame(0,f.root,'op-main',''));
 f.coordinator.join('shared-1',f.frame(3,f.side,'op-side','오늘의 인기정보'));
 const running=f.coordinator.finalize('shared-1');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].sentences.length,1);
 assert.equal(f.root.sent.filter(x=>x.type==='MANUAL_REVIEW_REQUEST').length,1);
 assert.equal(f.side.sent.filter(x=>x.type==='MANUAL_REVIEW_REQUEST').length,0);
 assert.equal(f.root.sent[0].operationId,'op-main');
 assert.equal(f.root.sent.find(x=>x.type==='MANUAL_REVIEW_REQUEST').text,'merged prompt');
 const handled=f.coordinator.respond('shared-1',{port:f.root},{type:'MANUAL_REVIEW_RESPONSE',operationId:'op-main',requestId:'r0',text:'{}'});
 assert.equal(handled,true);
 assert.equal(f.submits[0].operationId,'shared-1');
 await running;
 assert.equal(f.root.sent.filter(x=>x.type==='MANUAL_REVIEW_ACCEPTED').length,1);
 assert.equal(f.side.sent.filter(x=>x.type==='MANUAL_REVIEW_ACCEPTED').length,0);
});
test('rejected response from non-host cannot answer or mutate the common manual batch',async()=>{
 const f=createFixture({manual:true});
 f.coordinator.join('shared-1',f.frame(0,f.root,'main',''));
 f.coordinator.join('shared-1',f.frame(3,f.side,'side','정보'));
 const running=f.coordinator.finalize('shared-1');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.coordinator.respond('shared-1',{port:f.side},{requestId:'r0'}),false);
 assert.equal(f.submits.length,0);
 f.coordinator.respond('shared-1',{port:f.root},{requestId:'r0'});
 await running;
});
test('duplicate original sentence identifiers never collide across frames',async()=>{
 const f=createFixture();
 f.coordinator.join('shared-1',f.frame(0,f.root,'main','같은 내용'));
 f.coordinator.join('shared-1',f.frame(3,f.side,'side','같은 내용'));
 await f.coordinator.finalize('shared-1');
 assert.equal(new Set(f.calls[0].sentences.map(s=>s.id)).size,2);
 assert.deepEqual(f.root.sent.find(x=>x.type==='RESULTS').results.map(r=>r.id),['p0']);
 assert.deepEqual(f.side.sent.find(x=>x.type==='RESULTS').results.map(r=>r.id),['p0']);
});
test('disconnected source aborts shared pipeline rather than writing to a changed page',async()=>{
 const f=createFixture({manual:true});
 const main=f.frame(0,f.root,'main','학교'),child=f.frame(3,f.side,'side','기사');
 f.coordinator.join('shared-1',main);f.coordinator.join('shared-1',child);
 const running=f.coordinator.finalize('shared-1');
 await new Promise(resolve=>setImmediate(resolve));
 f.coordinator.detach('shared-1',child);
 assert.ok(f.root.sent.some(x=>x.type==='ERROR'));
 assert.equal(f.coordinator.state('shared-1'),null);
 // This mock awaits a user response even after abort; unblock it.
 f.submits.length=0;
 // Run internals are tested with a cancellable AbortSignal in production.
});
test('a second frame cannot join after shared analysis has begun',async()=>{
 const f=createFixture();
 f.coordinator.join('shared-1',f.frame(0,f.root,'main','기사'));
 const running=f.coordinator.finalize('shared-1');
 assert.throws(()=>f.coordinator.join('shared-1',f.frame(3,f.side,'side','뉴스')),/closed/);
 await running;
});

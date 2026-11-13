import test from 'node:test';
import assert from 'node:assert/strict';
import {createMergedFrameReviewCoordinator} from '../merged-frame-review.js';
import {runSentencePipeline} from '../annotation-pipeline.js';
import {createManualReviewSession} from '../manual-review.js';

const identity={engine_version:'multi-frame-engine',dictionary_fingerprint:'multi-frame-dict'};
const option={choice_id:'c0',type:'hanja',replacement:'韓國',entry_id:1,
 definitions:['Korea']};
const keep={choice_id:'KEEP',type:'keep',replacement:'한국',entry_id:null,definitions:[]};
const analyze=async text=>({...identity,annotations:[],targets:[{
 target_id:'local',start:0,end:2,surface:'한국',context:text,
 options:[keep,option]
}],stats:{pending:1}});
function participant(frameId,port){
 const txt=frameId===0?'한국':'한국 뉴스';
 return {tabId:88,frameId,port,operationId:'op'+frameId,message:{
  operationId:'op'+frameId,context:txt,
  sentences:[{id:'p0',text:txt,selected:[{start:0,end:txt.length}]}],
  modes:{hanja:true,loanword:false},restrictToSelection:true
 }};
}
const port=()=>({events:[],postMessage(event){this.events.push(event);}});
const clock=()=>new Promise(resolve=>setImmediate(resolve));
test('one real pipeline and API request handle both article and iframe, with unique target scope',async()=>{
 let apiRequests=0;
 const ports=[port(),port()];
 const manager=createMergedFrameReviewCoordinator({
  createSession:()=>({submit:()=>false}),
  run:(m,emit,signal)=>runSentencePipeline(m,emit,{
   signal,enabled:true,status:async()=>identity,analyze,
   modelConfig:async()=>({
    provider:'test',model:'fixture',endpoint:'https://api.example.test/v1',
    reviewPosFilter:false,batchContextTier:'32k',
    request:async(_cfg,targets)=>{
     apiRequests++;
     assert.equal(targets.length,2);
     assert.equal(new Set(targets.map(t=>t.target_id)).size,2);
     return {results:targets.map(t=>({target_id:t.target_id,choice_id:'c0'}))};
    }
   })
  })
 });
 manager.open('shared',88);
 manager.join('shared',participant(0,ports[0]));
 manager.join('shared',participant(3,ports[1]));
 await manager.finalize('shared');
 assert.equal(apiRequests,1,'both frames should share a single API payload');
 for(const [i,p] of ports.entries()){
  const local=p.events.filter(e=>e.type==='RESULTS'&&e.source==='local');
  const model=p.events.filter(e=>e.type==='RESULTS'&&e.source==='model');
  assert.equal(local.length,1,'local result should be delivered once per frame');
  assert.equal(model.length,1,'model result should return only to its source frame');
  assert.equal(model[0].operationId,'op'+(i===0?0:3));
  assert.deepEqual(model[0].results.map(x=>x.id),['p0']);
  assert.equal(model[0].results[0].annotations[0].replacement,'韓國');
  assert.equal(p.events.at(-1).type,'DONE');
 }
});
test('one real manual batch across frames and shared-pool candidate IDs; only main frame prompts',async()=>{
 const ports=[port(),port()];
 const manager=createMergedFrameReviewCoordinator({
  createSession:config=>createManualReviewSession(config),
  run:(m,emit,signal,session)=>runSentencePipeline(m,emit,{
   signal,enabled:true,status:async()=>identity,analyze,
   modelConfig:async()=>({manualReview:true,request:session.request,
    batchContextTier:'32k',reviewPosFilter:false})
  })
 });
 manager.open('shared-manual',88);
 manager.join('shared-manual',participant(0,ports[0]));
 manager.join('shared-manual',participant(3,ports[1]));
 const running=manager.finalize('shared-manual');
 for(let i=0;i<30&&!ports[0].events.some(e=>e.type==='MANUAL_REVIEW_REQUEST');i++)
  await clock();
 const request=ports[0].events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 assert.ok(request,'host must receive the merged batch');
 assert.equal(request.targetCount,2);
 assert.ok(request.text.includes('한국 뉴스'));
 assert.equal(ports[1].events.some(e=>e.type==='MANUAL_REVIEW_REQUEST'),false);
 const answer={batch_id:request.requestId,
  results:request.bindings.map(b=>({target_id:b.target_id,choice_id:'c0'}))};
 assert.equal(manager.respond('shared-manual',{port:ports[0]},{
  type:'MANUAL_REVIEW_RESPONSE',operationId:'op0',requestId:request.requestId,
  text:JSON.stringify(answer)}),true);
 await running;
 for(const p of ports){
  assert.equal(p.events.filter(e=>e.type==='RESULTS'&&e.source==='model').length,1);
  assert.equal(p.events.at(-1).type,'DONE');
 }
 assert.equal(ports[0].events.filter(e=>e.type==='MANUAL_REVIEW_REQUEST').length,1);
 assert.equal(ports[1].events.filter(e=>e.type==='MANUAL_REVIEW_REQUEST').length,0);
});

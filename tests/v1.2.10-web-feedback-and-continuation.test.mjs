import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {literalOriginOption} from '../experimental-options.js';
import {projectAnnotation} from '../local-engine.js';
import {reviewTargets} from '../choice-review.js';
import {runSentencePipeline} from '../annotation-pipeline.js';
import {buildReviewPayload} from '../review-payload.js';

const kept=surface=>({choice_id:null,type:'keep',replacement:surface,entry_id:null,definitions:[]});
const row=(surface,start=0,context=surface,id='t0')=>({
 target_id:id,surface,start,end:start+surface.length,context,options:[kept(surface)]
});
test('web direct-origin mixed literals convert only true stem while preserving any Korean anchor',()=>{
 const options={experimentalHanja:true,experimentalLoanword:true,hanjaReadingCheck:false};
 for(const [surface,choice,expectedSource,expectedOrigin] of [
  ['터부도','taboo도','터부','taboo'],
  ['금기도','禁忌도','금기','禁忌'],
  ['재확인도','재確認도','확인','確認'],
  ['우리컴퓨터는','우리computer는','컴퓨터','computer']
 ]){
  const t=row(surface),option=literalOriginOption(t,choice,options);
  assert.ok(option,surface+' -> '+choice);
  const spans=projectAnnotation(t.context,{...t,...option});
  assert.equal(spans.length,1);
  assert.deepEqual([spans[0].surface,spans[0].replacement],[expectedSource,expectedOrigin]);
 }
 assert.equal(literalOriginOption(row('터부도'),'taboo가',options),null,
  'must reject a Hangul anchor absent from the exact source');
});
test('invalid origin history displays each rejected answer and reason and stops A-B-A loops',async()=>{
 const t=row('터부'),history=new Map(),feedback=new Map(),requests=[];
 const wrong=['_taboo','_gamer','_taboo'];
 const result=await reviewTargets({
  enableModelReview:true,experimentalLoanword:true,
  provider:'custom',model:'test-a',endpoint:'https://example.test/v1',
  retryHistoryFeedback:true,rejectedChoiceHistory:history,rejectedChoiceFeedback:feedback,
  request:async(config,wire)=>{
   const payload=buildReviewPayload(config.context||'',[...wire],config).payload;
   requests.push({target:payload.targets[0],choice:wrong[requests.length]});
   return {results:[{t:wire[0].target_id,c:wrong[requests.length-1]}]};
  }
 },[t]);
 assert.equal(result.unresolved.length,1);
 assert.equal(requests.length,3,'do not submit A a fourth time after repeated invalid A');
 assert.equal(requests[0].target.rejected_choices,undefined);
 assert.equal(requests[1].target.rejected_choices[0].c,'_taboo');
 assert.ok(requests[1].target.rejected_choices[0].reason);
 assert.deepEqual(requests[2].target.rejected_choices.map(x=>x.c),['_taboo','_gamer']);
});
test('new model can see prior rejected origins but is allowed to make a fresh decision',async()=>{
 const t=row('터부'),history=new Map(),feedback=new Map();
 const common={enableModelReview:true,experimentalLoanword:true,retryHistoryFeedback:true,
  rejectedChoiceHistory:history,rejectedChoiceFeedback:feedback,endpoint:'https://example.test/v1'};
 await reviewTargets({...common,provider:'custom',model:'first',firstPassOnly:true,
  request:async(_,wire)=>({results:[{t:wire[0].target_id,c:'_taboo'}]})},[t]);
 let seen;
 const second=await reviewTargets({...common,provider:'custom',model:'second',firstPassOnly:true,
  request:async(config,wire)=>{
   seen=buildReviewPayload(config.context||'',wire,config).payload.targets[0].rejected_choices;
   return {results:[{t:wire[0].target_id,c:null}]};
  }},[t]);
 assert.equal(second.unresolved.length,0);
 assert.equal(seen[0].c,'_taboo');
});
const context='경제 문화';
const identity={engine_version:'web-v1210-test',dictionary_fingerprint:'fixture',dictionary_metadata:{}};
const analyze=async()=>({...identity,annotations:[],targets:[
 {target_id:'original-a',start:0,end:2,surface:'경제',context,options:[kept('경제'),
  {choice_id:'c0',type:'hanja',replacement:'經濟',entry_id:1,definitions:['economy']}]},
 {target_id:'original-b',start:3,end:5,surface:'문화',context,options:[kept('문화'),
  {choice_id:'c0',type:'hanja',replacement:'文化',entry_id:2,definitions:['culture']}]}
],stats:{pending:2,local_determined:0}});
const base={operationId:'web-v1210',sentences:[{id:'s1',text:context}],context,
 modes:{hanja:true,loanword:false},webUserContinuation:true,reviewLocalConversions:true};
const settings={provider:'custom',model:'webtest',endpoint:'https://example.test/v1',
 manualReview:false,reviewPosFilter:false,batchContextTier:'32k',
 experimentalHanja:false,experimentalLoanword:false,smartSegmentation:false,
 discardInvalidReviewResults:false,retryInvalidDictionaryChoices:true};
const later=async p=>{
 for(let i=0;i<300;i++){
  if(p())return;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 throw Error('timed out waiting for web review continuation');
};
test('web asks user after automatic budget, then explicit null saves previous valid result',async()=>{
 let release,calls=0;const events=[];const gate=new Promise(resolve=>{release=resolve});
 const task=runSentencePipeline(base,e=>events.push(e),{
  enabled:true,analyze,status:async()=>identity,cache:new Map(),persist:async()=>{},
  modelConfig:async()=>({...settings,request:async(cfg,wire)=>{
   calls++;
   const packed=buildReviewPayload(cfg.context||'',wire,cfg).payload;
   return {results:packed.targets.filter(t=>wire.find(w=>w.target_id===t.target_id)?.surface==='경제')
    .map(t=>({t:t.target_id,c:t.options[0]}))};
  }}),
  waitForUnfinishedReview:()=>gate,continuationModelConfig:async()=>settings
 });
 await later(()=>events.some(e=>e.type==='REVIEW_PAUSED'));
 assert.equal(events.find(e=>e.type==='REVIEW_PAUSED').unansweredTargets,1);
 const before=calls;
 release({mode:'null'});
 const outcome=await task;
 assert.equal(calls,before,'the explicit null action must make zero API calls');
 assert.equal(outcome.model_keep,1);
 assert.equal(outcome.model_conversion_choices,1);
 assert.equal(outcome.model_unanswered,0);
 assert.ok(events.some(e=>e.type==='RESULTS'&&e.source==='model'&&
  e.results.some(r=>r.annotations.some(a=>a.replacement==='經濟')&&r.reviewed.some(x=>x.surface==='문화'))));
 assert.ok(events.some(e=>e.type==='DONE'&&!e.reviewIncomplete));
});
test('web pooled correction groups omissions rather than retrying each source target separately',async()=>{
 const events=[];let calls=0;const samples=[];
 const done=await runSentencePipeline({...base,webUserContinuation:false,operationId:'web-pool'},e=>events.push(e),{
  enabled:true,analyze,status:async()=>identity,cache:new Map(),persist:async()=>{},
  modelConfig:async()=>({...settings,request:async(cfg,wire)=>{
   calls++;samples.push(wire.map(x=>x.surface));
   if(calls===1)return {results:[]};
   const packed=buildReviewPayload(cfg.context||'',wire,cfg).payload;
   return {results:packed.targets.map(t=>({t:t.target_id,c:t.options[0]}))};
  }})
 });
 assert.equal(calls,2);
 assert.deepEqual(samples[0],['경제','문화']);
 assert.deepEqual(samples[1],['경제','문화']);
 assert.equal(done.model_unanswered,0);
 assert.ok(events.some(e=>e.type==='DIAGNOSTIC'&&e.diagnostic?.stage==='pooled-retry'));
});
test('web UI and merged iframe protocol expose three explicit continuation choices',()=>{
 const web=readFileSync(new URL('../content.js',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../service-worker.js',import.meta.url),'utf8');
 const frames=readFileSync(new URL('../merged-frame-review.js',import.meta.url),'utf8');
 assert.match(web,/继续 API 审核/);
 assert.match(web,/切换手动审核/);
 assert.match(web,/剩余按 null 完成/);
 assert.match(web,/CONTINUE_REVIEW/);
 assert.match(worker,/waitForUnfinishedReview/);
 assert.match(frames,/continueReview\(/);
});

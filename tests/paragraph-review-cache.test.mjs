import test from 'node:test';
import assert from 'node:assert/strict';
import {runSentencePipeline} from '../annotation-pipeline.js';
import {createManualReviewSession} from '../manual-review.js';
import {paragraphReviewKey,snapshotParagraphReview,restoreParagraphReview} from '../review-cache.js';
import {AnnotationCache,canonicalStoredCacheKey,stableCacheStringify} from '../session-cache.js';
const identity={engine_version:'fixture',dictionary_fingerprint:'fixture'};
const word={target_id:'local',surface:'과학',start:0,end:2,context:'과학',options:[
 {choice_id:null,type:'keep',replacement:'과학',entry_id:null,definitions:[]},
 {choice_id:'c0',type:'hanja',replacement:'科學',entry_id:1,definitions:['science']}]};
const item=(text,id='p')=>({sentence:{id,text},localKey:'local:'+text,analysis:{targets:[word],annotations:[],repair_context:{protected_ranges:[]}},reviewableTargets:[word],result:{accepted:[{target:word,option:word.options[1]}],unresolved:[]},repairs:[]});
test('local paragraph identity ignores distant changes and temporary IDs but not neighbors, settings or selection',()=>{
 const a=['前','과학','後','추천 A'].map((t,i)=>item(t,'a'+i));
 const b=['前','과학','後','추천 B'].map((t,i)=>item(t,'b'+i));
 const key=paragraphReviewKey(a,1,'model');
 assert.equal(key,paragraphReviewKey(b,1,'model'));
 assert.notEqual(key,paragraphReviewKey(b,1,'other'));
 b[2]=item('different');
 assert.notEqual(key,paragraphReviewKey(b,1,'model'));
 assert.notEqual(key,paragraphReviewKey(a,1,'model',true));
});
test('restore uses current target and rejects malformed or incomplete cache even in discard mode',()=>{
 const x=item('과학'),saved=snapshotParagraphReview(x,false);
 assert.equal(restoreParagraphReview(x,saved,{reviewPosFilter:false}).result.accepted[0].option.replacement,'科學');
 assert.equal(restoreParagraphReview(x,{...saved,results:[{t:'local',c:'c99'}]},{discardInvalidReviewResults:true}),null);
 assert.equal(restoreParagraphReview(x,{...saved,results:[]},{}),null);
 x.cacheUnsafe=true;assert.equal(snapshotParagraphReview(x,false),null);
});
test('smart deletion is rebound to new paragraph identity and checked against current protection and selection',()=>{
 const x=item('과학','old');
 x.result={accepted:[],unresolved:[]};
 x.repairs=[{op:'delete',source_target_ids:['local'],start:0,end:2,surface:'과학',choice_id:null}];
 const saved=snapshotParagraphReview(x,true),y=item('과학','new');
 const restored=restoreParagraphReview(y,saved,{smartSegmentation:true});
 assert.equal(restored.repairs[0].sentenceKey,'new');
 assert.equal(restored.result.accepted.length,0);
 y.sentence.selected=[{start:0,end:1}];
 assert.equal(restoreParagraphReview(y,saved,{smartSegmentation:true},true),null);
});
test('experimental literal origin cache is revalidated, not an invented dictionary ID',()=>{
 const x=item('과학');x.result.accepted=[{target:word,option:{type:'hanja',choice_id:'科學',entry_id:'experimental:hanja',replacement:'科學'}}];
 const saved=snapshotParagraphReview(x,false);
 const restored=restoreParagraphReview(x,saved,{experimentalHanja:true,reviewPosFilter:false});
 // Dictionary-backed spelling or a verified literal is acceptable, never an unknown ID.
 assert.equal(restored?.result.accepted[0].option.replacement,'科學');
 assert.equal(restoreParagraphReview(x,{...saved,results:[{t:'local',c:'p999'}]},{experimentalHanja:true}),null);
});
test('pipeline does not resubmit stable paragraph after a remote recommendation changes',async()=>{
 let cache=new Map();const requests=[];
 const config={provider:'fixture',model:'fixture',endpoint:'https://example.test',reviewPosFilter:false,
  request:async(_cfg,targets)=>{
   requests.push(targets.map(t=>t.context));
   // Custom API requests still use the actual outgoing pooled identifiers.
   const {buildReviewPayload}=await import('../review-payload.js');
   const {payload}=buildReviewPayload(_cfg.context||'',targets,_cfg);
   return {results:payload.targets.map(t=>{
    const choice=t.options.find(id=>payload.candidates.some(c=>c.candidate_id===id&&c.replacement==='科學'));
    assert.ok(choice,'fixture must actually choose the pooled Hanja conversion');
    return {t:t.target_id,c:choice};
   })};
  }};
 const run=async (last,reviewConfig=config)=>runSentencePipeline({operationId:'cache-test',modes:{hanja:true},sentences:['前','과학','後',last].map((text,i)=>({id:'s'+i,text}))},()=>{},{
  enabled:true,cache,status:async()=>identity,analyze:async text=>({...identity,annotations:[],targets:text==='과학'?[word]:[],stats:{}}),modelConfig:async()=>reviewConfig
 });
 const first=await run('추천 A');assert.equal(first.model_accepted,1);assert.equal(first.model_conversion_choices,1);assert.equal(requests.length,1);
 const second=await run('추천 B');assert.equal(requests.length,1);assert.equal(second.modelCacheHits,1);assert.equal(second.model_conversion_choices,1);
 // Simulate Chrome storage serialization and a completely fresh background worker.
 const stored=Array.from(cache,([key,value])=>[key,value?.targets?{...value,targets:value.targets.map(({context,repair_context,...target})=>target)}:value]);
 cache=new AnnotationCache(JSON.parse(stableCacheStringify(stored)).map(([key,value])=>[canonicalStoredCacheKey(key),value]));
 const restarted=await run('추천 B');assert.equal(requests.length,1);assert.equal(restarted.localCacheHits,4);assert.equal(restarted.modelCacheHits,1);assert.equal(restarted.model_conversion_choices,1);
 const manual=await run('추천 B',{manualReview:true,provider:'manual',model:'manual-chat',
  endpoint:'manual://chat',reviewPosFilter:false,
  request:async()=>{assert.fail('API result should satisfy manual review');}});
 assert.equal(manual.modelCacheHits,1);
 const otherApi=await run('추천 B',{...config,provider:'other',model:'other',
  endpoint:'https://other.test',disableThinking:true});
 assert.equal(otherApi.modelCacheHits,1);
 assert.equal(requests.length,1);
});
test('validated manual answers survive a restart and can satisfy API or manual review',async()=>{
 let cache=new AnnotationCache();
 const run=async({forceRegenerate=false,expectedRequests=1,api=false}={})=>{
  const operationId='manual-cache-test',events=[];
  const signal=new AbortController().signal;
  const session=createManualReviewSession({operationId,signal,post:event=>{
   events.push(event);
   if(event.type!=='MANUAL_REVIEW_REQUEST')return;
   const results=event.bindings.map(({target_id})=>{
    const pool=Object.entries(event.choiceIndex[target_id]).find(([,choices])=>choices.includes('c0'));
    assert.ok(pool,'manual prompt must expose the Hanja conversion');
    return {t:target_id,c:pool[0]};
   });
   queueMicrotask(()=>session.submit({operationId,requestId:event.requestId,text:JSON.stringify({
    batch_id:event.requestId,results
   })}));
  }});
  const stats=await runSentencePipeline({
   operationId,modes:{hanja:true},sentences:[{id:'s',text:'과학'}],forceRegenerate
  },event=>events.push(event),{
   signal,enabled:true,cache,status:async()=>identity,
   analyze:async()=>({...identity,annotations:[],targets:[word],stats:{}}),
   modelConfig:async()=>api?{
    provider:'fixture',model:'fixture',endpoint:'https://example.test',reviewPosFilter:false,
    request:async()=>{assert.fail('Manual result should satisfy API review');}
   }:{
    provider:'manual',model:'manual-chat',endpoint:'manual://chat',
    manualReview:true,request:session.request,reviewPosFilter:false
   }
  });
  for(const type of ['MANUAL_REVIEW_PLAN','MANUAL_REVIEW_REQUEST'])
   assert.equal(events.filter(event=>event.type===type).length,expectedRequests);
  assert.equal(stats.model_conversion_choices,1);
  assert.equal(stats.modelCacheHits,1-expectedRequests);
  assert.ok(events.some(event=>event.source==='model'&&event.results[0].annotations[0]?.replacement==='科學'));
 };
 await run();
 cache=new AnnotationCache(JSON.parse(stableCacheStringify([...cache])));
 await run({expectedRequests:0});
 await run({api:true,expectedRequests:0});
 await run({forceRegenerate:true});
});

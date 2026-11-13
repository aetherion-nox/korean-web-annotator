import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewPayload,buildManualPrompt} from '../review-payload.js';
import {contextReviewBatches} from '../batch-budget.js';
import {runSentencePipeline} from '../annotation-pipeline.js';
import {reviewTargets} from '../choice-review.js';
const identity={engine_version:'test',dictionary_fingerprint:'dict'};
const target=(text='학교')=>({target_id:'t0',start:0,end:2,surface:'학교',context:text,options:[{choice_id:'KEEP',type:'keep',replacement:'학교',entry_id:null,definitions:[]},{choice_id:'c0',type:'hanja',replacement:'學校',entry_id:1,definitions:['교육 기관']}]});
test('neighbor evidence is pooled per sentence and distinguishes identical text occurrences',()=>{
 const a={...target(),adjacent_context:{before:'이전 문장.',after:'다음 문장.'}},b={...target(),target_id:'t1',adjacent_context:{before:'다른 문장.',after:''}};
 const {payload}=buildReviewPayload('',[a,{...a,target_id:'t2'},b]);
 assert.equal(payload.sentences.length,2);
 assert.deepEqual(payload.sentences[0].adjacent_context,a.adjacent_context);
 assert.deepEqual(payload.sentences[1].adjacent_context,b.adjacent_context);
 assert.equal(payload.targets[0].sentence_id,payload.targets[1].sentence_id);
 assert.notEqual(payload.targets[0].sentence_id,payload.targets[2].sentence_id);
 assert.ok(!('adjacent_context' in payload.targets[0]));
 assert.equal(payload.targets[0].start,0);assert.equal(payload.sentences[0].text,'학교');
});
test('manual and API budgets retain mandatory neighbors when full context is too large',()=>{
 const t={...target(),adjacent_context:{before:'앞 문장.',after:'뒤 문장.'}};
 for(const manual of [false,true]){
  const batches=contextReviewBatches([{result:{unresolved:[t]}}],'가'.repeat(200000),{tier:'32k',manual});
  assert.equal(batches.length,1);const batch=batches[0];assert.ok(batch.context.length<200000);
  const {payload}=buildReviewPayload(batch.context,batch.rows.map(r=>r.target));
  assert.deepEqual(payload.sentences[0].adjacent_context,t.adjacent_context);
  assert.ok(batch.budget.totalTokens<=32000);
  const prompt=buildManualPrompt(batch.context,[t],'batch');assert.ok(prompt.includes('앞 문장.'));
 }
});
test('pipeline adds model-only neighbors without polluting local cache or source offsets',async()=>{
 const cache=new Map(),requests=[],events=[];
 for(const before of ['첫 상황.','다른 상황.','다른 상황.']){
  await runSentencePipeline({operationId:'op',sentences:[{id:'s',text:'학교',adjacentContext:{before,after:'끝.'}}],context:'원문.',modes:{hanja:true}},e=>events.push(e),{
   cache,status:async()=>identity,analyze:async text=>({...identity,annotations:[],targets:[target(text)],stats:{pending:1}}),enabled:true,
   modelConfig:async()=>({batchContextTier:'32k',request:async(config,targets)=>{requests.push(targets);return {results:targets.map(t=>({t:t.target_id,c:'c0'}))};}})
  });
 }
 assert.equal(requests.length,2);assert.equal(requests[0][0].adjacent_context.before,'첫 상황.');assert.equal(requests[1][0].adjacent_context.before,'다른 상황.');
 assert.equal(requests[0][0].context,'학교');assert.equal(requests[0][0].start,0);
 const local=[...cache.values()].find(v=>v.targets);assert.ok(!local.targets[0].adjacent_context);
 const output=events.filter(e=>e.source==='model').flatMap(e=>e.results).flatMap(r=>r.annotations);
 assert.ok(output.length);assert.ok(output.every(a=>a.start===0&&a.end===2&&a.surface==='학교'));
});
test('real API serializer retains neighbor evidence after model target sanitizing',async()=>{
 const savedFetch=globalThis.fetch;let wire;
 globalThis.fetch=async(url,init)=>{wire=JSON.parse(init.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({results:[{t:'t0',c:null}]})}}]}),{headers:{'content-type':'application/json'}});};
 try{
  const t={...target(),adjacent_context:{before:'前段韩语证据',after:'后段韩语证据'}};
  const result=await reviewTargets({enableModelReview:true,provider:'deepseek',model:'fixture',endpoint:'https://example.invalid/chat/completions',logger:{start:async()=>1,finish:async()=>{}}},[t]);
  assert.equal(result.accepted.length,1);
  const payload=JSON.parse(wire.messages[1].content);assert.deepEqual(payload.sentences[0].adjacent_context,t.adjacent_context);
  assert.equal(payload.targets.length,1);assert.equal(payload.targets[0].start,0);
 }finally{globalThis.fetch=savedFetch;}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {contextReviewBatches,describeBatchBudget,normalizeOutputLimitTokens,estimateTokenCount} from '../batch-budget.js';
import {reviewTargets} from '../choice-review.js';
const keep=(surface)=>({choice_id:'KEEP',type:'keep',replacement:surface,entry_id:null,definitions:[]});
function dataset(count=418,{segments=false}={}){
 const context='문진가두 투표소에서 진행했다.';
 const targets=Array.from({length:count},(_,i)=>{
  const surface=segments?'최고인민검찰원':'문진가두';
  return {target_id:'t'+i,start:0,end:surface.length,surface,context,
   ...(segments?{segmentation_review:true}:{}),options:[keep(surface)]};
 });
 return {context,item:{sentence:{id:'s',text:context},result:{unresolved:targets}}};
}
test('512K manual review handles 418 targets as one batch without an arbitrary decision cap',()=>{
 const {context,item}=dataset();
 for(const tier of ['512k','1m']){
  const b=contextReviewBatches([item],context,{tier,manual:true});
  assert.equal(b.length,1,tier);assert.equal(b[0].rows.length,418);
  assert.equal(b[0].budget.limitReason,'end');
 }
});
test('32K still splits when real prompt plus reply exceeds the selected context',()=>{
 const {context,item}=dataset(418);
 // Identical dictionary senses are pooled once, so artificially repeated long
 // definitions still fit. Use distinct entry IDs and senses to exceed 32K.
 const heavy={...item,result:{unresolved:item.result.unresolved.map(t=>({...t,options:[
  ...t.options,{choice_id:'c0',type:'hanja',replacement:'問津歌',entry_id:100+Number(t.target_id.slice(1)),
   definitions:['词典义项语境说明'.repeat(80)+' #'+t.target_id]}
 ]}))}};
 const batches=contextReviewBatches([heavy],context,{tier:'32k',manual:true});
 assert.equal(batches.flatMap(x=>x.rows).length,418);
 assert.ok(batches.length>1);
 assert.ok(batches.every(x=>x.budget.totalTokens<=x.budget.contextTokens));
});
test('large context and a small model output limit split only on estimated reply',()=>{
 const {context,item}=dataset(100,{segments:true});
 const low=contextReviewBatches([item],context,{tier:'512k',manual:false,maxOutputTokens:2048,
  allowModelSegmentation:true,allowModelHanja:true});
 assert.ok(low.length>1);
 assert.equal(low.flatMap(x=>x.rows).length,100);
 assert.ok(low.every(x=>x.budget.outputTokens<=2048));
 assert.ok(low.every(x=>x.budget.limitReason==='output'||x.budget.limitReason==='end'));
 const high=contextReviewBatches([item],context,{tier:'512k',manual:false,maxOutputTokens:131072,
  allowModelSegmentation:true,allowModelHanja:true});
 assert.equal(high.length,1);
 assert.equal(high[0].rows.length,100);
 assert.equal(high[0].budget.outputLimit,131072);
});
test('output token allowance does not reserve an unused huge block of the context',()=>{
 const {context,item}=dataset(1);
 const ordinary=describeBatchBudget(context,item.result.unresolved,{tier:'32k',manual:false,maxOutputTokens:16384});
 const high=describeBatchBudget(context,item.result.unresolved,{tier:'32k',manual:false,maxOutputTokens:131072});
 assert.equal(ordinary.totalTokens,high.totalTokens);
 assert.equal(high.reservedOutputTokens,high.outputTokens);
 assert.ok(high.totalTokens<32000);
 assert.equal(high.outputLimit,131072);
 assert.equal(describeBatchBudget(context,item.result.unresolved,{tier:'512k',manual:true,manualOutputTokens:131072}).outputLimit,131072);
});
test('token budgets sanitize invalid values and retain old configuration defaults',()=>{
 assert.equal(normalizeOutputLimitTokens(undefined,16384),16384);
 assert.equal(normalizeOutputLimitTokens('131072',16384),131072);
 for(const invalid of [-1,0,1023,1000001,1.5,NaN,'abc'])assert.equal(normalizeOutputLimitTokens(invalid,65536),65536);
 const sandbox={};vm.createContext(sandbox);
 vm.runInContext(fs.readFileSync(new URL('../api-profiles.js',import.meta.url),'utf8'),sandbox);
 const profile=sandbox.KRA_API_PROFILES.normalizeProfile({});
 assert.equal(profile.maxOutputTokens,16384);
 assert.equal(sandbox.KRA_API_PROFILES.normalizeProfile({maxOutputTokens:131072}).maxOutputTokens,131072);
 assert.equal(sandbox.KRA_API_PROFILES.normalizeProfile({maxOutputTokens:99999999}).maxOutputTokens,16384);
});
test('API request passes the user-approved actual output ceiling to provider payload',async()=>{
 const original=globalThis.fetch;let body;
 globalThis.fetch=async(_url,request)=>{
  body=JSON.parse(request.body);
  return new Response(JSON.stringify({choices:[{index:0,finish_reason:'stop',message:{content:JSON.stringify({results:[{target_id:'t0',choice_id:'KEEP'}]})}}]}),{headers:{'content-type':'application/json'}});
 };
 try{
  const {context,item}=dataset(1);
  const budget=describeBatchBudget(context,item.result.unresolved,{tier:'512k',maxOutputTokens:131072});
  const accepted=await reviewTargets({enableModelReview:true,provider:'deepseek',model:'model',endpoint:'https://example.test/chat/completions',
   context,batchBudget:budget,logger:{start:async()=>1,finish:async()=>{}}},[item.result.unresolved[0]]);
  assert.equal(accepted.accepted.length,1);
  assert.equal(body.max_tokens,131072);
 }finally{globalThis.fetch=original;}
});

test('compact generated answer estimate excludes retired confidence and evidence fields',()=>{
 const {context,item}=dataset(120,{segments:true});
 const t=item.result.unresolved;
 const cfg={tier:'512k',manual:true,allowModelSegmentation:true,allowModelHanja:true,manualOutputTokens:65536};
 const result=describeBatchBudget(context,t,cfg);
 assert.ok(result.outputTokens>0);
 // Compare the same conservative four-segment estimate, differing only in
 // obsolete metadata. A one-segment answer is not a comparable upper bound.
 const oldLikeCurrent=JSON.stringify({batch_id:'00000000',results:t.map((target,i)=>({
  target_id:'t'+i,choice_id:'GEN_SEGMENTS',
  segments:Array.from({length:4},(_,j)=>({start:j*2,end:j*2+2,surface:target.surface.slice(j*2,j*2+2),type:'hanja',replacement:'中中'})),
  confidence:'high',evidence:'Detailed phonetic and etymological evidence supporting the proposed compound segmentation'
 }))});
 assert.ok(result.outputTokens<Math.ceil(estimateTokenCount(oldLikeCurrent)*1.1)+32);
});

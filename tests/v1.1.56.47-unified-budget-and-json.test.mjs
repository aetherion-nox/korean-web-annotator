import test from 'node:test';
import assert from 'node:assert/strict';
import {contextReviewBatches,describeBatchBudget} from '../batch-budget.js';
import {exportApiRequestBody,exportApiResponseJson,exportApiExchangeDiagnostic} from '../api-log-export.js';
import {reviewTargets} from '../choice-review.js';

function target(i){
 const surface='학교';
 return {target_id:'t'+i,start:i*3,end:i*3+surface.length,surface,context:'학교 학교',
   options:[{choice_id:null,type:'keep',replacement:surface,entry_id:null,definitions:[]},
    {choice_id:'c'+('x'.repeat(110)),type:'hanja',replacement:'學校',entry_id:1,definitions:['school']}]};
}
const targets=Array.from({length:650},(_,i)=>target(i));
const items=[{result:{unresolved:targets}}];
const common={tier:'1m',manualOutputTokenLimit:65536,apiOutputTokenLimit:16384};

test('1M manual and API both fit one request when sharing the same output ceiling',()=>{
 const manual=contextReviewBatches(items,'학교 학교',{...common,manual:true});
 const api=contextReviewBatches(items,'학교 학교',{...common,manual:false,matchManualOutputBudget:true});
 const legacy=contextReviewBatches(items,'학교 학교',{...common,manual:false,matchManualOutputBudget:false});
 assert.equal(manual.length,1);
 assert.equal(api.length,1);
 assert.ok(legacy.length>1,'an independent 16k API ceiling must still split');
 assert.equal(api[0].rows.length,targets.length);
 assert.equal(api[0].budget.outputLimit,65536);
 assert.ok(api[0].budget.requestedOutputTokens<65536,'request only the estimated output plus slack');
 assert.equal(api[0].budget.requestedOutputTokens,api[0].budget.reservedOutputTokens);
});
test('stream and nonstream use identical batches and preserve complete decisions',async()=>{
 const calls=[];
 for(const stream of [false,true]){
  const result=await reviewTargets({enableModelReview:true,model:'fixture',provider:'custom',
   endpoint:'https://fixture.test/v1',stream,manualOutputTokenLimit:65536,
   matchManualOutputBudget:true,request:async(config,rows)=>{
    calls.push({stream:config.stream,ids:rows.map(r=>r.target_id)});
    return {results:rows.map(r=>({t:r.target_id,c:null}))};
   }},targets.slice(0,8));
  assert.equal(result.accepted.length,8);
  assert.equal(result.unresolved.length,0);
 }
 assert.deepEqual(calls[0].ids,calls[1].ids);
 assert.deepEqual(calls.map(c=>c.stream),[false,true]);
});
test('download normal request/assembled answer JSON, not stream envelopes',()=>{
 const expected={results:[{t:'t0',c:'c0'}]};
 const request={model:'fixture',stream:true,messages:[{role:'user',content:'학교'}]};
 const log={id:'one',body:request,response:{raw:'data: chunk1\\n\\ndata: chunk2',parsed:expected}};
 assert.deepEqual(exportApiRequestBody(log),request);
 assert.deepEqual(exportApiResponseJson(log),expected);
 assert.ok(!('raw' in exportApiResponseJson(log)));
 assert.match(exportApiExchangeDiagnostic(log).response.raw,/chunk1/);
 assert.throws(()=>exportApiResponseJson({response:{raw:'incomplete'}}),/No complete JSON/);
});

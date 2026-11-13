import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePositionalResults,choiceFromValue} from '../positional-results.js';
import {validateChoices,validateExperimentalChoices,reviewTargets} from '../choice-review.js';
import {buildReviewPayload,buildManualPrompt,buildReviewInstructions} from '../review-payload.js';
import {createManualReviewSession} from '../manual-review.js';
import {describeBatchBudget} from '../batch-budget.js';
import {choicePreviewParser} from '../model-stream.js';

const k=(s)=>({choice_id:'KEEP',type:'keep',replacement:s,entry_id:null,definitions:[]});
function target(id,surface='한국',options=[
 k(surface),{choice_id:'c0',type:'hanja',replacement:'韓國',entry_id:5,definitions:['Korea']}
]){
 return {target_id:id,start:0,end:surface.length,surface,context:surface,options};
}
test('new protocol only: positional strings and true JSON null, never object rows',()=>{
 const targets=[target('t0'),target('t1')];
 const r=validateChoices(targets,{results:['c0',null]});
 assert.deepEqual(r.accepted.map(x=>x.option.type),['hanja','keep']);
 assert.equal(r.unresolved.length,0);
 for(const response of [
  {results:[{target_id:'t0',choice_id:'c0'},{target_id:'t1',choice_id:'KEEP'}]},
  {results:['c0']},{results:['c0',null,'c0']},
  {results:[false,null]},{results:['c0','KEEP']}
 ])assert.ok(validateChoices(targets,response).unresolved.length>0,JSON.stringify(response));
});
test('KEEP spelled as an actual Latin origin is not the null fallback',()=>{
 const t=target('t0','킵',[k('킵')]);
 const result=validateExperimentalChoices([t],{results:['KEEP']},{experimentalLoanword:true});
 assert.equal(result.accepted.length,1);
 assert.equal(result.accepted[0].option.type,'loanword');
 assert.equal(result.accepted[0].option.replacement,'KEEP');
 const native=validateExperimentalChoices([t],{results:[null]},{experimentalLoanword:true});
 assert.equal(native.accepted[0].option.type,'keep');
});
test('false can retire a safely repaired original or scan-only, but not arbitrary dictionary targets',()=>{
 const t=target('t0'),scan={...target('scan','가',[k('가')]),scan_only:true};
 const input={results:[false,false]};
 const allowed= parsePositionalResults([t,scan],input,{smartSegmentation:true,retired:new Set(['t0'])});
 assert.equal(allowed.malformed,false);assert.equal(allowed.problems.size,0);
 const rejected=parsePositionalResults([t,scan],input,{smartSegmentation:true});
 assert.equal(rejected.problems.size,1);assert.equal(rejected.problems.get(0).includes('validated repair'),true);
});
test('partial retry is indexed and never silently shifts omitted values',()=>{
 const targets=[target('a'),target('b'),target('c')];
 const missing= parsePositionalResults(targets,{partial:true,results:[[2,'c0'],[0,null]]},{allowPartial:true});
 assert.equal(missing.values.get(2),'c0');assert.equal(missing.values.get(0),null);
 assert.equal(missing.values.has(1),false);
 for(const results of [[[0,null],[0,'c0']],[[3,'c0']],[[0,'c0','extra']],[null,'c0']])
  assert.equal(parsePositionalResults(targets,{partial:true,results},{allowPartial:true}).malformed,true);
});
test('payload no longer exposes KEEP or requires target IDs outside segmentation repair mode',()=>{
 const targets=[target('t0'),target('t1')];
 const config={batchId:'batch-A',experimentalHanja:true,experimentalLoanword:true};
 const {payload}=buildReviewPayload('한국',targets,config);
 assert.equal(payload.format,'shared-pools-v4');
 assert.equal(payload.response_protocol,'positional-v1');
 assert.equal(payload.batch_id,'batch-A');
 assert.equal(payload.targets[0].target_id,undefined);
 assert.equal(payload.targets[0].options.c0,'p0');
 assert.equal(Object.hasOwn(payload.targets[0].options,'KEEP'),false);
 const text=buildManualPrompt('한국',targets,'batch-A',config);
 assert.match(text,/positional/);
 assert.doesNotMatch(text,/results\[\]\.choice_id|one \{target_id,choice_id\}|Return EXACTLY ONE \{target_id/);
 assert.doesNotMatch(text,/return KEEP|choose KEEP|KEEP maps/);
 assert.match(buildReviewInstructions(config),/JSON null/);
});
test('manual full positional array and indexed retry keep native target ordering',async()=>{
 const targets=[target('a'),target('b'),target('c')],events=[];
 const session=createManualReviewSession({operationId:'one',post:e=>events.push(e)});
 const pending=session.request({context:'한국',reviewPosFilter:false},targets);
 const request=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 assert.ok(request);
 assert.equal(session.submit({operationId:'one',requestId:request.requestId,
  text:JSON.stringify({results:['c0',null,'c0']})}),false);
 assert.equal(session.submit({operationId:'one',requestId:request.requestId,
  text:JSON.stringify({batch_id:request.requestId,partial:true,results:[[0,'c0'],[2,'c0']]})}),false);
 const retry=events.filter(e=>e.type==='MANUAL_REVIEW_ERROR').at(-1);
 assert.deepEqual(retry.invalidTargetIds,['t1']);
 assert.deepEqual(retry.acceptedRows,[[0,'c0'],[2,'c0']]);
 assert.match(retry.repairPrompt,/partial.*true/);
 assert.equal(session.submit({operationId:'one',requestId:request.requestId,
  text:JSON.stringify({batch_id:request.requestId,partial:true,results:[[1,null]]})}),true);
 const done=await pending;
 assert.deepEqual(done.results,['c0',null,'c0']);
});
test('budget reserves response-proportional tokens instead of a flat 16K',()=>{
 const targets=Array.from({length:15},(_,i)=>target('t'+i));
 const budget=describeBatchBudget('한국',targets,{tier:'128k',apiOutputTokenLimit:16384});
 assert.equal(budget.reservedOutputTokens<16384,true);
 assert.equal(budget.reservedOutputTokens>=budget.outputTokens,true);
});
test('stream parser previews correct positions with matching batch identity',()=>{
 const targets=[target('a'),target('b')],seen=[];
 const preview=choicePreviewParser(targets,a=>seen.push(a.map(x=>x.target.target_id)),'batch-A');
 preview('{"batch_id":"batch-A","results":["c0",');
 preview('null]}');
 assert.deepEqual(seen.at(-1),['a','b']);
 const invalid=[];
 const other=choicePreviewParser(targets,a=>invalid.push(a),'batch-A');
 other('{"batch_id":"another","results":["c0",null]}');
 assert.deepEqual(invalid,[[]]);
});

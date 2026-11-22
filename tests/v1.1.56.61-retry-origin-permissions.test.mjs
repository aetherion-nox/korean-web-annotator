import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reviewTargets} from '../choice-review.js';
import {buildManualPrompt,buildReviewInstructions,buildReviewPayload} from '../review-payload.js';
import {createManualReviewSession} from '../manual-review.js';

const keep=s=>({choice_id:'KEEP',type:'keep',replacement:s,entry_id:null,definitions:[]});
const hanja=(id,replacement)=>({
 choice_id:id,type:'hanja',replacement,entry_id:id,definitions:['unrelated dictionary sense']
});
const target=(id,surface,option,flags={})=>({
 target_id:id,start:0,end:surface.length,surface,context:surface,
 options:[keep(surface),option],...flags
});
const sample=()=>[
 target('original0','한국',hanja('c0','韓國')),
 target('original1','원잠',hanja('c1','元箴'),{experimental_hanja_audit:true})
];

test('API dictionary-ID retry retains Hanja-only experiment and accepts authentic direct origin',async()=>{
 const requests=[];
 const out=await reviewTargets({
  enableModelReview:true,retryInvalidDictionaryChoices:true,reviewPosFilter:false,
  experimentalHanja:true,experimentalLoanword:false,smartSegmentation:true,
  hanjaReadingCheck:true,model:'fake',provider:'custom',
  request:async(config,wire)=>{
   requests.push({config,wire});
   if(requests.length===1)
    return {results:[{t:'original0',c:'p0'},{t:'original1',c:'c999'}]};
   assert.equal(config.dictionaryCorrectionOnly,true);
   assert.equal(config.experimentalHanja,true);
   assert.equal(config.experimentalLoanword,false);
   assert.equal(config.smartSegmentation,false);
   assert.equal(wire.length,1);
   assert.equal(wire[0].experimental_hanja_audit,true);
   const instructions=buildReviewInstructions(config);
   assert.match(instructions,/OPEN-ENDED ORIGIN AUDIT/);
   assert.match(instructions,/EXPERIMENTAL HANJA ON/);
   assert.match(instructions,/EXPERIMENTAL LOANWORD OFF/);
   assert.doesNotMatch(instructions,/SAME response/);
   assert.deepEqual(buildReviewPayload('원잠',wire,config).payload.allowed_origin_types,['hanja']);
   return {results:[{t:'original1',c:'原潛'}]};
  }
 },sample());
 assert.equal(requests.length,2);
 assert.equal(out.unresolved.length,0);
 assert.equal(out.accepted.length,2);
 assert.equal(out.accepted.find(x=>x.target.target_id==='original1').option.replacement,'原潛');
});

test('manual targeted retry retains open-origin metadata and accepts direct Hanja',async()=>{
 const events=[],targets=sample(),wire=targets.map((x,i)=>({...x,target_id:'t'+i}));
 const prompt=buildManualPrompt('한국 원잠',wire,'batch61',{
  experimentalHanja:true,experimentalLoanword:false,reviewPosFilter:false
 });
 const session=createManualReviewSession({operationId:'op61',post:event=>events.push(event)});
 const pending=session.request({
  manualPrepared:{requestId:'batch61',text:prompt,bindings:[],targetCount:2},
  experimentalHanja:true,experimentalLoanword:false,
  hanjaReadingCheck:true,retryInvalidDictionaryChoices:true,reviewPosFilter:false
 },targets);
 const first=session.submit({operationId:'op61',requestId:'batch61',text:JSON.stringify({
  batch_id:'batch61',results:[{t:'t0',c:'p0'},{t:'t1',c:'c999'}]
 })});
 assert.equal(first,false);
 const error=events.find(x=>x.type==='MANUAL_REVIEW_ERROR'&&x.repairPrompt);
 assert.ok(error);
 assert.deepEqual(error.acceptedRows,[{t:'t0',c:'c0'}]);
 assert.match(error.repairPrompt,/EXPERIMENTAL HANJA ON/);
 assert.match(error.repairPrompt,/EXPERIMENTAL LOANWORD OFF/);
 assert.doesNotMatch(error.repairPrompt,/不要生成实验性自填词源/);
 const data=JSON.parse(error.repairPrompt.slice(error.repairPrompt.indexOf('{"format":"shared-pools-v5"')));
 assert.equal(data.origin_mode,'open-origin');
 assert.deepEqual(data.allowed_origin_types,['hanja']);
 assert.deepEqual(data.targets.map(x=>x.target_id),['t1']);
 assert.equal(data.targets[0].experimental_hanja_audit,true);
 assert.equal(session.submit({operationId:'op61',requestId:'batch61',text:JSON.stringify({
  batch_id:'batch61',results:[{t:'t1',c:'原潛'}]
 })}),true);
 assert.deepEqual((await pending).results,[{t:'original0',c:'c0'},{t:'original1',c:'原潛'}]);
});

test('invalid numbered IDs respect the existing no-retry and discard switches',async()=>{
 for(const flags of [
  {retryInvalidDictionaryChoices:false,discardInvalidReviewResults:true}
 ]){
  let calls=0;
  const out=await reviewTargets({
   enableModelReview:true,experimentalHanja:true,experimentalLoanword:true,
   reviewPosFilter:false,...flags,model:'fake',provider:'custom',
   request:async()=>{calls++;return {results:[{t:'original1',c:'c999'}]};}
  },[sample()[1]]);
  assert.equal(calls,1);
  assert.equal(out.accepted.length,1);
  assert.equal(out.accepted[0].option.type,'keep');
 }
});

test('page-offline fallback keeps open-origin metadata in corrected prompt',()=>{
 const content=readFileSync(new URL('../content.js',import.meta.url),'utf8');
 const retry=content.slice(content.indexOf('function manualRetryPrompt('),content.indexOf('async function applyManualRecovery('));
 assert.match(retry,/const originTypes=old\.origin_mode/);
 assert.match(retry,/OPEN-ENDED ORIGIN AUDIT remains enabled/);
 assert.doesNotMatch(retry,/dictionary_options_are_not_exhaustive,\.\.\.dictionaryPayload/);
 assert.doesNotMatch(retry,/experimental_hanja_audit,experimental_loanword_audit,/);
});

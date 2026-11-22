import test from 'node:test';
import assert from 'node:assert/strict';
import {validateChoices,validateExperimentalChoices,reviewTargets} from '../choice-review.js';
import {createManualReviewSession} from '../manual-review.js';
import {choicePreviewParser,experimentalChoicePreviewParser} from '../model-stream.js';
import {parsePartialReviewJson} from '../partial-review-json.js';

const keep=s=>({choice_id:null,type:'keep',replacement:s,entry_id:null,definitions:[]});
const candidate=(id,hanja)=>({choice_id:id,type:'hanja',replacement:hanja,entry_id:id,definitions:['test']});
const target=(id,surface)=>({target_id:id,start:0,end:surface.length,surface,context:surface,
 options:[keep(surface),candidate('c0','可'),candidate('c1','加')]});
const discard={discardInvalidReviewResults:true,retryInvalidDictionaryChoices:false,reviewPosFilter:false};
const retry={discardInvalidReviewResults:false,retryInvalidDictionaryChoices:true,reviewPosFilter:false};

test('two formally valid dictionary IDs conflict even if one ID does not exist',()=>{
 const rows=[{t:'t0',c:'c0'},{t:'t0',c:'c999'},{t:'t1',c:'c1'}];
 const v=validateChoices([target('t0','가'),target('t1','나')],{results:rows},discard);
 assert.deepEqual(v.accepted.map(a=>a.option.type),['keep','hanja']);
 assert.equal(v.accepted[0].discardedInvalid,true);
 assert.equal(v.unresolved.length,0);
 const r=validateChoices([target('t0','가'),target('t1','나')],{results:rows},retry);
 assert.deepEqual(r.unresolved.map(t=>t.target_id),['t0']);
 assert.deepEqual(r.accepted.map(a=>a.target.target_id),['t1']);
});

test('dictionary choice and experimental free-form origin conflict structurally even if literal might be rejected',()=>{
 const targets=[target('t0','가'),target('t1','나')];
 const results={results:[{t:'t1',c:'c0'},{t:'t0',c:'可'},{t:'t0',c:'c0'}]};
 const v=validateExperimentalChoices(targets,results,{...discard,experimentalHanja:true,experimentalLoanword:true});
 assert.deepEqual(v.accepted.map(a=>a.option.type),['keep','hanja']);
 assert.equal(v.accepted[0].discardedInvalid,true);
 assert.equal(v.unresolved.length,0);
});

test('all identical well-formed rows collapse into exactly one, regardless of repeat count or positions',()=>{
 const ts=[target('t0','가'),target('t1','나')];
 for(const n of [2,3,4,10,100]){
  const duplicates=Array.from({length:n},()=>({t:'t0',c:'c0'}));
  const rows=[duplicates[0],{t:'t1',c:'c1'},...duplicates.slice(1)];
  const d=validateChoices(ts,{results:rows},discard);
  const r=validateChoices(ts,{results:rows},retry);
  for(const v of [d,r]){
   assert.deepEqual(v.accepted.map(a=>a.option.choice_id),['c0','c1']);
   assert.equal(v.unresolved.length,0);
   assert.equal(v.accepted[0].discardedInvalid,undefined);
  }
 }
});

test('different values null, quoted null, case variants are not completely identical',()=>{
 const t=target('t0','가');
 for(const values of [[null,'null'],['null','NULL'],['c0','c1'],['c0','c999']]){
  const rows=values.map(c=>({t:'t0',c}));
  const v=validateChoices([t],{results:rows},discard);
  assert.equal(v.accepted.length,1);
  assert.equal(v.accepted[0].option.type,'keep');
  assert.equal(v.accepted[0].discardedInvalid,true);
  assert.equal(v.unresolved.length,0);
 }
});

test('identical unrecognized dictionary ID is deduplicated but still fails candidate validation',()=>{
 const t=target('t0','가');
 const rows={results:Array.from({length:4},()=>({t:'t0',c:'c999'}))};
 const d=validateChoices([t],rows,discard);
 assert.equal(d.accepted.length,1);
 assert.equal(d.accepted[0].option.type,'keep');
 assert.equal(d.accepted[0].discardedInvalid,true);
 const r=validateChoices([t],rows,retry);
 assert.deepEqual(r.unresolved.map(x=>x.target_id),['t0']);
 assert.deepEqual(r.invalidDictionaryChoiceIds,['t0']);
});

test('malformed siblings ignored; two identical complete rows are deduplicated after recovery',()=>{
 const bad='{"results":[{"t":"t0","c":"c0"},{"t":"t0","c":"c0"},'+
   '{"t":"t":"t0","c":"c1"},{"t":"t1","c":"c1"}]}';
 const p=parsePartialReviewJson(bad);
 assert.equal(p.recovered,true);
 assert.deepEqual(p.response.results,[{t:'t0',c:'c0'},{t:'t0',c:'c0'},{t:'t1',c:'c1'}]);
 const v=validateChoices([target('t0','가'),target('t1','나')],p.response,discard);
 assert.deepEqual(v.accepted.map(a=>a.option.choice_id),['c0','c1']);
});

test('API with duplicate identical choices uses exactly one request and accepts the choice',async()=>{
 const ts=[target('t0','가'),target('t1','나')];
 let calls=0;
 const v=await reviewTargets({...discard,enableModelReview:true,smartSegmentation:true,
  model:'fixture',context:'가나',request:async()=>{calls++;return {results:[
   {t:'t0',c:'c0'},{t:'t1',c:'c1'},{t:'t0',c:'c0'}]};}
 },ts);
 assert.equal(calls,1);
 assert.deepEqual(v.accepted.map(a=>a.option.choice_id),['c0','c1']);
 assert.equal(v.unresolved.length,0);
});

test('manual mode preserves identical copies and rejects nonidentical copies',async()=>{
 const events=[],s=createManualReviewSession({operationId:'op',post:e=>events.push(e)});
 const promise=s.request({...discard,manualPrepared:{requestId:'batch',text:'prompt',bindings:[],targetCount:3}},
  [target('original0','가'),target('original1','나'),target('original2','다')]);
 const response={batch_id:'batch',results:[
  {t:'t0',c:'c0'},{t:'t2',c:'c0'},
  {t:'t0',c:'c0'},{t:'t1',c:'c0'},
  {t:'t1',c:'c999'},{t:'t2',c:'c0'},{t:'t0',c:'c0'}
 ]};
 assert.equal(s.submit({operationId:'op',requestId:'batch',text:JSON.stringify(response)}),true);
 const event=events.find(e=>e.type==='MANUAL_REVIEW_ACCEPTED');
 assert.equal(event.discardedCount,1);
 assert.equal(events.some(e=>e.type==='MANUAL_REVIEW_ERROR'),false);
 const map=new Map((await promise).results.map(x=>[x.t,x.c]));
 assert.deepEqual([...map.entries()],[['original0','c0'],['original2','c0'],['original1',null]]);
});

test('streaming preview de-duplicates same values and invalidates only the conflicting target',()=>{
 const ts=[target('t0','가'),target('t1','나')],updates=[];
 const preview=choicePreviewParser(ts,rows=>updates.push(rows.map(r=>r.target.target_id+':'+r.option.choice_id)),
  ()=>null,discard);
 preview('{"results":[{"t":"t0","c":"c0"},{"t":"t0","c":"c0"},{"t":"t1","c":"c1"}]}');
 assert.deepEqual(updates.at(-1),['t0:c0','t1:c1']);
 const changed=[];
 const preview2=choicePreviewParser(ts,rows=>changed.push(rows.map(r=>r.target.target_id)),()=>null,discard);
 preview2('{"results":[{"t":"t0","c":"c0"},{"t":"t0","c":"c0"},{"t":"t1","c":"c1"},{"t":"t0","c":"c999"}]}');
 assert.deepEqual(changed.at(-1),['t1']);
 const experimental=[];
 const preview3=experimentalChoicePreviewParser(ts,{...discard,experimentalHanja:true},
  rows=>experimental.push(rows.map(r=>r.target.target_id)));
 preview3('{"results":[{"t":"t0","c":"c0"},{"t":"t0","c":"可"},{"t":"t1","c":"c0"}]}');
 assert.deepEqual(experimental.at(-1),['t1']);
});

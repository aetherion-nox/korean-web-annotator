import test from 'node:test';
import assert from 'node:assert/strict';
import {createManualReviewSession} from '../manual-review.js';
import {normalizeManualAnswer} from '../manual-answer-format.js';

const makeTarget=(id,surface)=>({target_id:id,start:0,end:surface.length,surface,context:surface,
 options:[
  {choice_id:'KEEP',type:'keep',replacement:surface,entry_id:null,definitions:[]},
  {choice_id:'c0',type:'hanja',replacement:'漢字',entry_id:1,definitions:['sample dictionary sense']}
 ]});
const targets=[makeTarget('local-a','한국'),makeTarget('local-b','정부')];
const rows=()=>[{t:'t0',c:null},{t:'t1',c:'c0'}];

function begin(name,options={}){
 const events=[],session=createManualReviewSession({operationId:name,post:event=>events.push(event)});
 const pending=session.request({context:'한국 정부',...options},targets);
 const request=events.find(event=>event.type==='MANUAL_REVIEW_REQUEST');
 const submit=answer=>session.submit({operationId:name,requestId:request.requestId,text:JSON.stringify(answer)});
 return {events,session,request,pending,submit};
}

test('manual session accepts an answer object without batch_id when all t IDs are known',async()=>{
 const batch=begin('optional-id');
 assert.equal(batch.submit({results:rows()}),true);
 const result=await batch.pending;
 assert.deepEqual(result.results,[{t:'local-a',c:null},{t:'local-b',c:'c0'}]);
 assert.equal(batch.events.filter(event=>event.type==='MANUAL_REVIEW_ACCEPTED').length,1);
 assert.equal(batch.events.filter(event=>event.type==='MANUAL_REVIEW_ERROR').length,0);
});

test('manual session accepts bare result arrays, including fenced JSON',async()=>{
 const batch=begin('bare-array');
 assert.equal(batch.session.submit({operationId:'bare-array',requestId:batch.request.requestId,
  text:'```json\n'+JSON.stringify(rows())+'\n```'}),true);
 assert.deepEqual((await batch.pending).results.map(row=>row.t),['local-a','local-b']);
});

test('canonical manual response remains valid and instructions show the correct batch ID',async()=>{
 const batch=begin('canonical-format');
 assert.match(batch.request.text,/MANUAL REVIEW: Preferred response/);
 assert.ok(batch.request.text.includes('"batch_id":"'+batch.request.requestId+'"'));
 assert.equal(batch.submit({batch_id:batch.request.requestId,results:rows()}),true);
 await batch.pending;
});

test('explicit wrong or null batch_id is rejected even if target IDs match',async()=>{
 const batch=begin('wrong-id');
 assert.equal(batch.submit({batch_id:'other-batch',results:rows()}),false);
 assert.equal(batch.submit({batch_id:null,results:rows()}),false);
 assert.equal(batch.submit({batch_id:batch.request.requestId,results:rows()}),true);
 await batch.pending;
 assert.equal(batch.events.filter(event=>event.type==='MANUAL_REVIEW_ERROR').length,2);
});

test('batchless foreign/malformed IDs are rejected atomically before partial caching',async()=>{
 const batch=begin('strict-no-id');
 for(const invalid of [
  {results:[{t:'t0',c:null},{t:'t9',c:'c0'}]},
  [{t:'t0',c:null},{t:'foreign',c:null}],
  {results:[{t:'t0',c:null},{choice_id:'c0',target_id:'t1'}]}
 ])assert.equal(batch.submit(invalid),false);
 assert.equal(batch.submit(rows()),true);
 assert.deepEqual((await batch.pending).results.map(x=>x.c),[null,'c0']);
 assert.equal(batch.events.filter(e=>e.type==='MANUAL_REVIEW_ERROR').length,3);
});

test('batchless partial valid answers can be saved, then retry only missing or invalid targets',async()=>{
 const batch=begin('partial-optional-id');
 assert.equal(batch.submit([{t:'t0',c:null}]),false);
 const partial=batch.events.find(e=>e.type==='MANUAL_REVIEW_ERROR'&&e.acceptedRows);
 assert.equal(partial.acceptedCount,1);
 assert.deepEqual(partial.invalidTargetIds,['t1']);
 assert.equal(batch.submit({results:[{t:'t1',c:42}]}),false);
 assert.equal(batch.submit({results:[{t:'t1',c:'c0'}]}),true);
 assert.deepEqual((await batch.pending).results.map(x=>x.c),[null,'c0']);
});

test('missing batch_id rejects repairs-only replies without target identity evidence',()=>{
 assert.throws(()=>normalizeManualAnswer({results:[],repairs:[{op:'add'}]},{
  requestId:'active',knownTargetIds:new Set(['t0'])
 }),/缺少 batch_id/);
 assert.deepEqual(normalizeManualAnswer({batch_id:'active',results:[],repairs:[{op:'add'}]},{
  requestId:'active',knownTargetIds:new Set(['t0'])
 }).repairs,[{op:'add'}]);
});

test('segmentation repairs can accompany a batchless answer with exact known target IDs',async()=>{
 const batch=begin('optional-repairs',{smartSegmentation:true,
  repairModes:{hanja:true,loanword:false},
  repairScopes:new Map([['local-a',{text:'한국',allTargets:[targets[0]],
    localAnnotations:[],protected_ranges:[],selected:null,existingRepairs:[]}],
    ['local-b',{text:'정부',allTargets:[targets[1]],
    localAnnotations:[],protected_ranges:[],selected:null,existingRepairs:[]}]])
 });
 const answer={results:rows(),repairs:[{
  sentence_id:'s0',op:'replace',old_target_ids:['t0'],start:0,end:2,surface:'한국',choice_id:'韓國'
 }]};
 assert.equal(batch.submit(answer),true);
 const result=await batch.pending;
 assert.equal(result.repairs.length,1);
 assert.deepEqual(result.repairs[0].old_target_ids,['local-a']);
});

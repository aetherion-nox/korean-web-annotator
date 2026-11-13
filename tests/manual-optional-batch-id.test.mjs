import test from 'node:test';
import assert from 'node:assert/strict';
import {createManualReviewSession} from '../manual-review.js';

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

test('missing batch_id is rejected despite exact one-to-one t/c match',async()=>{
 const batch=begin('optional-id');
 assert.equal(batch.submit({results:rows()}),false);
 assert.equal(batch.submit({batch_id:batch.request.requestId,results:rows()}),true);
 const result=await batch.pending;
 assert.deepEqual(result.results,[{t:'local-a',c:null},{t:'local-b',c:'c0'}]);
 assert.equal(batch.events.filter(event=>event.type==='MANUAL_REVIEW_ACCEPTED').length,1);
 assert.equal(batch.events.filter(event=>event.type==='MANUAL_REVIEW_ERROR').length,1);
});

test('explicit wrong batch_id is rejected even when count and target IDs match',async()=>{
 const batch=begin('wrong-id');
 assert.equal(batch.submit({batch_id:'other-batch',results:rows()}),false);
 assert.equal(batch.submit({batch_id:null,results:rows()}),false);
 assert.equal(batch.submit({batch_id:batch.request.requestId,results:rows()}),true);
 await batch.pending;
 assert.equal(batch.events.filter(event=>event.type==='MANUAL_REVIEW_ERROR').length,2);
});

test('missing ID never relaxes count, duplicate target, foreign target or option validation',async()=>{
 const batch=begin('strict-no-id');
 for(const invalid of [
  [{t:'t0',c:null}],
  [{t:'t0',c:null},{t:'t0',c:'c0'}],
  [{t:'t0',c:null},{t:'t9',c:'c0'}],
  [{t:'t0',c:null},{t:'t1',c:'missing'}]
 ]){
  assert.equal(batch.submit({results:invalid}),false,JSON.stringify(invalid));
 }
 assert.equal(batch.submit({batch_id:batch.request.requestId,results:rows()}),true);
 await batch.pending;
 assert.equal(batch.events.filter(event=>event.type==='MANUAL_REVIEW_ERROR').length,4);
});

test('segmentation repairs also require matching batch_id',async()=>{
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
 assert.equal(batch.submit(answer),false);
 assert.equal(batch.submit({...answer,batch_id:batch.request.requestId}),true);
 const result=await batch.pending;
 assert.equal(result.repairs.length,1);
 assert.deepEqual(result.repairs[0].old_target_ids,['local-a']);
});

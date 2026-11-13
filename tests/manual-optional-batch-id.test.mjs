import test from 'node:test';
import assert from 'node:assert/strict';
import {createManualReviewSession} from '../manual-review.js';
const makeTarget=(id,surface)=>({target_id:id,start:0,end:surface.length,surface,context:surface,
 options:[{choice_id:'KEEP',type:'keep',replacement:surface,entry_id:null,definitions:[]},
  {choice_id:'c0',type:'hanja',replacement:'漢字',entry_id:1,definitions:['sample']} ]});
const targets=[makeTarget('local-a','한국'),makeTarget('local-b','정부')];
function begin(name,options={}){
 const events=[],session=createManualReviewSession({operationId:name,post:x=>events.push(x)});
 const pending=session.request({context:'한국 정부',...options},targets);
 const request=events.find(x=>x.type==='MANUAL_REVIEW_REQUEST');
 const submit=response=>session.submit({operationId:name,requestId:request.requestId,
  text:JSON.stringify(response)});
 return {events,pending,request,submit};
}
test('missing batch identity is rejected even with exactly matching positional length',async()=>{
 const q=begin('no-id');
 assert.equal(q.submit({results:[null,'c0']}),false);
 assert.equal(q.submit({batch_id:q.request.requestId,results:[null,'c0']}),true);
 assert.deepEqual((await q.pending).results,[null,'c0']);
});
test('explicit wrong batch identity rejected regardless of correct decisions',async()=>{
 const q=begin('wrong-id');
 assert.equal(q.submit({batch_id:'other',results:[null,'c0']}),false);
 assert.equal(q.submit({batch_id:null,results:[null,'c0']}),false);
 assert.equal(q.submit({batch_id:q.request.requestId,results:[null,'c0']}),true);
 await q.pending;
 assert.equal(q.events.filter(x=>x.type==='MANUAL_REVIEW_ERROR').length,2);
});
test('wrong count, duplicate partial index, foreign index and invalid choice cannot silently shift',async()=>{
 const q=begin('strict');
 for(const results of [[null],[null,'c0','c0'],[null,'INVALID']]){
  assert.equal(q.submit({batch_id:q.request.requestId,results}),false);
 }
 for(const results of [[[0,null],[0,'c0']],[[9,'c0']]]){
  assert.equal(q.submit({batch_id:q.request.requestId,partial:true,results}),false);
 }
 assert.equal(q.submit({batch_id:q.request.requestId,results:[null,'c0']}),true);
 assert.deepEqual((await q.pending).results,[null,'c0']);
});
test('segmentation repair consumes one old target but keeps its false positional slot',async()=>{
 const q=begin('repair',{smartSegmentation:true,
  repairModes:{hanja:true,loanword:false},
  repairScopes:new Map([['local-a',{text:'한국',allTargets:[targets[0]],
    localAnnotations:[],protected_ranges:[],selected:null,existingRepairs:[]}],
    ['local-b',{text:'정부',allTargets:[targets[1]],
    localAnnotations:[],protected_ranges:[],selected:null,existingRepairs:[]}]])
 });
 const answer={batch_id:q.request.requestId,results:[false,'c0'],repairs:[{
  sentence_id:'s0',op:'replace',old_target_ids:['t0'],start:0,end:2,surface:'한국',choice_id:'韓國'
 }]};
 assert.equal(q.submit(answer),true);
 const done=await q.pending;
 assert.deepEqual(done.results,[false,'c0']);
 assert.deepEqual(done.repairs[0].old_target_ids,['local-a']);
});

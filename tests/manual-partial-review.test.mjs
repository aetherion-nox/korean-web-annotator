import test from 'node:test';
import assert from 'node:assert/strict';
import {createManualReviewSession} from '../manual-review.js';

function create(){
 const events=[],session=createManualReviewSession({operationId:'op',post:e=>events.push(e)});
 const base={context:'가나',options:[{choice_id:'KEEP',type:'keep',entry_id:null,
   definitions:[],replacement:'가'},{choice_id:'c0',type:'hanja',entry_id:1,
   definitions:['词义'],replacement:'可'}]};
 const targets=[{...base,target_id:'original0',surface:'가',start:0,end:1},
  {...base,target_id:'original1',surface:'나',start:1,end:2}];
 const pending=session.request({context:'가나',reviewPosFilter:false},targets);
 const request=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 const submit=(payload)=>session.submit({operationId:'op',requestId:request.requestId,
  text:JSON.stringify(payload)});
 return {events,session,pending,request,submit};
}
test('valid indexed decisions are kept while only unresolved ORIGINAL positions are retried',async()=>{
 const q=create();
 assert.equal(q.submit({batch_id:q.request.requestId,results:['c0','INVALID']}),false);
 const partial=q.events.find(e=>e.type==='MANUAL_REVIEW_ERROR'&&e.acceptedRows);
 assert.equal(partial.acceptedCount,1);
 assert.deepEqual(partial.invalidTargetIds,['t1']);
 assert.deepEqual(partial.acceptedRows,[[0,'c0']]);
 const index=partial.repairPrompt.indexOf('{"format":"shared-pools-v4"');
 assert.ok(index>=0);
 const retryJson=JSON.parse(partial.repairPrompt.slice(index));
 assert.deepEqual(retryJson.targets.map(x=>x.index),[1]);
 assert.equal(retryJson.candidates.length,1);
 assert.equal(retryJson.sentences.length,1);
 assert.equal(retryJson.batch_id,q.request.requestId);
 assert.equal(q.submit({batch_id:q.request.requestId,partial:true,results:[[1,null]]}),true);
 assert.deepEqual((await q.pending).results,['c0',null]);
});
test('missing and incorrect batch ID cannot save or apply any answers',async()=>{
 const q=create();
 assert.equal(q.submit({batch_id:'wrong',results:['c0',null]}),false);
 assert.equal(q.submit({results:['c0',null]}),false);
 assert.equal(q.events.filter(e=>e.type==='MANUAL_REVIEW_ERROR').length,2);
 assert.equal(q.submit({batch_id:q.request.requestId,results:['c0',null]}),true);
 assert.deepEqual((await q.pending).results,['c0',null]);
});

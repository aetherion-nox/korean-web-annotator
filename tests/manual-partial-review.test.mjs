import test from 'node:test';
import assert from 'node:assert/strict';
import {createManualReviewSession} from '../manual-review.js';

test('background keeps valid choices, asks only for missing IDs and merges retry',async()=>{
 const events=[];
 const session=createManualReviewSession({operationId:'op',post:e=>events.push(e)});
 const base={context:'가나',options:[{choice_id:'KEEP',type:'keep',entry_id:null,definitions:[],replacement:'가'},
   {choice_id:'c0',type:'hanja',entry_id:1,definitions:['词义'],replacement:'可'}]};
 const targets=[{...base,target_id:'original0',surface:'가',start:0,end:1},
   {...base,target_id:'original1',surface:'나',start:1,end:2}];
 const prompt='Review input\n'+JSON.stringify({format:'shared-pools-v4',
   sentences:[{sentence_id:'s0',text:'가나'}],
   candidates:[{candidate_id:'p0',type:'hanja',replacement:'可'}],
   targets:[{target_id:'t0',sentence_id:'s0',options:{c0:'p0'}},
     {target_id:'t1',sentence_id:'s0',options:{c0:'p0'}}],batch_id:'batch1'});
 const pending=session.request({manualPrepared:{requestId:'batch1',text:prompt,bindings:[],targetCount:2},reviewPosFilter:false},targets);
 const first=session.submit({operationId:'op',requestId:'batch1',text:JSON.stringify({
   batch_id:'batch1',format:'shared-pools-v4',results:[
     {t:'t0',c:'c0'},{t:'t1',c:'INVALID'},
     {t:'previous-batch',c:'c0'}]})});
 assert.equal(first,false);
 const partial=events.find(e=>e.type==='MANUAL_REVIEW_ERROR'&&e.acceptedRows);
 assert.ok(partial,'should announce saved partial decisions');
 assert.equal(partial.acceptedCount,1);
 assert.deepEqual(partial.invalidTargetIds,['t1']);
 assert.equal(partial.acceptedRows.length,1);
 assert.equal(partial.acceptedRows[0].t,'t0');
 const retryJson=JSON.parse(partial.repairPrompt.slice(partial.repairPrompt.indexOf('{"format":"shared-pools-v4"')));
 assert.deepEqual(retryJson.targets.map(x=>x.target_id),['t1']);
 assert.equal(retryJson.candidates.length,1);
 assert.equal(retryJson.sentences.length,1);
 assert.equal(retryJson.batch_id,'batch1');
 const second=session.submit({operationId:'op',requestId:'batch1',text:JSON.stringify({
   batch_id:'batch1',results:[{t:'t0',c:null},{t:'t1',c:null}]})});
 assert.equal(second,true);
 const result=await pending;
 assert.deepEqual(result.results.map(x=>[x.t,x.c]),
   [['original0','c0'],['original1',null]]);
});

test('invalid batch ID never saves any partial answers',async()=>{
 const events=[],session=createManualReviewSession({operationId:'op',post:e=>events.push(e)});
 const target={target_id:'original0',start:0,end:1,surface:'가',context:'가',options:[
   {choice_id:'KEEP',type:'keep',replacement:'가',definitions:[]}]};
 const pending=session.request({manualPrepared:{requestId:'batch',text:'review',bindings:[]}},[target]);
 assert.equal(session.submit({operationId:'op',requestId:'batch',text:JSON.stringify({
   batch_id:'wrong',results:[{t:'t0',c:null}]})}),false);
 assert.match(events.at(-1).error,/batch_id/);
 assert.equal(events.at(-1).acceptedRows,undefined);
 assert.equal(session.submit({operationId:'op',requestId:'batch',text:JSON.stringify({
   batch_id:'batch',results:[{t:'t0',c:null}]})}),true);
 assert.equal((await pending).results[0].c,null);
});

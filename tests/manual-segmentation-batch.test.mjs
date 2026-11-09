import test from 'node:test';
import assert from 'node:assert/strict';
import {createManualReviewSession} from '../manual-review.js';
import {contextReviewBatches} from '../batch-budget.js';
const opts={allowModelHanja:true,allowModelLoanword:false,allowModelSegmentation:true,reviewPosFilter:true};
function fixture(){
 const targets=Array.from({length:38},(_,i)=>{
  const surface=i===27?'최고인민검찰원':'학교';
  return {target_id:'orig'+i,start:0,end:surface.length,surface,context:surface,
   ...(i===27?{segmentation_review:true}:{}),
   options:[{choice_id:'KEEP',type:'keep',replacement:surface,entry_id:null,definitions:[]}]};
 });
 const generated={target_id:'t27',choice_id:'GEN_SEGMENTS',confidence:'high',
   evidence:'最高人民檢察院 is the verified complete origin',
   segments:[{start:0,end:2,surface:'최고',type:'hanja',replacement:'最高'},
    {start:2,end:4,surface:'인민',type:'hanja',replacement:'人民'},
    {start:4,end:6,surface:'검찰',type:'hanja',replacement:'檢察'},
    {start:6,end:7,surface:'원',type:'hanja',replacement:'院'}]};
 return {targets,generated};
}
test('38-row manual batch accepts a legitimate 1-syllable compound suffix without dropping any row',async()=>{
 const {targets,generated}=fixture(),events=[];
 const session=createManualReviewSession({operationId:'test',post:e=>events.push(e)});
 const pending=session.request({...opts,context:'fixture'},targets);
 const batch=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 const rows=targets.map((t,i)=>i===27?generated:{target_id:'t'+i,choice_id:'KEEP'});
 assert.equal(session.submit({operationId:'test',requestId:batch.requestId,text:JSON.stringify({batch_id:batch.requestId,results:rows})}),true);
 const result=await pending;
 assert.equal(result.results.length,38);
 assert.equal(result.results[27].target_id,'orig27');
 assert.deepEqual(result.results[27].segments,generated.segments);
 assert.equal(events.at(-1).type,'MANUAL_REVIEW_ACCEPTED');
});
test('manual review reports exact rejected target rather than a generic missing-ID error',async()=>{
 const {targets,generated}=fixture(),events=[];
 const session=createManualReviewSession({operationId:'test',post:e=>events.push(e)});
 const pending=session.request({...opts,context:'fixture'},targets);
 const batch=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 const malformed={...generated,segments:generated.segments.map((p,i)=>i===3?{...p,surface:'錯字'}:p)};
 const rows=targets.map((t,i)=>i===27?malformed:{target_id:'t'+i,choice_id:'KEEP'});
 assert.equal(session.submit({operationId:'test',requestId:batch.requestId,text:JSON.stringify({batch_id:batch.requestId,results:rows})}),false);
 const err=events.at(-1);
 assert.equal(err.type,'MANUAL_REVIEW_ERROR');
 assert.match(err.error,/t27/);
 assert.match(err.error,/第 4 段/);
 assert.match(err.error,/surface/);
 rows[27]=generated;
 assert.equal(session.submit({operationId:'test',requestId:batch.requestId,text:JSON.stringify({batch_id:batch.requestId,results:rows})}),true);
 assert.equal((await pending).results.length,38);
});
test('large experimental reviews are broken into budgeted batches instead of silently losing targets',()=>{
 const context='학교생활 을 되새긴다.';
 const targets=Array.from({length:280},(_,i)=>({
  target_id:'seg'+i,start:0,end:4,surface:'학교생활',context,segmentation_review:true,
  options:[{choice_id:'KEEP',type:'keep',replacement:'학교생활',entry_id:null,definitions:[]}]
 }));
 const item={sentence:{id:'s0',text:context},result:{unresolved:targets}};
 const batches=contextReviewBatches([item],context,{tier:'32k',manual:true,...opts});
 assert.equal(batches.flatMap(b=>b.rows).length,280);
 assert.ok(batches.length>1);
 assert.ok(batches.every(b=>b.budget.totalTokens<=b.budget.contextTokens));
});

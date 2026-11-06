import test from 'node:test';import assert from 'node:assert/strict';
import {runSentencePipeline} from '../annotation-pipeline.js';
import {createManualReviewSession} from '../manual-review.js';
import {contextReviewBatches,describeBatchBudget} from '../batch-budget.js';
test('all batch backups reach page before first request; exact IDs match live session',async()=>{
 const text='가'.repeat(150),identity={engine_version:'engine',dictionary_fingerprint:'dict'};
 const targets=Array.from({length:150},(_,i)=>({target_id:'original'+i,start:i,end:i+1,surface:'가',context:text,options:[{choice_id:'KEEP',type:'keep',replacement:'가',entry_id:null,definitions:[]},{choice_id:'c0',type:'hanja',replacement:'可',entry_id:i+1,definitions:['meaning '.repeat(600)]}]}));
 const events=[];let plan;const signal=new AbortController().signal;
 const session=createManualReviewSession({operationId:'op',signal,post:e=>{
  events.push(e);
  if(e.type==='MANUAL_REVIEW_REQUEST'){
   const backup=plan.find(b=>b.requestId===e.requestId);assert.equal(e.text,backup.text);assert.deepEqual(e.bindings,backup.bindings);
   const response={batch_id:e.requestId,results:e.bindings.map(b=>({target_id:b.target_id,choice_id:'KEEP'}))};
   queueMicrotask(()=>session.submit({operationId:'op',requestId:e.requestId,text:JSON.stringify(response)}));
  }
 }});
 await runSentencePipeline({operationId:'op',sentences:[{id:'s',text}],modes:{hanja:true}},e=>{events.push(e);if(e.type==='MANUAL_REVIEW_PLAN')plan=e.batches;},{signal,status:async()=>identity,analyze:async()=>({...identity,annotations:[],targets,stats:{pending:150}}),enabled:true,modelConfig:async()=>({manualReview:true,request:session.request,batchContextTier:'32k'})});
 assert.ok(plan.length>1);assert.equal(events.filter(e=>e.type==='MANUAL_REVIEW_ACCEPTED').length,plan.length);assert.ok(events.some(e=>e.type==='DONE'));
 const ids=plan.map(b=>b.requestId);assert.equal(new Set(ids).size,ids.length);
});
test('256k budget includes safety and output; target coverage never lost',()=>{
 const text='가';const targets=Array.from({length:15},(_,i)=>({target_id:'t'+i,surface:text,context:text,start:0,end:1,options:[{type:'keep',choice_id:'KEEP',entry_id:null,replacement:text,definitions:[]}]}));
 for(const manual of [true,false])for(const tier of ['32k','128k','256k','512k','1m']){
  const item={result:{unresolved:targets}};const batches=contextReviewBatches([item],text,{tier,manual});assert.equal(batches.flatMap(b=>b.rows).length,targets.length);
  for(const b of batches){assert.ok(b.budget.totalTokens<=b.budget.contextTokens);assert.ok(b.budget.safetyTokens>1024);assert.ok(b.budget.outputTokens<=b.budget.outputLimit);}
 }
});

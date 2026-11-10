import test from 'node:test';
import assert from 'node:assert/strict';
import {runSentencePipeline} from '../annotation-pipeline.js';
import {createManualReviewSession} from '../manual-review.js';
import {reviewTargets} from '../choice-review.js';
import {experimentalChoicePreviewParser} from '../model-stream.js';
import {describeBatchBudget} from '../batch-budget.js';

const identity={engine_version:'unified-exp',dictionary_fingerprint:'dict-1'};
const sentence='원잠 게임';
const target0={target_id:'local-0',start:0,end:2,surface:'원잠',context:sentence,options:[
 {choice_id:'KEEP',type:'keep',entry_id:null,replacement:'원잠',definitions:[]},
 {choice_id:'c0',type:'hanja',entry_id:1,replacement:'元箴',definitions:['unrelated']} ]};
const target1={target_id:'local-1',start:3,end:5,surface:'게임',context:sentence,options:[
 {choice_id:'KEEP',type:'keep',entry_id:null,replacement:'게임',definitions:[]},
 {choice_id:'n0',type:'nonconversion',entry_id:2,replacement:'게임',definitions:['another sense']} ]};
const proposed=(target_id)=>({target_id,choice_id:'x0',type:'hanja',replacement:'原潛',definition:'a nuclear-powered submarine'});
const data=(targets=[])=>({...identity,annotations:[],targets,stats:{pending:targets.length}});
const answer=(targets)=>({experimental_options:[proposed(targets[0].target_id)],results:targets.map((t,i)=>({target_id:t.target_id,choice_id:i===0?'x0':'n0'}))});

test('pipeline uses one request to consider newly proposed and original options together',async()=>{
 const calls=[],events=[];
 const stats=await runSentencePipeline({operationId:'one-reply',sentences:[{id:'s0',text:sentence}],modes:{hanja:true,loanword:true}},e=>events.push(e),{
  status:async()=>identity,analyze:async()=>data([target0,target1]),enabled:true,cache:new Map(),
  modelConfig:async()=>({model:'fixture',endpoint:'fixture://model',experimentalHanja:true,request:async(_config,targets)=>{calls.push(targets);return answer(targets);}})
 });
 assert.equal(calls.length,1,'no KEEP-triggered second/third request');
 assert.equal(stats.model_resolved,1);
 const final=events.filter(e=>e.type==='RESULTS'&&e.source==='model').at(-1).results[0].annotations;
 assert.equal(final.length,1);assert.equal(final[0].replacement,'原潛');
 assert.equal(events.filter(e=>e.type==='DIAGNOSTIC').some(e=>e.diagnostic.stage==='experimental'),true);
});

test('manual one-batch response maps target IDs and proposed x0 back to original targets',async()=>{
 const events=[];
 const session=createManualReviewSession({operationId:'manual',post:e=>events.push(e)});
 const pending=session.request({context:sentence,experimentalHanja:true,experimentalLoanword:false,reviewPosFilter:false},[target0,target1]);
 const request=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 assert.ok(request.text.includes('experimental_options'));
 assert.ok(request.text.includes('experimental_modes'));
 const result={batch_id:request.requestId,experimental_options:[proposed('t0')],results:[
  {target_id:'t0',choice_id:'x0'},{target_id:'t1',choice_id:'n0'}]};
 assert.equal(session.submit({operationId:'manual',requestId:request.requestId,text:JSON.stringify(result)}),true);
 const mapped=await pending;
 assert.deepEqual(mapped.results.map(r=>r.target_id),['local-0','local-1']);
 assert.equal(mapped.experimental_options[0].target_id,'local-0');
 assert.equal(mapped.experimental_options[0].choice_id,'x0');
});

test('manual rejects invalid experimental result but keeps request pending for correction',async()=>{
 const events=[];const controller=new AbortController();
 const session=createManualReviewSession({operationId:'manual-err',signal:controller.signal,post:e=>events.push(e)});
 const pending=session.request({context:sentence,experimentalHanja:true,reviewPosFilter:false},[target0]);
 const id=events[0].requestId;
 const submit=result=>session.submit({operationId:'manual-err',requestId:id,text:JSON.stringify({batch_id:id,...result})});
 assert.equal(submit({experimental_options:[],results:[{target_id:'t0',choice_id:'x0'}]}),false);
 assert.equal(submit({experimental_options:[proposed('unknown')],results:[{target_id:'t0',choice_id:'KEEP'}]}),false);
 assert.equal(submit({experimental_options:[proposed('t0')],results:[{target_id:'t0',choice_id:'x0'}]}),true);
 assert.equal((await pending).results[0].choice_id,'x0');
 assert.equal(events.filter(e=>e.type==='MANUAL_REVIEW_ERROR').length,2);
});

test('API sends experimental modes in first review request, receiving x choice directly',async()=>{
 const originalFetch=globalThis.fetch;let requestCount=0,wire=null;
 globalThis.fetch=async(url,init)=>{
  requestCount++;wire=JSON.parse(init.body);
  const reply={experimental_options:[proposed('local-0')],results:[{target_id:'local-0',choice_id:'x0'}]};
  return new Response(JSON.stringify({choices:[{index:0,finish_reason:'stop',message:{content:JSON.stringify(reply)}}]}),{headers:{'content-type':'application/json'}});
 };
 try{
  const result=await reviewTargets({enableModelReview:true,experimentalHanja:true,experimentalLoanword:false,provider:'deepseek',endpoint:'https://example.invalid/v1/chat/completions',model:'fixture',logger:{start:async()=>1,finish:async()=>{}}},[target0]);
  assert.equal(requestCount,1);
  assert.equal(result.accepted[0].option.replacement,'原潛');
  assert.ok(wire.messages[0].content.includes('experimental_options'));
  assert.equal(JSON.parse(wire.messages[1].content).experimental_modes.hanja,true);
 }finally{globalThis.fetch=originalFetch;}
});

test('streaming waits for complete validated proposals before previewing x choices',()=>{
 const snapshots=[];const receive=experimentalChoicePreviewParser([target0],{experimentalHanja:true},rows=>snapshots.push(rows.map(a=>a.option.choice_id)));
 const message=JSON.stringify({experimental_options:[proposed('local-0')],results:[{target_id:'local-0',choice_id:'x0'}]});
 const first=message.indexOf(',"results"');
 receive(message.slice(0,first));assert.equal(snapshots.length,0);
 for(const part of [message.slice(first,first+18),message.slice(first+18)])receive(part);
 assert.deepEqual(snapshots.at(-1),['x0']);
 const badSnapshots=[];const bad=experimentalChoicePreviewParser([target0],{experimentalHanja:true},rows=>badSnapshots.push(rows));
 bad(JSON.stringify({experimental_options:[proposed('cross-batch')],results:[{target_id:'local-0',choice_id:'x0'}]}));
 assert.equal(badSnapshots.length,0);
});

test('batch budget includes unified experiment instructions and output proposal allowance',()=>{
 const ordinary=describeBatchBudget(sentence,[target0,target1],{tier:'32k'});
 const experimental=describeBatchBudget(sentence,[target0,target1],{tier:'32k',experimentalHanja:true});
 assert.ok(experimental.inputTokens>ordinary.inputTokens);
 assert.ok(experimental.outputTokens>ordinary.outputTokens);
});

test('experimental response budget excludes identities that proposal validator already forbids',()=>{
 const normal=describeBatchBudget(sentence,[target0,target1],{tier:'512k',manual:true,experimentalHanja:true});
 for(const flag of ['proper_noun','dictionary_person_name','dictionary_name_homograph','suspected_person_name','partial_word']){
  const forbidden=describeBatchBudget(sentence,[{...target0,[flag]:true},target1],{tier:'512k',manual:true,experimentalHanja:true});
  assert.ok(forbidden.outputTokens<normal.outputTokens,flag+' must not reserve imaginary x0');
 }
 const none=describeBatchBudget(sentence,[{...target0,proper_noun:true},{...target1,partial_word:true}],
   {tier:'512k',manual:true,experimentalHanja:true});
 const ordinary=describeBatchBudget(sentence,[{...target0,proper_noun:true},{...target1,partial_word:true}],
   {tier:'512k',manual:true,experimentalHanja:false});
 assert.ok(none.outputTokens-ordinary.outputTokens<50,'only the empty experimental_options array remains');
});

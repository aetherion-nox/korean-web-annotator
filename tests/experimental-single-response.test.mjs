import test from 'node:test';
import assert from 'node:assert/strict';
import {runSentencePipeline} from '../annotation-pipeline.js';
import {createManualReviewSession} from '../manual-review.js';
import {reviewTargets} from '../choice-review.js';
import {experimentalChoicePreviewParser} from '../model-stream.js';
import {describeBatchBudget,normalizeOutputTokenLimit,contextReviewBatches} from '../batch-budget.js';

const identity={engine_version:'direct-origin',dictionary_fingerprint:'dict-1'};
const sentence='원잠 게임';
const target0={target_id:'local-0',start:0,end:2,surface:'원잠',context:sentence,options:[
 {choice_id:'KEEP',type:'keep',entry_id:null,replacement:'원잠',definitions:[]},
 {choice_id:'c0',type:'hanja',entry_id:1,replacement:'元箴',definitions:['unrelated']}]};
const target1={target_id:'local-1',start:3,end:5,surface:'게임',context:sentence,options:[
 {choice_id:'KEEP',type:'keep',entry_id:null,replacement:'게임',definitions:[]},
 {choice_id:'n0',type:'nonconversion',entry_id:2,replacement:'게임',definitions:['native sense']}]};
const data=(targets=[])=>({...identity,annotations:[],targets,stats:{pending:targets.length}});
const answer=targets=>({results:targets.map((t,i)=>({t:t.target_id,c:i===0?'原潛':'n0'}))});

test('pipeline uses one request for literal-origin and ordinary keys together',async()=>{
 const calls=[],events=[];
 const stats=await runSentencePipeline({operationId:'direct',sentences:[{id:'s0',text:sentence}],modes:{hanja:true,loanword:true}},e=>events.push(e),{
  status:async()=>identity,analyze:async()=>data([target0,target1]),enabled:true,cache:new Map(),
  modelConfig:async()=>({model:'fixture',endpoint:'fixture://model',experimentalHanja:true,
   request:async(config,targets)=>{calls.push({config,targets});return answer(targets);}})
 });
 assert.equal(calls.length,1);
 assert.equal(stats.model_resolved,1);
 const final=events.filter(e=>e.type==='RESULTS'&&e.source==='model').at(-1).results[0].annotations;
 assert.equal(final.length,1);assert.equal(final[0].replacement,'原潛');
 assert.equal(events.some(e=>e.type==='DIAGNOSTIC'&&e.diagnostic.stage==='experimental'),true);
});

test('manual review remaps raw choice_id to local target ID with no proposal array',async()=>{
 const events=[];const session=createManualReviewSession({operationId:'manual',post:e=>events.push(e)});
 const pending=session.request({context:sentence,experimentalHanja:true,reviewPosFilter:false,manualOutputTokenLimit:131072},[target0,target1]);
 const request=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 assert.ok(request.text.includes('genuine Hanja spelling'));
 assert.ok(!request.text.includes('original Latin-script spelling'));
 assert.ok(!request.text.includes('experimental_modes'));
 assert.equal(JSON.parse(request.text.split('\n').at(-1)).batch_id,request.requestId);
 assert.equal(request.budget.outputLimit,131072);
 const response={batch_id:request.requestId,results:[
  {t:'t0',c:'原潛'},{t:'t1',c:'n0'}]};
 assert.equal(session.submit({operationId:'manual',requestId:request.requestId,text:JSON.stringify(response)}),true);
 const mapped=await pending;
 assert.deepEqual(mapped.results.map(r=>r.t),['local-0','local-1']);
 assert.equal(mapped.results[0].c,'原潛');
 assert.ok(!('experimental_options' in mapped));
});

test('manual falls back to null for unrecognized c, but rejects obsolete experimental array',async()=>{
 const events=[];const controller=new AbortController();
 const session=createManualReviewSession({operationId:'manual-bad',signal:controller.signal,post:e=>events.push(e)});
 const pending=session.request({context:sentence,experimentalHanja:true},[target0]);
 const id=events[0].requestId;
 const submit=payload=>session.submit({operationId:'manual-bad',requestId:id,text:JSON.stringify({batch_id:id,...payload})});
 assert.equal(submit({results:[{t:'t0',c:'原潛'}],experimental_options:[]}),false);
 assert.equal(submit({results:[{t:'t0',c:'x0'}]}),true);
 assert.equal((await pending).results[0].c,null);
 assert.equal(events.filter(e=>e.type==='MANUAL_REVIEW_ERROR').length,1);
});

test('API sends results-only protocol and configurable max_tokens (DeepSeek)',async()=>{
 const saved=globalThis.fetch;let wire;
 globalThis.fetch=async(url,init)=>{
  wire=JSON.parse(init.body);
  return new Response(JSON.stringify({choices:[{index:0,finish_reason:'stop',message:{
   content:JSON.stringify({results:[{t:'local-0',c:'原潛'}]})}}]}),
   {headers:{'content-type':'application/json'}});
 };
 try{
  const result=await reviewTargets({enableModelReview:true,experimentalHanja:true,
   provider:'deepseek',endpoint:'https://example.invalid/v1/chat/completions',model:'fixture',
   apiOutputTokenLimit:32000,logger:{start:async()=>1,finish:async()=>{}}},[target0]);
  assert.equal(result.accepted.length,1);
  assert.equal(result.accepted[0].option.replacement,'原潛');
  assert.equal(wire.max_tokens,32000);
  assert.ok(!wire.messages[0].content.includes('"experimental_options":['));
  assert.equal(JSON.parse(wire.messages[1].content).experimental_modes,undefined);
  assert.ok(wire.messages[0].content.includes('genuine Hanja spelling'));
  assert.ok(!wire.messages[0].content.includes('original Latin-script spelling'));
 }finally{globalThis.fetch=saved;}
});

test('OpenAI Chat/Responses and Anthropic use the correct configured output limit field',async()=>{
 const saved=globalThis.fetch;
 const cases=[
  {provider:'openai',endpoint:'https://example.invalid/v1/chat/completions',name:'max_completion_tokens'},
  {provider:'openai',endpoint:'https://example.invalid/v1/responses',name:'max_output_tokens'},
  {provider:'anthropic',endpoint:'https://example.invalid/v1/messages',name:'max_tokens'}
 ];
 try{
  for(const item of cases){
   let wire;
   globalThis.fetch=async(_,options)=>{
    wire=JSON.parse(options.body);
    const text=JSON.stringify({results:[{t:'local-0',c:null}]});
    const body=item.provider==='anthropic'?{stop_reason:'end_turn',content:[{type:'text',text}]}:
      item.endpoint.endsWith('/responses')?{status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]}:
      {choices:[{index:0,finish_reason:'stop',message:{content:text}}]};
    return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
   };
   const res=await reviewTargets({enableModelReview:true,...item,model:'fixture',
    batchBudget:{outputLimit:44444},logger:{start:async()=>1,finish:async()=>{}}},[target0]);
   assert.equal(res.accepted.length,1,item.provider);
   assert.equal(wire[item.name],44444,item.endpoint);
   assert.ok(!Object.hasOwn(wire,item.name==='max_tokens'?'max_completion_tokens':'max_tokens'),'no conflicting cap property');
  }
 }finally{globalThis.fetch=saved;}
});

test('stream previews valid raw Hanja and dictionary choices from completed rows',()=>{
 const events=[],parser=experimentalChoicePreviewParser([target0,target1],{experimentalHanja:true},rows=>events.push(rows.map(a=>a.option.choice_id)));
 const message=JSON.stringify(answer([target0,target1]));
 parser(message.slice(0,10));assert.equal(events.length,0);
 for(let i=10;i<message.length;i+=8)parser(message.slice(i,i+8));
 assert.deepEqual(events.at(-1),['原潛','n0']);
 const badEvents=[],bad=experimentalChoicePreviewParser([target0],{experimentalHanja:true},rows=>badEvents.push(rows));
 bad(JSON.stringify({results:[{t:'local-0',c:'x0'}]}));
 assert.deepEqual(badEvents.at(-1).map(row=>row.option.type),['keep']);
});

test('output cap defaults, validation, and planning budgets are consistent',()=>{
 assert.equal(normalizeOutputTokenLimit(undefined,false),16384);
 assert.equal(normalizeOutputTokenLimit(undefined,true),65536);
 assert.equal(normalizeOutputTokenLimit('32768'),32768);
 for(const value of [100,1000001,0,'abc',1.25])assert.equal(normalizeOutputTokenLimit(value,true),65536);
 const settings={tier:'512k',manual:true,experimentalHanja:true};
 const defaultBudget=describeBatchBudget(sentence,[target0,target1],settings);
 assert.equal(defaultBudget.outputLimit,65536);
 assert.equal(describeBatchBudget(sentence,[target0,target1],{...settings,manualOutputTokenLimit:131072}).outputLimit,131072);
 assert.equal(describeBatchBudget(sentence,[target0,target1],{tier:'512k',apiOutputTokenLimit:32000}).outputLimit,32000);
 const batches=contextReviewBatches([{result:{unresolved:[target0,target1]}}],sentence,{...settings,manualOutputTokenLimit:120000});
 assert.equal(batches[0].budget.outputLimit,120000);
 assert.ok(defaultBudget.outputTokens<2000,'literal choice replies should not reserve an extra proposal object per target');
});

test('target flags no longer need a separate proposal reservation or field',()=>{
 const ordinary=describeBatchBudget(sentence,[target0,target1],{tier:'512k',manual:true});
 const experimental=describeBatchBudget(sentence,[target0,target1],{tier:'512k',manual:true,experimentalHanja:true});
 assert.ok(experimental.inputTokens>ordinary.inputTokens);
 assert.ok(experimental.outputTokens>ordinary.outputTokens);
 const properNoun=describeBatchBudget(sentence,[{...target0,proper_noun:true},target1],
  {tier:'512k',manual:true,experimentalHanja:true});
 assert.equal(properNoun.outputTokens,experimental.outputTokens,
  'proper noun flags alone must not suppress literal-origin output budget');
 const forbidden=describeBatchBudget(sentence,[{...target0,dictionary_person_name:true},{...target1,scan_only:true}],
  {tier:'512k',manual:true,experimentalHanja:true});
 assert.ok(forbidden.outputTokens<experimental.outputTokens);
});

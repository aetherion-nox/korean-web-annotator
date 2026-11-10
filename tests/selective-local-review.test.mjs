import test from 'node:test';
import assert from 'node:assert/strict';
import {runSentencePipeline} from '../annotation-pipeline.js';

const sentence='경제를 논의한다.';
const identity={engine_version:'selective-test',dictionary_fingerprint:'dict-1'};
const conversion={start:0,end:2,surface:'경제',replacement:'經濟',type:'hanja'};
const target={target_id:'t0',start:0,end:2,surface:'경제',context:sentence,
 options:[
  {choice_id:'KEEP',type:'keep',replacement:'경제',entry_id:null,definitions:[]},
  {choice_id:'n0',type:'nonconversion',replacement:'경제',entry_id:3,definitions:['native sense']},
  {choice_id:'c0',type:'hanja',replacement:'經濟',entry_id:4,definitions:['economy']}
 ]};
function setup({model=true,selective=true,answer='c0',localKept=false}={}){
 const observed=[],modesSeen=[];
 const analyze=async(_text,modes)=>{
  modesSeen.push({...modes});
  return {...identity,annotations:localKept?[]:modes.reviewLocalConversions?[]:[conversion],
   targets:localKept?[]:modes.reviewLocalConversions?[target]:[],
   stats:{local_determined:localKept?0:modes.reviewLocalConversions?0:1,pending:localKept?0:modes.reviewLocalConversions?1:0}};
 };
 const fakeRequest=async(_,targets)=>({results:targets.map(t=>({target_id:t.target_id,choice_id:answer}))});
 const modelConfig=async()=>({model:'test',endpoint:'test://local',request:fakeRequest,reviewPosFilter:false});
 const options={status:async()=>({...identity,dictionary_metadata:{}}),analyze,enabled:model,modelConfig,
  cache:new Map(),persist:async()=>{}};
 const call=async()=>runSentencePipeline({operationId:'selective',sentences:[{id:'s0',text:sentence}],
  modes:{hanja:true,loanword:true},reviewLocalConversions:selective&&model},event=>observed.push(event),options);
 const modelEvents=()=>observed.filter(e=>e.type==='RESULTS'&&e.source==='model');
 const localEvents=()=>observed.filter(e=>e.type==='RESULTS'&&e.source==='local');
 return {call,observed,modesSeen,modelEvents,localEvents};
}

test('default-on selective review sends positive local conversions to model without local painting',async()=>{
 const s=setup();await s.call();
 assert.equal(s.modesSeen[0].reviewLocalConversions,true);
 assert.deepEqual(s.localEvents()[0].results[0].annotations,[]);
 assert.equal(s.modelEvents().at(-1).results[0].annotations[0].replacement,'經濟');
});

test('model may reject a local conversion by KEEP or explicit nonconversion',async()=>{
 for(const answer of ['KEEP','n0']){
  const s=setup({answer});await s.call();
  assert.deepEqual(s.modelEvents().at(-1).results[0].annotations,[]);
 }
});

test('locally kept Korean stays unchanged and is not sent to model',async()=>{
 const s=setup({localKept:true});await s.call();
 assert.equal(s.modelEvents().length,1); // empty final event for stable UI reconciliation
 assert.deepEqual(s.modelEvents()[0].results[0].annotations,[]);
 assert.deepEqual(s.localEvents()[0].results[0].annotations,[]);
});

test('disabling selective review preserves direct local conversions and the original model pipeline',async()=>{
 const s=setup({selective:false});await s.call();
 assert.equal(s.modesSeen[0].reviewLocalConversions,undefined);
 assert.equal(s.localEvents()[0].results[0].annotations[0].replacement,'經濟');
 assert.deepEqual(s.modelEvents().at(-1).results[0].annotations,[]);
});

test('no configured model keeps original offline local behavior',async()=>{
 const s=setup({model:false});await s.call();
 assert.equal(s.modesSeen[0].reviewLocalConversions,undefined);
 assert.equal(s.localEvents()[0].results[0].annotations[0].replacement,'經濟');
});

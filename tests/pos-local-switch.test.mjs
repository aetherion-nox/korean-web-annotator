import test from 'node:test';
import assert from 'node:assert/strict';
test('POS switch flows into local analysis and local caches keep both states separate',async()=>{
 const {runSentencePipeline}=await import('../annotation-pipeline.js');
 const identity={engine_version:'pos-switch-engine',dictionary_fingerprint:'dictionary'};
 const cache=new Map(),seen=[];
 for(const flag of [true,false,true]){
  await runSentencePipeline({operationId:'pos-switch',sentences:[{id:'s',text:'하이'}],modes:{loanword:true},reviewPosFilter:flag},()=>{},{
   enabled:false,cache,status:async()=>identity,
   analyze:async(_text,modes)=>{seen.push(modes.reviewPosFilter);return {...identity,annotations:[],targets:[],stats:{}};}
  });
 }
 assert.deepEqual(seen,[true,false]);
});

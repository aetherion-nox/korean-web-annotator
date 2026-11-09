import test from 'node:test';
import assert from 'node:assert/strict';
import {runSentencePipeline} from '../annotation-pipeline.js';
const baseAnnotation={start:0,end:1,surface:'학',replacement:'學',type:'hanja'};
const analyze=async(text,modes)=>({engine_version:'fixture',dictionary_fingerprint:'dict',
 annotations:[baseAnnotation],targets:[],stats:{local_determined:1,pending:0,protected_names:0}});
const status=async()=>({engine_version:'fixture',dictionary_fingerprint:'dict'});
test('single-syllable local annotations cannot reach display even if a backend regresses',async()=>{
 const events=[];
 await runSentencePipeline({operationId:'guarded',sentences:[{id:'s',text:'학'}],
 modes:{hanja:true,loanword:false},singleHangulLocalGuard:true},e=>events.push(e),{analyze,status,enabled:false});
 const local=events.find(e=>e.type==='RESULTS'&&e.source==='local');
 assert.deepEqual(local.results[0].annotations,[]);
 assert.equal(events.find(e=>e.type==='DONE').stats.local_determined,0);
});
test('explicitly disabling the guard leaves established local behavior unchanged',async()=>{
 const events=[];
 await runSentencePipeline({operationId:'unguarded',sentences:[{id:'s',text:'학'}],
 modes:{hanja:true,loanword:false},singleHangulLocalGuard:false},e=>events.push(e),{analyze,status,enabled:false});
 const local=events.find(e=>e.type==='RESULTS'&&e.source==='local');
 assert.equal(local.results[0].annotations[0].replacement,'學');
});

test('complete verified mixed word keeps local one-syllable component annotations',async()=>{
 const entries=[
  {start:0,end:1,surface:'팀',replacement:'team',type:'loanword'},
  {start:1,end:2,surface:'장',replacement:'長',type:'hanja'}
 ];
 const localAnalyze=async()=>({engine_version:'fixture',dictionary_fingerprint:'dict',
   annotations:entries,targets:[],confirmed_whole_spans:[{start:0,end:2}],stats:{local_determined:2,pending:0,protected_names:0}});
 const events=[];
 await runSentencePipeline({operationId:'verified',sentences:[{id:'s',text:'팀장'}],
  modes:{hanja:true,loanword:true},singleHangulLocalGuard:true},e=>events.push(e),
  {analyze:localAnalyze,status,enabled:false});
 const local=events.find(e=>e.type==='RESULTS'&&e.source==='local');
 assert.equal(local.results[0].annotations.length,2);
 assert.deepEqual(local.results[0].annotations.map(a=>a.replacement),['team','長']);
});

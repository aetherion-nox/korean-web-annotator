import test from 'node:test';
import assert from 'node:assert/strict';
import {runSentencePipeline} from '../annotation-pipeline.js';

const identity={engine_version:'batch-fixture',dictionary_fingerprint:'fixed-dictionary'};
function result(text){
 return {...identity,annotations:[{start:0,end:2,surface:'학교',type:'hanja',replacement:'學校',entry_id:1}],
   targets:[],stats:{local_determined:1,pending:0,timings_ms:{kiwi:1,converter:2,sqlite_queries:0.5,total:5}}};
}
function eventSummary(events){
 return events.filter(e=>e.type==='RESULTS').map(e=>({source:e.source,results:e.results}));
}
const base={modes:{hanja:true,loanword:true},operationId:'batch-test'};

test('419 independent paragraphs keep exact order and results with bounded local batches',async()=>{
 const sentences=Array.from({length:419},(_,i)=>({id:'p'+i,text:'학교 규정'+i}));
 const originalEvents=[],batchedEvents=[],requests=[],singles=[];
 const options={status:async()=>identity,enabled:false};
 await runSentencePipeline({...base,sentences},e=>originalEvents.push(e),{
   ...options,analyze:async text=>result(text)
 });
 await runSentencePipeline({...base,sentences},e=>batchedEvents.push(e),{
   ...options,analyze:async text=>{singles.push(text);return result(text);},
   analyzeBatch:async texts=>{
     requests.push([...texts]);
     return texts.map(result);
   }
 });
 assert.deepEqual(eventSummary(batchedEvents),eventSummary(originalEvents));
 assert.deepEqual(batchedEvents.filter(e=>e.type==='RESULTS').map(e=>e.results[0].id),sentences.map(s=>s.id));
 assert.ok(requests.length>0&&requests.length<=36,'419 short paragraphs should use about 35 round-trips');
 assert.ok(requests.every(t=>t.length>=2&&t.length<=12));
 assert.equal(singles.length,0,'no redundant individual bridge request for these full batches');
 assert.ok(batchedEvents.some(e=>e.type==='DONE'));
 const diagnostic=batchedEvents.find(e=>e.type==='DIAGNOSTIC'&&e.diagnostic?.message?.startsWith('本地分析汇总：'));
 assert.equal(JSON.parse(diagnostic.diagnostic.detail).batchCalls,requests.length);
 assert.equal(JSON.parse(diagnostic.diagnostic.detail).stageTimingsMs.kiwi,419);
});

test('cache hits and repeated paragraphs do not trigger repeated work',async()=>{
 const text='학교 문헌';
 const sentences=Array.from({length:29},(_,i)=>({id:'d'+i,text}));
 const cache=new Map(),calls=[],events=[];
 await runSentencePipeline({...base,sentences},e=>events.push(e),{
   enabled:false,status:async()=>identity,cache,
   analyze:async t=>{calls.push(['single',t]);return result(t);},
   analyzeBatch:async texts=>{calls.push(['batch',texts]);return texts.map(result);}
 });
 assert.deepEqual(calls,[['single',text]],'the first batch should deduplicate identical texts');
 assert.equal(cache.size,1,'original per-paragraph cache key stays stable');
 assert.equal(events.filter(e=>e.type==='RESULTS').length,29);
 const second=[];
 await runSentencePipeline({...base,operationId:'repeat',sentences},e=>second.push(e),{
   enabled:false,status:async()=>identity,cache,
   analyze:async()=>{throw Error('warm cache should bypass analysis');},
   analyzeBatch:async()=>{throw Error('warm cache should bypass batch');}
 });
 assert.equal(second.filter(e=>e.type==='RESULTS').length,29);
});

test('bounded batch uses single fallback and never crosses cached paragraphs',async()=>{
 const sentences=[
  {id:'s0',text:'학교A'},{id:'s1',text:'학교B'},{id:'s2',text:'학교C'},
  {id:'s3',text:'학교D'},{id:'s4',text:'학교E'}];
 const cache=new Map(),events=[],calls=[];
 // Seed cached paragraph s2 with a normal request, ensuring the batch
 // does not silently precompute across already-saved work.
 await runSentencePipeline({...base,operationId:'seed',sentences:[sentences[2]]},()=>{},{
  enabled:false,status:async()=>identity,cache,analyze:async t=>result(t)
 });
 await runSentencePipeline({...base,sentences},e=>events.push(e),{
  enabled:false,status:async()=>identity,cache,
  analyze:async t=>{calls.push(['single',t]);return result(t);},
  analyzeBatch:async texts=>{calls.push(['batch',texts]);return texts.map(result);}
 });
 assert.deepEqual(calls,[['batch',['학교A','학교B']],['batch',['학교D','학교E']]]);
 assert.equal(events.filter(e=>e.type==='RESULTS').length,5);
});

test('invalid batch count cannot be silently applied to a different source paragraph',async()=>{
 const sentences=[{id:'x',text:'학교A'},{id:'y',text:'학교B'}];
 await assert.rejects(runSentencePipeline({...base,sentences},()=>{},{
  enabled:false,status:async()=>identity,analyze:async()=>{throw Error('must use batch');},
  analyzeBatch:async()=>[result(sentences[0].text)]
 }),/invalid paragraph count/);
});

test('48k-character bound limits batch transport without truncating paragraphs',async()=>{
 const sentences=Array.from({length:7},(_,i)=>({id:'long'+i,text:'학교'+String(i).padStart(4,'0')+'가'.repeat(15994)}));
 const sizes=[];
 await runSentencePipeline({...base,sentences},()=>{},{
  enabled:false,status:async()=>identity,
  analyze:async text=>result(text),
  analyzeBatch:async texts=>{sizes.push(texts.map(t=>t.length));return texts.map(result);}
 });
 assert.deepEqual(sizes,[[16000,16000,16000],[16000,16000,16000]]);
});

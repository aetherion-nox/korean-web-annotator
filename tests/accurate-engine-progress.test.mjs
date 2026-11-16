import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {runSentencePipeline} from '../annotation-pipeline.js';

const identity={engine_version:'warm-fixture',dictionary_fingerprint:'fixture-db'};
const message={operationId:'warm-session-1',sentences:[{id:'p0',text:'학교에 갔다.'}],modes:{hanja:true,loanword:true}};
const local=async()=>({...identity,annotations:[],targets:[],stats:{}});

test('an already warm engine starts analyzing without a fictitious dictionary loading stage',async()=>{
 const events=[];
 let checks=0;
 await runSentencePipeline(message,event=>events.push(event),{
  status:async()=>{checks++;return identity;},analyze:local
 });
 assert.equal(checks,1,'every task still validates its engine identity');
 assert.equal(events.some(e=>e.type==='LOCAL_PROGRESS'&&e.stage==='dictionary'),false,
  'a warm status lookup is not a dictionary load');
 assert.equal(events.some(e=>e.type==='LOCAL_PROGRESS'&&e.stage==='analysis'),true);
 assert.equal(events.some(e=>e.type==='DONE'),true);
});

test('an actual cold engine emits its dictionary/tokenizer stages unchanged',async()=>{
 const events=[];
 await runSentencePipeline({...message,operationId:'cold-session-1'},
  event=>events.push(event),{
   status:async(_signal,progress)=>{
    progress({stage:'dictionary'});
    progress({stage:'tokenizer'});
    return identity;
   },analyze:local
  });
 const stages=events.filter(e=>e.type==='LOCAL_PROGRESS').map(e=>e.stage);
 assert.deepEqual(stages.slice(0,3),['dictionary','tokenizer','analysis']);
 assert.equal(stages.filter(s=>s==='dictionary').length,1,
  'do not double-report dictionary loading from pipeline and engine');
});

test('already warmed offscreen engine status skips IndexedDB reading and loading progress',async()=>{
 const file=fs.readFileSync(new URL('../engine-page.js',import.meta.url),'utf8');
 const source=file.replace(/^import .*;\r?\n/gm,'')
  .replace("new URL('./browser-worker.js',import.meta.url)","'browser-worker.js'");
 const isolated=source.slice(0,source.indexOf('chrome.runtime.onMessage.addListener'));
 assert.ok(isolated.includes('async function dispatch(request)'));
 let storageReads=0,workers=0;
 const reported=[];
 class FakeWorker{
  constructor(){workers++;}
  postMessage({id,request}){
   const result=request.action==='status'?{ready:true,...identity}:
    {ready:true,...identity};
   Promise.resolve().then(()=>this.onmessage({data:{id,ok:true,result}}));
  }
  terminate(){}
 }
 const ctx={
  storage:async(action,key)=>{
   if(action==='get'&&key==='dictionary'){storageReads++;return new ArrayBuffer(8);}
   throw Error('Unexpected storage request '+action+':'+key);
  },
  Worker:FakeWorker,Promise,Map,Error,ArrayBuffer,URL,console,
  chrome:{runtime:{sendMessage:async data=>{reported.push(data);}}}
 };
 vm.createContext(ctx);vm.runInContext(isolated,ctx);
 const cold=await ctx.dispatch({action:'status',progressId:'first'});
 assert.equal(cold.ready,true);
 assert.equal(storageReads,1);
 assert.equal(workers,1);
 assert.equal(reported.filter(x=>x.progress?.stage==='dictionary').length,1);
 const warm=await ctx.dispatch({action:'status',progressId:'second'});
 assert.equal(warm.ready,true);
 assert.equal(storageReads,1,'second status does not re-read the saved database');
 assert.equal(workers,1,'second status reuses the existing worker');
 assert.equal(reported.filter(x=>x.progress?.stage==='dictionary').length,1,
  'second analysis must not show dictionary loading unless worker was reset');
});

test('content script begins with neutral preparation and retains real progress stages',()=>{
 const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
 assert.match(source,/currentTask = task;[\s\S]{0,400}status\('准备分析…'\)/);
 assert.match(source,/function renderTaskActivity\(task\)/);
 assert.match(source,/activity\.lastConfirmedAt/);
 assert.match(source,/clearInterval\(task\.activityTimer\)/);
 assert.match(source,/result\.stage==='analysis-paragraph'/);
 assert.match(source,/result\.stage==='analysis-phase'/);
 assert.doesNotMatch(source,/currentTask = task;\s*status\('加载词典…'\)/);
 assert.match(source,/result\.stage==='dictionary'\)\{\s*status\('加载词典…'\)/);
 assert.match(source,/result\.stage==='tokenizer'\)\{\s*status\('初始化分词器…'\)/);
 assert.match(source,/result\.stage==='analysis-batch'/);
 assert.match(source,/result\.batchUniqueParagraphs/);
 assert.match(source,/result\.batchCharacters/);
});

test('batch progress reports the entire in-flight range and never mislabels the first paragraph length',async()=>{
 const identity={engine_version:'warm-fixture',dictionary_fingerprint:'fixture-db'};
 const sentences=Array.from({length:14},(_,i)=>({id:'s'+i,text:'학교'+String(i).repeat(i%4+1)}));
 const events=[];
 const finished=text=>({...identity,annotations:[],targets:[],
   stats:{timings_ms:{total:text.length===sentences[1].text.length?7:0.5}}});
 await runSentencePipeline({operationId:'batch-progress',sentences,modes:{hanja:true}},
   e=>events.push(e),{
    status:async()=>identity,enabled:false,
    analyze:async text=>finished(text),
    analyzeBatch:async texts=>texts.map(finished)
   });
 const batches=events.filter(e=>e.type==='LOCAL_PROGRESS'&&e.stage==='analysis-batch');
 assert.equal(batches.length,2);
 assert.deepEqual(batches.map(e=>[e.batchStart,e.batchEnd,e.batchParagraphs,e.batchCharacters]),[
  [1,12,12,sentences.slice(0,12).reduce((sum,s)=>sum+s.text.length,0)],
  [13,14,2,sentences.slice(12).reduce((sum,s)=>sum+s.text.length,0)]
 ]);
 const singles=events.filter(e=>e.type==='LOCAL_PROGRESS'&&e.stage==='analysis');
 assert.equal(singles.length,0,'batch must not claim its first paragraph is the only one being analyzed');
 const results=events.filter(e=>e.type==='RESULTS'&&e.source==='local');
 assert.deepEqual(results.map(e=>[e.currentSentence,e.sentenceCharacters]),
  sentences.map((s,i)=>[i+1,s.text.length]));
 const summary=events.find(e=>e.type==='DIAGNOSTIC'&&e.diagnostic?.message?.startsWith('本地分析汇总：'));
 const details=JSON.parse(summary.diagnostic.detail);
 assert.equal(details.slowestSentenceChars,sentences[1].text.length,
  'slowest paragraph uses actual Python analysis timing, not the batch first-in-flight wall clock');
 assert.ok(details.slowestSentenceMs<20);
});

test('actual engine milestones keep exact paragraph identity within a batched and deduplicated request',async()=>{
 const sentences=[{id:'n0',text:'학교 가'},{id:'n1',text:'학교 나'},
   {id:'n2',text:'학교 가'},{id:'n3',text:'학교 다'}];
 const events=[],identity={engine_version:'warm-fixture',dictionary_fingerprint:'fixture-db'};
 const out=text=>({...identity,annotations:[],targets:[],stats:{
  token_count:text.length,segment_count:2,option_count:3,
  timings_ms:{kiwi:1,converter:2,total:text.length*3,sqlite_queries:0.25}}});
 await runSentencePipeline({operationId:'real-milestones',sentences,modes:{hanja:true}},
  event=>events.push(event),{
    status:async()=>identity,
    analyze:async()=>{throw Error('expected a real deduplicated batch');},
    analyzeBatch:async(texts,modes,signal,notify)=>{
     assert.deepEqual(texts,['학교 가','학교 나','학교 다']);
     for(let i=0;i<texts.length;i++){
      notify({stage:'analysis-paragraph',event:'start',batchIndex:i+1,batchTotal:texts.length,
       sentenceCharacters:texts[i].length});
      notify({stage:'analysis-phase',phase:'converter',event:'start',batchIndex:i+1,
       batchTotal:texts.length});
      notify({stage:'analysis-phase',phase:'converter',event:'done',batchIndex:i+1,
       batchTotal:texts.length});
      notify({stage:'analysis-paragraph',event:'done',batchIndex:i+1,batchTotal:texts.length,
       batchDoneUnique:i+1,sentenceCharacters:texts[i].length});
     }
     return texts.map(out);
    }
  });
 const phases=events.filter(e=>e.type==='LOCAL_PROGRESS'&&e.stage==='analysis-phase');
 assert.deepEqual(phases.filter(e=>e.event==='start').map(e=>e.currentSentence),[1,2,4],
  'unique text item 3 corresponds to source paragraph 4, not 3');
 assert.ok(phases.every(e=>e.batchStart===1&&e.batchEnd===4&&e.batchCharacters===16));
 const items=events.filter(e=>e.type==='LOCAL_PROGRESS'&&e.stage==='analysis-paragraph');
 assert.deepEqual(items.filter(e=>e.event==='done').map(e=>e.batchDoneUnique),[1,2,3]);
 assert.deepEqual(events.filter(e=>e.type==='RESULTS'&&e.source==='local')
   .map(e=>[e.currentSentence,e.sentenceCharacters]),
  sentences.map((s,i)=>[i+1,s.text.length]));
 const top=events.find(e=>e.type==='DIAGNOSTIC'&&e.diagnostic?.message?.startsWith('本地分析最慢'));
 assert.ok(top);
 const ranked=JSON.parse(top.diagnostic.detail).slowestParagraphs;
 assert.equal(ranked.length,3,'the duplicate text was served from in-task cache');
 assert.deepEqual(ranked.map(x=>x.sentenceId),['n0','n1','n3']);
 assert.ok(ranked.every(x=>x.timingsMs.converter===2&&x.optionCount===3));
});

test('top-five slowest includes only freshly analyzed paragraphs and stays ranked by measured Python time',async()=>{
 const identity={engine_version:'warm-fixture',dictionary_fingerprint:'fixture-db'};
 const sentences=Array.from({length:9},(_,i)=>({id:'rank'+i,text:'학교'+i}));
 const events=[];
 await runSentencePipeline({operationId:'rank-milestones',sentences,modes:{hanja:true}},
  e=>events.push(e),{status:async()=>identity,analyze:async text=>({...identity,
   annotations:[],targets:[],stats:{token_count:2,option_count:0,
    timings_ms:{total:10+Number(text.at(-1))*7,kiwi:1,mixed:2,sqlite_queries:0.3}}})});
 const details=JSON.parse(events.find(e=>e.type==='DIAGNOSTIC'&&e.diagnostic?.message?.startsWith('本地分析最慢')).diagnostic.detail);
 assert.deepEqual(details.slowestParagraphs.map(p=>p.sentenceId),['rank8','rank7','rank6','rank5','rank4']);
 assert.equal(details.slowestParagraphs[0].ms,66);
 assert.equal(details.slowestParagraphs[0].tokenCount,2);
});

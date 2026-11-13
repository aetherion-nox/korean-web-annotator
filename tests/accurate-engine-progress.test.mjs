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
 assert.match(source,/currentTask = task;\s*status\('准备分析…'\)/);
 assert.doesNotMatch(source,/currentTask = task;\s*status\('加载词典…'\)/);
 assert.match(source,/result\.stage==='dictionary'\?'加载词典…'/);
 assert.match(source,/result\.stage==='tokenizer'\?'初始化分词器…'/);
});

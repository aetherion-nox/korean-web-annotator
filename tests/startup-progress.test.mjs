import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
import {runSentencePipeline} from '../annotation-pipeline.js';
const root=new URL('../',import.meta.url);
async function page(saved=true){
 let listener;const calls=[],events=[];const identity={ready:true,engine_version:'engine',dictionary_fingerprint:'dict'};
 class Worker{postMessage(data){calls.push(data.request);queueMicrotask(()=>this.onmessage({data:{id:data.id,progress:{stage:'tokenizer'}}}));queueMicrotask(()=>this.onmessage({data:{id:data.id,ok:true,result:{...identity}}}));}terminate(){}}
 let src=await fs.readFile(new URL('engine-page.js',root),'utf8');src=src.replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(root.href));
 const context={Worker,URL,Map,Promise,Error,Boolean,String,storage:async(action,key)=>action==='get'?(key==='dictionary'?(saved?new ArrayBuffer(4):null):{kind:'db',name:'replacement.db',bytes:new ArrayBuffer(4)}):undefined,copyPlainText(){},createKiwiManager:()=>({status:async()=>({identity:'built-in'}),tokenize:async()=>null}),chrome:{runtime:{id:'test',onMessage:{addListener:f=>listener=f},sendMessage:async e=>{events.push(e);}}}};
 vm.runInNewContext(src,context);
 const send=request=>new Promise(resolve=>listener({type:'BROWSER_ENGINE_WORK',request},{id:'test'},resolve));return {send,calls,events};
}
test('cold status hydrates and reports progress without repeating status or settling early',async()=>{
 const p=await page();const reply=await p.send({action:'status',progressId:'one'});assert.equal(reply.ok,true);assert.equal(reply.result.ready,true);assert.equal(p.calls.length,1);assert.ok(p.events.some(e=>e.progressId==='one'&&e.progress.stage==='tokenizer'));
 const again=await p.send({action:'status'});assert.equal(again.result.ready,true);assert.equal(p.calls.length,2);
});
test('pipeline reports real loading and current paragraph before its result, including cache reuse',async()=>{
 const identity={engine_version:'engine',dictionary_fingerprint:'dict'},events=[],cache=new Map();let analyses=0;
 const run=()=>runSentencePipeline({operationId:'op',sentences:[{id:'s0',text:'학교'},{id:'s1',text:'학교'}],modes:{hanja:true}},e=>events.push(e),{cache,status:async(signal,progress)=>{progress?.({stage:'dictionary'});return identity;},analyze:async(text,modes,signal,progress)=>{analyses++;progress?.({stage:'tokenizer'});progress?.({stage:'analysis'});return {...identity,annotations:[],targets:[],stats:{}};}});
 await run();assert.equal(analyses,1);const progress=events.filter(e=>e.type==='LOCAL_PROGRESS');assert.ok(progress.some(e=>e.stage==='dictionary'));assert.ok(progress.some(e=>e.stage==='tokenizer'));assert.ok(progress.some(e=>e.stage==='analysis'&&e.currentSentence===2&&e.totalSentences===2));assert.equal(progress.find(e=>e.currentSentence===1).completedSentences,0);assert.ok(events.findIndex(e=>e.type==='LOCAL_PROGRESS')<events.findIndex(e=>e.type==='RESULTS'));
});
test('worker attaches dictionary once, initializes tokenizer lazily and emits real phases',async()=>{
 let message;const events=[],pythonCalls=[];let exists=false;
 const python={loadPackage:async()=>{},FS:{mkdirTree(){},writeFile(path){if(path==='/data/hanja_dict.db')exists=true;},analyzePath:()=>({exists}),unlink(){}},globals:{set(){},delete(){}},runPythonAsync:async code=>{pythonCalls.push(code);return code.includes('browser_bridge.request')?JSON.stringify({ready:true}):undefined;}};
 const src=(await fs.readFile(new URL('browser-worker.js',root),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(root.href));
 const context={URL,Map,Promise,Error,String,JSON,Uint8Array,loadPyodide:async()=>python,fetch:async()=>({json:async()=>({kiwi_version:'test',model_files:[]})}),KiwiBuilder:{create:async()=>({version:()=> 'test',build:async()=>({tokenize:()=>[]})})},Match:{all:0},self:{postMessage:e=>{events.push(e);if(e.ok!==undefined)message?.(e);}}};
 vm.runInNewContext(src,context);const send=(id,request)=>new Promise(resolve=>{message=resolve;context.self.onmessage({data:{id,request}});});
 await send(1,{action:'status',database:new ArrayBuffer(4)});assert.equal(pythonCalls.filter(s=>s==='await browser_bridge.initialize()').length,0);assert.ok(!events.some(e=>e.progress?.stage==='tokenizer'));
 await send(2,{action:'analyze',text:'학교'});assert.ok(events.some(e=>e.id===2&&e.progress?.stage==='tokenizer'));assert.ok(events.some(e=>e.id===2&&e.progress?.stage==='analysis'));
 const before=events.filter(e=>e.progress?.stage==='tokenizer').length;await send(3,{action:'analyze',text:'학교'});assert.equal(events.filter(e=>e.progress?.stage==='tokenizer').length,before);
});
test('progress routes to its own request and listeners are removed on success and failure',async()=>{
 const {configureBrowserEngineHost,browserEngineStatus}=await import('../browser-engine.js');const listeners=new Set(),received=[];
 const previous=globalThis.chrome;globalThis.chrome={runtime:{id:'test',onMessage:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)}}};
 try{
  configureBrowserEngineHost(async request=>{for(const f of listeners){f({type:'BROWSER_ENGINE_PROGRESS',progressId:'other',progress:{stage:'wrong'}},{id:'test'});f({type:'BROWSER_ENGINE_PROGRESS',progressId:request.progressId,progress:{stage:'dictionary'}},{id:'test'});}return {ok:true,result:{ready:true}};});
  assert.equal((await browserEngineStatus(undefined,p=>received.push(p))).ready,true);assert.deepEqual(received,[{stage:'dictionary'}]);assert.equal(listeners.size,0);
  configureBrowserEngineHost(async()=>{throw Error('worker failed');});await assert.rejects(browserEngineStatus(undefined,()=>{}),/worker failed/);assert.equal(listeners.size,0);
 }finally{configureBrowserEngineHost(undefined);globalThis.chrome=previous;}
});

test('preload shares queue with manual analysis, skips missing dictionaries and resets after import',async()=>{
 const absent=await page(false);const skipped=await absent.send({action:'warmup'});assert.equal(skipped.result.skipped,true);assert.equal(absent.calls.length,0);
 const p=await page();const results=await Promise.all([p.send({action:'warmup'}),p.send({action:'analyze',text:'학교'})]);assert.ok(results.every(r=>r.ok));assert.deepEqual(p.calls.map(c=>c.action),['status','warmup','analyze']);
 const before=p.calls.length;await p.send({action:'warmup'});assert.equal(p.calls.length,before);
 await p.send({action:'import',upload:'uploaded'});await p.send({action:'warmup'});assert.deepEqual(p.calls.slice(before).map(c=>c.action),['import-db','warmup']);
});

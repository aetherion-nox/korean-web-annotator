import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {reviewTargets} from '../choice-review.js';
import {buildReviewPayload} from '../review-payload.js';
import {runSentencePipeline} from '../annotation-pipeline.js';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');

function target(id,surface,start,options,extra={}){
 return {target_id:id,surface,start,end:start+surface.length,
   context:'데 학교',options:[
     {choice_id:null,type:'keep',replacement:surface,entry_id:null,definitions:[]},
     ...options],...extra};
}
const one=target('t0','데',0,[
 {choice_id:'n0',type:'nonconversion',replacement:'데',entry_id:1,
  definitions:['native bound noun'],part_of_speech:'의존 명사'},
 {choice_id:'c0',type:'hanja',replacement:'臺',entry_id:2,
  definitions:['platform'],part_of_speech:'명사'}
],{morphology:[{form:'데',tag:'NNB',start:0,end:1}]});
const two=target('t1','학교',2,[
 {choice_id:'c0',type:'hanja',replacement:'學校',entry_id:3,
  definitions:['school'],part_of_speech:'명사'}
],{morphology:[{form:'학교',tag:'NNG',start:2,end:4}]});

test('an interrupted SSE stream commits only its complete, validated rows and retries missing targets',async()=>{
 const oldFetch=globalThis.fetch;let calls=0;const committed=[],events=[];
 const logger={start:async()=>1,finish:async()=>{}};
 globalThis.fetch=async()=>{
  calls++;
  if(calls===1){
   const delta=JSON.stringify({choices:[{index:0,delta:{
     content:'{"results":[{"t":"t0","c":"c0"},'}}]});
   // Abrupt EOF without finish_reason, trailing row and closing array:
   // t0 is fully parsed, t1 is not.
   return new Response('data: '+delta+'\n\n',{
    headers:{'content-type':'text/event-stream'}});
  }
  return new Response(JSON.stringify({choices:[{index:0,finish_reason:'stop',
    message:{content:'{"results":[{"t":"t1","c":"c0"}]}'}}]}),{
     headers:{'content-type':'application/json'}});
 };
 try{
  const r=await reviewTargets({
   enableModelReview:true,provider:'deepseek',model:'fixture',
   endpoint:'https://example.test/v1/chat/completions',logger,stream:true,
   reviewPosFilter:false,timeoutMs:10000,context:'데 학교',
   onAccepted:rows=>committed.push(...rows.map(r=>r.target.target_id)),
   onDiagnostic:e=>events.push(e)
  },[one,two]);
  assert.equal(calls,2,'only the missing second target triggers the retry');
  assert.deepEqual(committed,['t0','t1'],JSON.stringify(events));
  assert.equal(r.accepted.length,2);
  assert.equal(r.unresolved.length,0);
  assert.ok(events.some(e=>e.stage==='partial'&&e.message.includes('1 条')));
 }finally{globalThis.fetch=oldFetch;}
});

test('normal review never sends nonconversion-only choices after POS filtering',async()=>{
 const identity={engine_version:'fixture',dictionary_fingerprint:'fixture'};
 const events=[],requested=[];
 const analysis={...identity,annotations:[],targets:[one,two],
  stats:{local_determined:0,pending:2}};
 await runSentencePipeline({
  operationId:'ordinary-filter',sentences:[{id:'p0',text:'데 학교'}],
  modes:{hanja:true,loanword:false}
 },event=>events.push(event),{
  enabled:true,status:async()=>identity,analyze:async()=>analysis,
  modelConfig:async()=>({
   provider:'manual-fixture',endpoint:'https://example.test/v1/chat/completions',
   model:'fixture',reviewPosFilter:true,
   request:async(_,wire)=>{
    requested.push(wire.map(t=>t.surface));
    return {results:wire.map(t=>({t:t.target_id,c:'c0'}))};
   }
  })
 });
 assert.equal(requested.length,1);
 assert.deepEqual(requested[0],['학교']);
 assert.ok(events.some(e=>e.type==='DONE'));
});

test('loanword direction glyphs never enter model candidate pool',()=>{
 const t=target('t0','셔츠',0,[
  {choice_id:'c0',type:'loanword',replacement:'←shirt',entry_id:1,
   definitions:['shirt'],written_form:'셔츠'}
 ]);
 t.context='셔츠';
 const {payload}=buildReviewPayload('셔츠',[t],{reviewPosFilter:false});
 assert.equal(payload.candidates[0].replacement,'shirt');
 assert.equal(t.options[1].replacement,'←shirt',
  'dictionary choice still retains its exact source spelling');
});

test('source extraction separates adjacent independent links but not inline word formatting',()=>{
 const dom=new JSDOM('<div id="tags"><a>세무사</a><a>세무냥이</a><a>이돈호</a></div>'+
   '<p id="inline">기<em>자</em>회견</p>');
 const ctx={OWN_RUBY:'ruby[kra-annotated="true"]'};
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('  function sourceOf('),
  source.indexOf('  function pageIdentity(')),ctx);
 const tags=ctx.sourceOf(dom.window.document.querySelector('#tags'));
 assert.equal(tags.text,'세무사 세무냥이 이돈호');
 assert.deepEqual(Array.from(tags.runs,r=>tags.text.slice(r.start,r.end)),
  ['세무사','세무냥이','이돈호']);
 const inline=ctx.sourceOf(dom.window.document.querySelector('#inline'));
 assert.equal(inline.text,'기자회견','inline typography must not break a word');
 dom.window.close();
});

test('unexpected streaming disconnect finalizes with validated previews preserved',async()=>{
 const hooks={},calls=[],port={
  onDisconnect:{addListener:fn=>hooks.disconnect=fn},
  onMessage:{addListener:fn=>hooks.message=fn},
  postMessage(){},disconnect(){}
 };
 const ctx={currentTask:null,sequence:0,uiSettings:{progressiveAnnotation:true},
  history:[],diagnostics:[],document:{querySelector:()=>null,
   location:{href:'https://example.test/article'}},
  location:{href:'https://example.test/article'},
  chrome:{runtime:{connect:()=>port,getURL:x=>x,
    sendMessage:async()=>({ok:true,events:[]})}},
  collectTextNodes:()=>new Map(),lastScanStats:{textNodes:0,hangulNodes:0},
  cancelTask(){},addDiagnostic(){},status(...args){calls.push(['status',...args]);},
  sourceOf(){},pageIdentity:()=>'{article}',setTimeout:()=>1,
  BLOCK_TAGS:'p',setInterval:()=>1,clearInterval(){},
  clearTimeout(){},getToolbar:()=>({}),seenSources:new Set(),
  publishState(){},configureRecovery(){},recoverManualConnection:()=>false,
  finishTask(...args){calls.push(['finish',...args]);}
 };
 vm.createContext(ctx);
 const begin=source.indexOf('  let createParagraphPlan;');
 vm.runInContext(source.slice(begin,source.indexOf(
  '  chrome.runtime.onMessage.addListener',begin)),ctx);
 vm.runInContext('createParagraphPlan=()=>({sentences:[],context:""})',ctx);
 assert.equal((await ctx.startAnnotation({
  modes:{hanja:true,loanword:true},mergeGroupId:'grp',
  mergeHost:true})).ok,true);
 hooks.disconnect();
 await new Promise(resolve=>setImmediate(resolve));
 const finish=calls.find(c=>c[0]==='finish');
 assert.ok(finish);
 assert.equal(finish[4],true,
  'unexpected disconnection must preserve locally validated stream previews');
 assert.match(calls.findLast(c=>c[0]==='status')[1],/保留/);
});

test('non-progressive API mode sends completed results to the page before DONE without drawing until completion',async()=>{
 const identity={engine_version:'fixture',dictionary_fingerprint:'fixture'};
 const events=[];
 const analysis={...identity,annotations:[],targets:[two],
  stats:{local_determined:0,pending:1}};
 await runSentencePipeline({
  operationId:'nonprogressive-checkpoint',progressiveAnnotation:false,
  sentences:[{id:'p0',text:'데 학교'}],
  modes:{hanja:true,loanword:false}
 },event=>{events.push(event);},{
  enabled:true,status:async()=>identity,analyze:async()=>analysis,
  modelConfig:async()=>({
   provider:'fixture',endpoint:'https://example.test/v1/chat/completions',model:'fixture',
   request:async(_,wire)=>({results:wire.map(t=>({t:t.target_id,c:'c0'}))})
  })
 });
 assert.ok(events.some(e=>e.type==='RESULTS'&&e.source==='model'&&!e.provisional));
 assert.ok(events.findIndex(e=>e.type==='RESULTS'&&e.source==='model')<
  events.findIndex(e=>e.type==='DONE'));
});

test('finishTask propagates the preserve flag to reconciliation without clearing history',()=>{
 let passed=null,disconnected=0;
 const task={operationId:'op',finished:false,port:{disconnect(){disconnected++;}},
  reconcile(value){passed=value;}};
 const ctx={currentTask:task,document:{querySelector:()=>null},
  clearTimeout(){},clearInterval(){},configureRecovery(){}};
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('  function finishTask('),
  source.indexOf('  function cancelTask(')),ctx);
 ctx.finishTask(task,'stream dropped',false,true);
 assert.equal(passed,true);
 assert.equal(disconnected,1);
 assert.equal(task.finished,true);
});

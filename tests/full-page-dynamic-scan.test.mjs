import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createParagraphPlan} from '../paragraph-plan.js';
import {runSentencePipeline} from '../annotation-pipeline.js';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');

function setup(html){
 const dom=new JSDOM(html,{url:'https://news.example.test/article'});
 const ctx={
  document:dom.window.document,NodeFilter:dom.window.NodeFilter,
  OWN_RUBY:'ruby[kra-annotated="true"]',
  analyzedNodeVersions:new WeakMap(),seenSources:new Set(),
  lastScanStats:null,isKnownRecoverySource:()=>false,
  uiSettings:{stopAutoAfterPageComplete:true},
  MAX_RECOVERY_BLOCKS:12000,
  recoveryAnchor:()=>null
 };
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('  function selectedIntervals'),
  source.indexOf('  function applySettings')),ctx);
 vm.runInContext(source.slice(source.indexOf('  function openTextRoots'),
  source.indexOf('  function isKnownRecoverySource')),ctx);
 return {dom,ctx};
}

test('all 3,050 Korean text nodes are scanned and passed to paragraph grouping, not cut off at 3,000',()=>{
 const html='<main>'+Array.from({length:3050},(_,i)=>'<p data-index="'+i+'">한국어 문장</p>').join('')+'</main>';
 const {dom,ctx}=setup(html);
 const entries=ctx.collectTextNodes();
 assert.equal(entries.size,3050);
 assert.equal(ctx.lastScanStats.selectedNodes,3050);
 const plan=createParagraphPlan(entries,element=>({
  text:element.textContent,
  runs:[{node:element.firstChild,start:0,end:element.textContent.length}]
 }),'p');
 assert.equal(plan.sentences.length,3050);
 assert.equal(plan.context.split('\n').length,3050);
 dom.window.close();
});

test('two equal text strings at distinct DOM locations are independent annotation targets',()=>{
 const {dom,ctx}=setup('<main><p>많이 본 정보</p><aside><p>많이 본 정보</p></aside></main>');
 const [a,b]=dom.window.document.querySelectorAll('p');
 ctx.seenSources.add('많이 본 정보');
 ctx.analyzedNodeVersions.set(a.firstChild,'많이 본 정보');
 const auto=ctx.collectTextNodes(null,false,true);
 assert.equal(auto.size,1);
 assert.equal([...auto.keys()][0],b.firstChild);
 assert.equal(ctx.lastScanStats.skippedProcessed,1);
 b.firstChild.data='많이 본 정보 업데이트';
 const changed=ctx.collectTextNodes(null,false,true);
 assert.equal(changed.size,1,'changed text on a tracked node must be eligible again');
 dom.window.close();
});

test('hidden and aria-hidden tab content waits for visibility, then is scanned',()=>{
 const {dom,ctx}=setup('<p>뉴스</p><section id="hidden" style="display:none"><p>오늘의 인기정보</p></section>'+
  '<section id="aria" aria-hidden="true"><p>많이 본 정보</p></section>');
 let entries=ctx.collectTextNodes();
 assert.equal(entries.size,1);
 assert.equal(ctx.lastScanStats.skippedHidden,2);
 dom.window.document.querySelector('#hidden').style.display='block';
 dom.window.document.querySelector('#aria').setAttribute('aria-hidden','false');
 entries=ctx.collectTextNodes();
 assert.equal(entries.size,3);
 dom.window.close();
});

test('open Shadow DOM and nested open shadow roots are included in full-page discovery',()=>{
 const {dom,ctx}=setup('<main><p>본문</p><div id="host"></div></main>');
 const host=dom.window.document.querySelector('#host');
 const root=host.attachShadow({mode:'open'});
 root.innerHTML='<p>오늘의 인기정보</p><div id="nested"></div>';
 const sub=root.querySelector('#nested').attachShadow({mode:'open'});
 sub.innerHTML='<p>많이 본 정보</p>';
 const entries=ctx.collectTextNodes();
 assert.equal(entries.size,3);
 assert.equal(ctx.lastScanStats.shadowRoots,2);
 assert.deepEqual([...entries.values()].map(x=>x.text),
  ['본문','오늘의 인기정보','많이 본 정보']);
 dom.window.close();
});

test('shared discovery index reuses TreeWalker until the DOM changes',()=>{
 const {dom,ctx}=setup('<main><p>기존 본문</p><p>다른 본문</p></main>');
 const document=dom.window.document,original=document.createTreeWalker.bind(document);
 let traversals=0;
 document.createTreeWalker=(...args)=>{traversals++;return original(...args);};
 try{
  assert.equal(ctx.collectTextNodes().size,2);
  const initial=traversals;
  assert.ok(initial>0,'first scan constructs the index');
  assert.equal(ctx.collectTextNodes().size,2);
  assert.equal(traversals,initial,'second scan must use the indexed Korean nodes');
  const first=document.createElement('p');first.textContent='새로운 첫 문장';
  document.querySelector('main').prepend(first);
  assert.deepEqual([...ctx.collectTextNodes().values()].map(e=>e.text),
    ['새로운 첫 문장','기존 본문','다른 본문']);
  document.querySelector('p:nth-of-type(2)').remove();
  assert.deepEqual([...ctx.collectTextNodes().values()].map(e=>e.text),
    ['새로운 첫 문장','다른 본문']);
  first.firstChild.data='plain English';
  assert.deepEqual([...ctx.collectTextNodes().values()].map(e=>e.text),['다른 본문']);
 }finally{dom.window.close();}
});

test('index discovers a newly attached Shadow host and edits inside its root',()=>{
 const {dom,ctx}=setup('<main><p>원래 기사</p></main>');
 ctx.collectTextNodes();
 const host=dom.window.document.createElement('div');
 const root=host.attachShadow({mode:'open'});
 root.innerHTML='<p>새로 로드한 내용</p>';
 dom.window.document.querySelector('main').append(host);
 assert.deepEqual([...ctx.collectTextNodes().values()].map(e=>e.text),
  ['원래 기사','새로 로드한 내용']);
 root.querySelector('p').firstChild.data='수정된 내용';
 assert.ok([...ctx.collectTextNodes().values()].some(e=>e.text==='수정된 내용'));
 host.remove();
 assert.equal(ctx.collectTextNodes().size,1,'removed shadow content must leave index');
 dom.window.close();
});

test('manual forced reindex finds shadow content created without an outer childList mutation',()=>{
 const {dom,ctx}=setup('<main><p>기존 내용</p><div id="host"></div></main>');
 ctx.collectTextNodes();
 const host=dom.window.document.querySelector('#host');
 host.attachShadow({mode:'open'}).innerHTML='<p>숨은 새 한국어</p>';
 assert.equal(ctx.collectTextNodes().size,1,'an attachShadow call itself is not a DOM mutation');
 ctx.ensureTextIndex(true);
 assert.equal(ctx.collectTextNodes().size,2,'explicit full refresh must find late shadow roots');
 dom.window.close();
});

test('continued dynamic monitoring reacts to tab visibility toggles and nested shadow insertions',async()=>{
 const {dom,ctx}=setup('<p>기사 본문</p><section id="tab" hidden><p>많이 본 정보</p></section><div id="host"></div>');
 const root=dom.window.document.querySelector('#host').attachShadow({mode:'open'});
 root.innerHTML='<p>오늘의 인기정보</p>';
 const scheduled=[],started=[];
 Object.assign(ctx,{
  pageCompleted:true,uiSettings:{stopAutoAfterPageComplete:false,hanjaMode:true,loanwordMode:true},
  automaticObserver:null,automaticTimer:null,
  MutationObserver:dom.window.MutationObserver,ownDomChanges:new WeakSet(),
  isOwnMutation:()=>false,currentTask:null,openTextRoots:ctx.openTextRoots,
  clearTimeout:()=>{},setTimeout:cb=>{scheduled.push(cb);return scheduled.length;},
  startAnnotation:args=>{started.push(args);return {ok:true}}
 });
 vm.runInContext(source.slice(source.indexOf('  function hasFreshHangul('),
  source.indexOf("  if(typeof window==='undefined'||window===window.top)document.addEventListener('selectionchange'")),ctx);
 ctx.configureAutomaticAnnotation();
 dom.window.document.querySelector('#tab').hidden=false;
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(scheduled.length>=1,'a tab state change must queue a scan');
 scheduled.at(-1)();
 assert.equal(started.length,1);
 root.append(dom.window.document.createElement('p'));
 root.lastElementChild.textContent='새로운 인기 뉴스';
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(scheduled.length>=2,'changes in open ShadowRoot must queue a scan');
 scheduled.at(-1)();
 assert.equal(started.length,2);
 ctx.automaticObserver.disconnect();dom.window.close();
});

test('stop-after-completion switch still prevents continuous observer and model calls',async()=>{
 const {dom,ctx}=setup('<p>기사</p>');
 const started=[];
 Object.assign(ctx,{
  pageCompleted:true,uiSettings:{stopAutoAfterPageComplete:true},
  automaticObserver:null,automaticTimer:null,
  MutationObserver:dom.window.MutationObserver,
  clearTimeout:()=>{},setTimeout:cb=>{started.push(cb);return 1},
  startAnnotation:()=>{throw Error('continuous scan must not start')}
 });
 vm.runInContext(source.slice(source.indexOf('  function hasFreshHangul('),
  source.indexOf("  if(typeof window==='undefined'||window===window.top)document.addEventListener('selectionchange'")),ctx);
 ctx.configureAutomaticAnnotation();
 dom.window.document.querySelector('p').textContent='새 기사';
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ctx.automaticObserver,null);
 assert.equal(started.length,0);
 dom.window.close();
});


test('5,001 distinct paragraph sentences pass the worker pipeline without a new truncation failure',async()=>{
 const identity={engine_version:'scan-fixture',dictionary_fingerprint:'scan-fixture'};
 const sentences=Array.from({length:5001},(_,i)=>({id:'p'+i,text:'학교'}));
 let analyzed=0,done=false;
 await runSentencePipeline({operationId:'huge-page',sentences,modes:{hanja:true,loanword:false}},
  event=>{if(event.type==='DONE')done=true;},{
   status:async()=>identity,
   analyze:async()=>{analyzed++;return {...identity,annotations:[],targets:[],stats:{pending:0}};}
  });
 assert.equal(done,true);
 assert.ok(analyzed>=1);
});

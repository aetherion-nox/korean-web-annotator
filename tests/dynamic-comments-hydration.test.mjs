import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
const SOURCE=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');

function commentsDom(){
 return new JSDOM('<html><body><main><article><h1>국제 뉴스</h1>'+
 '<div id="div_comment"><div class="comment-feed">'+
 '<div class="comment-card"><span class="comment-card__username">한림재</span>'+
 '<span class="comment-card__commentcontent">학교에 갔다.</span></div></div>'+
 '</div></article></main></body></html>',{
  url:'https://www.chosun.com/international/international_general/2026/11/13/TEST/',
  pretendToBeVisual:true
 });
}
const helperBegin=SOURCE.indexOf('  function hasFreshHangul(');
const helperEnd=SOURCE.indexOf("  if(typeof window==='undefined'||window===window.top)document.addEventListener('selectionchange'",helperBegin);
assert.ok(helperBegin>0&&helperEnd>helperBegin,'mutation helpers are available for DOM tests');

test('real mobile comment-content span is included in normal DOM collection',()=>{
 const dom=commentsDom(),ctx={document:dom.window.document,NodeFilter:dom.window.NodeFilter,
  OWN_RUBY:'ruby[kra-annotated="true"]',lastScanStats:null,uiSettings:{},
  openTextRoots:()=>[dom.window.document.body],selectedIntervals:(node,text)=>[{start:0,end:text.length}],
  analyzedNodeVersions:new WeakMap(),isKnownRecoverySource:()=>false};
 vm.createContext(ctx);
 vm.runInContext(SOURCE.slice(SOURCE.indexOf('  function collectTextNodes('),SOURCE.indexOf('  function isKnownRecoverySource(')),ctx);
 try{
  const entries=ctx.collectTextNodes(null,false,false,false);
  const node=dom.window.document.querySelector('.comment-card__commentcontent').firstChild;
  assert.equal(entries.has(node),true,'Chosun comment must be an eligible text node');
  assert.equal(entries.get(node).text,'학교에 갔다.');
  assert.equal(ctx.lastScanStats.skippedExcluded,0);
 }finally{dom.window.close();}
});

function createMutationFixture(stopAuto=false){
 const dom=commentsDom(), calls=[],diagnostics=[];
 const ctx={
  document:dom.window.document,location:dom.window.location,
  NodeFilter:dom.window.NodeFilter,MutationObserver:dom.window.MutationObserver,
  OWN_RUBY:'ruby[kra-annotated="true"]',ownDomChanges:new WeakSet(),
  uiSettings:{stopAutoAfterPageComplete:stopAuto,hanjaMode:true,loanwordMode:true},
  pageCompleted:true,sequence:0,currentTask:null,
  automaticObserver:null,automaticTimer:null,
  openTextRoots:()=>[dom.window.document.body],
  isOwnMutation:()=>false,clearTimeout,setTimeout,
  collectTextNodes:()=>new Map(),addDiagnostic:x=>diagnostics.push(x),
  startAnnotation:message=>calls.push(message),console
 };
 vm.createContext(ctx);
 vm.runInContext(SOURCE.slice(helperBegin,helperEnd),ctx);
 return {dom,ctx,calls,diagnostics,dispose(){
  ctx.automaticObserver?.disconnect();clearTimeout(ctx.automaticTimer);
  dom.window.close();
 }};
}

test('mixed container containing an old ruby and a newly loaded comment triggers incremental scan',async()=>{
 const f=createMutationFixture(false);
 try{
  f.ctx.configureAutomaticAnnotation();
  const comments=f.dom.window.document.querySelector('#div_comment');
  comments.insertAdjacentHTML('beforeend',
   '<div class="comment-card"><span class="comment-card__commentcontent">'+
   '<ruby kra-annotated="true" data-kra-original="학교">學校<rt>학교</rt></ruby>'+
   ' 국민들은 물가에 힘들다.</span></div>');
  await new Promise(r=>setTimeout(r,970));
  assert.equal(f.calls.length,1,'new Hangul must not be ignored due to a ruby sibling');
  assert.equal(f.calls[0].automatic,true);
 }finally{f.dispose();}
});

test('a container with only already-annotated ruby never triggers duplicate analysis',async()=>{
 const f=createMutationFixture(false);
 try{
  f.ctx.configureAutomaticAnnotation();
  f.dom.window.document.querySelector('#div_comment').insertAdjacentHTML('beforeend',
   '<div class="comment-card"><ruby kra-annotated="true" data-kra-original="학교">'+
   '學校<rt>학교</rt></ruby></div>');
  await new Promise(r=>setTimeout(r,950));
  assert.equal(f.calls.length,0,'ruby reading must not look like fresh Korean');
 }finally{f.dispose();}
});

test('default stop-after-page-completion ignores newly appearing comments without any 15s exception',async()=>{
 const f=createMutationFixture(true);
 try{
  f.ctx.configureAutomaticAnnotation();
  assert.equal(f.ctx.automaticObserver,null,'default setting must stop after completion');
  f.dom.window.document.querySelector('#div_comment').insertAdjacentHTML(
   'beforeend','<span class="comment-card__commentcontent">새로운 댓글</span>');
  await new Promise(r=>setTimeout(r,110));
  assert.equal(f.calls.length,0,'neither API nor manual page completion may schedule a second task');
  assert.equal(SOURCE.includes('startHydrationGrace('),false);
  assert.equal(SOURCE.includes('hydrationGraceDeadline'),false);
 }finally{f.dispose();}
});

test('turning off stop-after-page-completion preserves original continuous comment scanning',async()=>{
 const f=createMutationFixture(true);
 try{
  f.ctx.configureAutomaticAnnotation();
  assert.equal(f.ctx.automaticObserver,null);
  f.ctx.uiSettings.stopAutoAfterPageComplete=false;
  f.ctx.configureAutomaticAnnotation();
  assert.ok(f.ctx.automaticObserver,'existing opt-in continuous observer must still work');
  f.dom.window.document.querySelector('#div_comment').insertAdjacentHTML(
   'beforeend','<span class="comment-card__commentcontent">새로운 댓글</span>');
  await new Promise(r=>setTimeout(r,970));
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].automatic,true);
 }finally{f.dispose();}
});

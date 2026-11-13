import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
const SOURCE=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
const RUBY='ruby[kra-annotated="true"]';
function fixture(html='<main><div id="comments"><div class="comment"><div class="comment-body">학교에 갔다.</div></div></div></main>'){
 const dom=new JSDOM(html,{url:'https://fixture.test/article/1',pretendToBeVisual:true});
 const ctx={document:dom.window.document,location:dom.window.location,
  MutationObserver:dom.window.MutationObserver,OWN_RUBY:RUBY,MAX_RECOVERY_BLOCKS:12000,
  recoveryByElement:new WeakMap(),analyzedNodeVersions:new WeakMap(),
  BLOCK_TAGS:'p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,pre,figcaption',
  recoveryBlocks:new Set(),ownDomChanges:new WeakSet(),
  recoveryPage:null,recoveryObserver:null,recoveryTimer:null,
  uiSettings:{restoreExistingAnnotations:true,hanjaMode:true,loanwordMode:true},
  currentTask:{},seenSources:new Set(),clearTimeout,setTimeout,console};
 vm.createContext(ctx);
 vm.runInContext(SOURCE.slice(SOURCE.indexOf('  function sourceOf'),
  SOURCE.indexOf('  function captureSelection')),ctx);
 vm.runInContext(SOURCE.slice(SOURCE.indexOf('  function loanwordDisplay'),
  SOURCE.indexOf('  // Cheap, read-only child-frame preflight')),ctx);
 const container=ctx.document.querySelector('.comment-body');
 const node=container.firstChild;
 const anchor=ctx.recoveryAnchor(node);
 assert.ok(anchor);
 const entry={node,text:node.data,selected:[{start:0,end:node.data.length}],
  recoveryAnchor:anchor,hasPreview:true,modelReviewed:true,annotations:[
   {start:0,end:2,surface:'학교',replacement:'學校',type:'hanja'}
  ]};
 const operation=[];
 const paint=()=>ctx.insertConversions(new Map([[node,entry]]),operation);
 return {ctx,dom,container,entry,operation,paint,anchor,
  cleanup(){ctx.resetRecovery();dom.window.close();}};
}

test('progressive preview can be seen before acceptance but is NOT yet saved to recovery',()=>{
 const f=fixture();
 try{
  f.paint();
  assert.equal(f.container.querySelectorAll(RUBY).length,1);
  assert.equal(f.anchor.block.annotations.size,0);
  assert.equal(f.operation.length,1);
  f.container.textContent='학교에 갔다.';
  f.ctx.restoreKnownAnnotations();
  assert.equal(f.container.querySelectorAll(RUBY).length,0,
   'an uncommitted temporary annotation must never be replayed');
 }finally{f.cleanup();}
});

test('same-HTML final commit stores recovery and replays comment after React text repaint',()=>{
 const f=fixture();
 try{
  f.paint();const first=f.container.innerHTML;
  assert.equal(f.anchor.block.annotations.size,0,'preview should not become committed yet');
  f.entry.hasPreview=false;
  f.paint();
  assert.equal(f.container.innerHTML,first,'final commit did not need a second markup mutation');
  assert.equal(f.anchor.block.annotations.size,1,'accepted preview must enter source-bound cache');
  assert.equal(f.operation.length,1,'same HTML must not create duplicate mutation history');
  f.ctx.currentTask=null;
  f.container.textContent='학교에 갔다.';
  f.ctx.restoreKnownAnnotations();
  assert.equal(f.container.querySelectorAll(RUBY).length,1);
  assert.equal(f.container.querySelector(RUBY).textContent,'學校학교');
  f.container.textContent='학교에 갔다.';
  f.ctx.restoreKnownAnnotations();
  assert.equal(f.container.querySelectorAll(RUBY).length,1,'repeat redraw also restores');
 }finally{f.cleanup();}
});

test('real MutationObserver restores committed preview without explicit manual scan',async()=>{
 const f=fixture();
 try{
  f.paint();f.entry.hasPreview=false;f.paint();
  f.ctx.currentTask=null;
  f.container.textContent='학교에 갔다.';
  await new Promise(resolve=>setTimeout(resolve,230));
  assert.equal(f.container.querySelectorAll(RUBY).length,1);
 }finally{f.cleanup();}
});

test('comment wrapper replacement with changing like-count still restores unique exact text',()=>{
 const f=fixture('<main><div id="comments"><div class="comment"><div class="comment-body">학교에 갔다.</div><span class="likes">추천 1</span></div></div></main>');
 try{
  f.paint();f.entry.hasPreview=false;f.paint();f.ctx.currentTask=null;
  const comments=f.dom.window.document.querySelector('#comments');
  comments.innerHTML='<div class="comment"><div class="comment-body">학교에 갔다.</div><span class="likes">추천 2</span></div>';
  f.ctx.restoreKnownAnnotations();
  assert.equal(comments.querySelectorAll(RUBY).length,1);
 }finally{f.cleanup();}
});

test('identical-looking preview does NOT enter recovery if the website replaced its DOM first',()=>{
 const f=fixture();
 try{
  f.paint();
  f.container.textContent='학교에 갔다.';
  f.entry.hasPreview=false;
  f.paint();
  assert.equal(f.entry.invalidated,true,'a stale preview cannot attach a cache to a new node');
  assert.equal(f.anchor.block.annotations.size,0,'do not restore uncommitted stale preview');
 }finally{f.cleanup();}
});

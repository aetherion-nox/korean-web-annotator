import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createParagraphPlan} from '../paragraph-plan.js';

const {JSDOM}=createRequire(import.meta.url)('jsdom');
const SOURCE=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
const BLOCK_TAGS='p,li,dt,dd,td,th,h1,h2,h3,h4,h5,h6,blockquote,pre,figcaption';

function fixture(html){
 const dom=new JSDOM(html,{url:'https://news.example.test/first'});
 const ctx={
  document:dom.window.document,location:dom.window.location,
  NodeFilter:dom.window.NodeFilter,OWN_RUBY:'ruby[kra-annotated="true"]',
  BLOCK_TAGS,analyzedNodeVersions:new WeakMap(),analyzedManualContexts:new WeakMap(),
  seenSources:new Set(),lastScanStats:null,recoveryBlocks:new Set(),recoveryPage:null,
  uiSettings:{restoreExistingAnnotations:true},MAX_RECOVERY_BLOCKS:12000
 };
 vm.createContext(ctx);
 vm.runInContext(SOURCE.slice(SOURCE.indexOf('  function sourceOf('),
  SOURCE.indexOf('  function resetRecovery(')),ctx);
 vm.runInContext(SOURCE.slice(SOURCE.indexOf('  function selectedIntervals('),
  SOURCE.indexOf('  function applySettings(')),ctx);
 vm.runInContext(SOURCE.slice(SOURCE.indexOf('  function openTextRoots('),
  SOURCE.indexOf('  function isKnownRecoverySource(')),ctx);
 const scan=(stamp='settings-A',force=false)=>
  ctx.collectTextNodes(null,force,false,false,stamp);
 const complete=(entries,stamp='settings-A')=>
  ctx.rememberCompletedManualAnalysis(entries,stamp);
 return {dom,ctx,scan,complete};
}

const text=entries=>[...entries.values()].map(row=>row.text);

test('manual full-page checks DOM but skips successfully analyzed unchanged source',()=>{
 const f=fixture('<main><article><p>한국 학교입니다.</p><p>서울 사람입니다.</p></article></main>');
 try{
  const first=f.scan();
  assert.equal(first.size,2);
  f.complete(first);
  const second=f.scan();
  assert.equal(second.size,0);
  assert.equal(f.ctx.lastScanStats.skippedIncremental,2);
  assert.equal(f.ctx.lastScanStats.hangulNodes,2,'the full DOM was still scanned');
  assert.equal(f.scan('settings-A',true).size,2,'explicit full rerun bypasses incremental filtering');
 }finally{f.dom.window.close();}
});

test('newly loaded sibling is analyzed together with preceding context-changed paragraph',()=>{
 const f=fixture('<main><article><p>첫 번째 문장.</p><p>원잠 소식.</p><p>마지막 문장.</p></article></main>');
 try{
  f.complete(f.scan());
  const article=f.dom.window.document.querySelector('article');
  article.insertAdjacentHTML('beforeend','<p>추가된 경제 뉴스.</p>');
  const next=f.scan();
  assert.deepEqual(text(next),['마지막 문장.','추가된 경제 뉴스.']);
  assert.equal(f.ctx.lastScanStats.skippedIncremental,2);
  f.complete(next);
  assert.equal(f.scan().size,0);
 }finally{f.dom.window.close();}
});

test('changed paragraph reopens its own and directly related neighboring context',()=>{
 const f=fixture('<main><article><p>앞 문장.</p><p>중간 문장.</p><p>뒤 문장.</p><p>추가 문장.</p><p>마지막 문장.</p></article></main>');
 try{
  f.complete(f.scan());
  f.dom.window.document.querySelectorAll('p')[1].textContent='변경한 중간 문장.';
  assert.deepEqual(text(f.scan()),['앞 문장.','변경한 중간 문장.','뒤 문장.']);
 }finally{f.dom.window.close();}
});

test('model configuration stamp and direct text edits invalidate prior skips',()=>{
 const f=fixture('<main><p>원잠에 관한 기사.</p><p>경제 뉴스.</p></main>');
 try{
  f.complete(f.scan());
  assert.equal(f.scan().size,0);
  assert.equal(f.scan('settings-B').size,2);
  f.dom.window.document.querySelectorAll('p')[0].firstChild.data='원잠 관련 새 기사.';
  assert.equal(f.scan().size,2);
 }finally{f.dom.window.close();}
});

test('unfinished reviews, changed-during-review text, and reactive remounts are not skipped',()=>{
 const f=fixture('<main><p>처음 문장.</p><p>다음 문장.</p></main>');
 try{
  const first=f.scan();
  assert.equal(f.scan().size,2,'no completion acknowledgment means no skips');
  f.dom.window.document.querySelectorAll('p')[1].firstChild.data='변경된 다음 문장.';
  f.complete(first);
  assert.equal(f.scan().size,2,'changed context must reject stale completion');
  f.complete(f.scan());
  assert.equal(f.scan().size,0);
  const p=f.dom.window.document.querySelectorAll('p')[1];
  p.textContent=p.textContent; // new text node with identical content
  assert.ok(text(f.scan()).includes('변경된 다음 문장.'));
 }finally{f.dom.window.close();}
});

test('identical text at distinct DOM nodes is not an article-wide deduplication key',()=>{
 const f=fixture('<main><article><p>같은 내용.</p><p>같은 내용.</p></article></main>');
 try{
  const first=f.scan();
  f.complete(new Map([[...first][0]]));
  assert.equal(f.scan().size,1);
 }finally{f.dom.window.close();}
});

test('new targets retain old neighboring paragraph context without re-submitting that paragraph',()=>{
 const f=fixture('<main><article><p>원잠은 원자력 잠수함이다.</p><p>신규 문장.</p></article></main>');
 try{
  const newText=f.dom.window.document.querySelectorAll('p')[1].firstChild;
  const entry={node:newText,text:newText.data,selected:[{start:0,end:newText.data.length}]};
  const plan=createParagraphPlan(new Map([[newText,entry]]),f.ctx.sourceOf,BLOCK_TAGS,{includeAdjacentSourceContext:true});
  assert.equal(plan.sentences.length,1);
  assert.deepEqual(plan.sentences[0].adjacentContext,{
   before:'원잠은 원자력 잠수함이다.',after:''
  });
  const ordinary=createParagraphPlan(new Map([[newText,entry]]),f.ctx.sourceOf,BLOCK_TAGS);
  assert.equal(ordinary.sentences[0].adjacentContext,undefined);
 }finally{f.dom.window.close();}
});

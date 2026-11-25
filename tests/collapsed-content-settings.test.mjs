import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
const code=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../popup.html',import.meta.url),'utf8');
function setup(fragment,recognizeCollapsedContent=true){
 const dom=new JSDOM('<main>'+fragment+'</main>');
 const c={document:dom.window.document,window:dom.window,NodeFilter:dom.window.NodeFilter,
  OWN_RUBY:'ruby[kra-annotated="true"]',uiSettings:{recognizeCollapsedContent},
  lastScanStats:null,seenSources:new Set(),analyzedNodeVersions:new WeakMap(),
  recoveryBlocks:new Set(),recoveryPage:null};
 vm.createContext(c);
 vm.runInContext(code.slice(code.indexOf('  function sourceOf'),code.indexOf('  function pageIdentity')),c);
 vm.runInContext(code.slice(code.indexOf('  function selectedIntervals'),code.indexOf('  function applySettings')),c);
 vm.runInContext(code.slice(code.indexOf('  function openTextRoots'),code.indexOf('  function isKnownRecoverySource')),c);
 vm.runInContext(code.slice(code.indexOf('  function probeKoreanFrame'),code.indexOf('  function contextState')),c);
 return {dom,c,all:()=>[...c.collectTextNodes().values()].map(e=>e.text)};
}
test('always-on folded Korean has no popup switch or active persisted flag',()=>{
 assert.doesNotMatch(html,/recognizeCollapsedContent/);
 for(const filename of ['popup.js','service-worker.js','content.js']){
  const source=fs.readFileSync(new URL('../'+filename,import.meta.url),'utf8');
  assert.doesNotMatch(source,/recognizeCollapsedContent/,filename+' must not read legacy flag');
 }
});
test('collapsed MediaWiki section is analyzed without expanding or rewriting its HTML',()=>{
 const {dom,c,all}=setup('<div class="mw-collapsible mw-collapsed">'+
  '<div class="mw-collapsible-content" style="display:none"><p>대한민국 법률은 보장된다.</p>'+
  '<p style="display:none">숨겨진 광고.</p></div></div>'+
  '<div hidden><p>비밀 내부 자료.</p></div><p>일반 문장.</p>');
 const before=dom.window.document.body.innerHTML;
 assert.deepEqual(all(),['대한민국 법률은 보장된다.','일반 문장.']);
 assert.equal(dom.window.document.body.innerHTML,before);
 assert.equal(c.probeKoreanFrame().eligible,true);
 dom.window.close();
});
test('obsolete false setting cannot disable folded article Korean',()=>{
 const {dom,c,all}=setup('<div class="mw-collapsible mw-collapsed">'+
  '<div class="mw-collapsible-content" style="display:none"><p>숨겨진 법률.</p></div></div>'+
  '<p>보이는 본문.</p>',false);
 assert.deepEqual(all(),['숨겨진 법률.','보이는 본문.']);
 assert.equal(c.probeKoreanFrame().eligible,true);
 dom.window.close();
});
test('closed native details are always included even with obsolete false flag',()=>{
 for(const recognize of [true,false]){
  const {dom,all}=setup('<details><summary>항목 보기</summary>'+
   '<p>대통령은 헌법을 준수한다.</p></details>',recognize);
  assert.equal(all().includes('대통령은 헌법을 준수한다.'),true);
  assert.equal(dom.window.document.querySelector('details').open,false);
  dom.window.close();
 }
});
test('frame preflight and full scan agree on hydrated Minerva hidden=until-found clauses',()=>{
 const {dom,c,all}=setup('<div class="mw-parser-output">'+
  '<section id="content-collapsible-block-1" class="mf-section-2 collapsible-block collapsible-block-js"'+
  ' hidden="until-found" style="content-visibility:hidden">'+
  '<p>대한민국 국민의 권리와 의무를 규정한다.</p></section></div>');
 dom.window.document.body.classList.add('skin-minerva');
 assert.deepEqual(all(),['대한민국 국민의 권리와 의무를 규정한다.']);
 assert.equal(c.probeKoreanFrame().eligible,true,'frame preflight must not skip the folded body');
 dom.window.close();
});
test('ordinary hidden elements and script/style remain excluded',()=>{
 const {dom,all}=setup('<div style="display:none">비공개 광고</div>'+
  '<div aria-hidden="true">비공개 템플릿</div>'+
  '<script>const s="비공개 스크립트";</script><p>공개된 본문.</p>');
 assert.deepEqual(all(),['공개된 본문.']);
 dom.window.close();
});
test('preloaded accordion and tab bodies enter the scan while closed',()=>{
 const {dom,c,all}=setup('<section data-state="closed" hidden><p>학교 소개</p></section>'+
  '<button role="tab" aria-selected="false" aria-controls="reading">Open</button>'+
  '<div id="reading" role="tabpanel" hidden="until-found" style="content-visibility:hidden">'+
  '<p>국어 교과서</p></div>'+
  '<aside><div data-state="closed" hidden>광고 문구</div></aside>'+
  '<div role="dialog" data-state="closed" hidden>숨겨진 안내창</div>');
 const before=dom.window.document.body.innerHTML;
 assert.deepEqual(all(),['학교 소개','국어 교과서']);
 assert.equal(c.probeKoreanFrame().eligible,true);
 assert.equal(dom.window.document.body.innerHTML,before);
 dom.window.close();
});
test('inherited visibility of a controlled panel permits only its readable content',()=>{
 const {dom,c,all}=setup('<button aria-expanded="false" aria-controls="article">Open</button>'+
  '<section id="article" style="visibility:hidden"><div><p>학교 소개</p></div>'+
  '<p style="visibility:hidden">비공개 텍스트</p>'+
  '<div hidden>숨겨진 템플릿</div><div inert>비활성 텍스트</div>'+
  '<div style="display:none">숨겨진 광고</div></section>');
 assert.deepEqual(all(),['학교 소개']);
 assert.equal(c.probeKoreanFrame().eligible,true);
 dom.window.document.querySelector('#article').parentElement.hidden=true;
 assert.deepEqual(all(),[]);
 assert.equal(c.probeKoreanFrame().eligible,false);
 dom.window.close();
});
test('ruby is written into a preloaded panel without expanding it',()=>{
 const {dom,c}=setup('<section data-state="closed" hidden><p>학교</p></section>');
 Object.assign(c,{ownDomChanges:new WeakSet(),rememberRecovery(){}});
 vm.runInContext(code.slice(code.indexOf('  function loanwordDisplay('),
  code.indexOf('  // Cheap, read-only child-frame preflight.')),c);
 const entries=c.collectTextNodes();
 const [entry]=entries.values();
 entry.annotations=[{start:0,end:2,surface:'학교',replacement:'學校',type:'hanja'}];
 assert.equal(c.insertConversions(entries,[]),1);
 const panel=dom.window.document.querySelector('section');
 assert.equal(panel.hidden,true);
 assert.equal(panel.dataset.state,'closed');
 assert.equal(panel.querySelector('ruby[kra-annotated="true"]').firstChild.data,'學校');
 assert.equal(panel.querySelector('rt').textContent,'학교');
 dom.window.close();
});
test('a closed navigation menu is scanned and annotated without opening it',()=>{
 const {dom,c,all}=setup('<header><button aria-expanded="false" aria-haspopup="true" aria-controls="menu">Open</button>'+
  '<aside id="menu" style="display:none"><nav><a href="/economy">경제</a>'+
  '<span hidden>숨겨진 템플릿</span></nav></aside>'+
  '<aside style="display:none"><nav>숨겨진 광고</nav></aside></header>');
 assert.deepEqual(all(),['경제']);
 assert.equal(c.probeKoreanFrame().eligible,true);
 Object.assign(c,{ownDomChanges:new WeakSet(),rememberRecovery(){}});
 vm.runInContext(code.slice(code.indexOf('  function loanwordDisplay('),
  code.indexOf('  // Cheap, read-only child-frame preflight.')),c);
 const entries=c.collectTextNodes();
 const [entry]=entries.values();
 entry.annotations=[{start:0,end:2,surface:'경제',replacement:'經濟',type:'hanja'}];
 assert.equal(c.insertConversions(entries,[]),1);
 const doc=dom.window.document;
 assert.equal(doc.querySelector('#menu rt').textContent,'경제');
 assert.equal(doc.querySelector('#menu').style.display,'none');
 assert.equal(doc.querySelector('button').getAttribute('aria-expanded'),'false');
 dom.window.close();
});

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
test('main popup exposes a default-on collapsed content setting outside engine options',()=>{
 assert.match(html,/<input id="recognizeCollapsedContent" type="checkbox" checked/);
 const popup=fs.readFileSync(new URL('../popup.js',import.meta.url),'utf8');
 const sw=fs.readFileSync(new URL('../service-worker.js',import.meta.url),'utf8');
 assert.match(popup,/recognizeCollapsedContent\.checked=uiSettings\.recognizeCollapsedContent !== false/);
 assert.match(popup,/recognizeCollapsedContent:recognizeCollapsedContent\.checked/);
 assert.match(sw,/recognizeCollapsedContent:source\.recognizeCollapsedContent !== false/);
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
test('toggle OFF excludes folded body but still includes visible Korean',()=>{
 const {dom,c,all}=setup('<div class="mw-collapsible mw-collapsed">'+
  '<div class="mw-collapsible-content" style="display:none"><p>숨겨진 법률.</p></div></div>'+
  '<p>보이는 본문.</p>',false);
 assert.deepEqual(all(),['보이는 본문.']);
 assert.equal(c.probeKoreanFrame().eligible,true);
 dom.window.close();
});
test('closed native details follows toggle and never requires opening the panel',()=>{
 for(const recognize of [true,false]){
  const {dom,all}=setup('<details><summary>항목 보기</summary>'+
   '<p>대통령은 헌법을 준수한다.</p></details>',recognize);
  assert.equal(all().includes('대통령은 헌법을 준수한다.'),recognize);
  assert.equal(dom.window.document.querySelector('details').open,false);
  dom.window.close();
 }
});
test('ordinary hidden elements and script/style remain excluded even with toggle ON',()=>{
 const {dom,all}=setup('<div style="display:none">비공개 광고</div>'+
  '<div aria-hidden="true">비공개 템플릿</div>'+
  '<script>const s="비공개 스크립트";</script><p>공개된 본문.</p>');
 assert.deepEqual(all(),['공개된 본문.']);
 dom.window.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
function fixture(html){
 const dom=new JSDOM(html,{url:'https://news.test'});
 const c={window:dom.window,document:dom.window.document,NodeFilter:dom.window.NodeFilter,
  OWN_RUBY:'ruby[kra-annotated="true"]'};
 vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('  function openTextRoots'),
  source.indexOf('  function collectTextNodes')),c);
 vm.runInContext(source.slice(source.indexOf('  function probeKoreanFrame'),
  source.indexOf('  function contextState')),c);
 return {c,dom};
}
test('frame probe accepts normal recommendation heading but skips empty ad tracker',()=>{
 const a=fixture('<div class="recommendations"><h3>오늘의 인기정보</h3><p>인기 기사</p></div>');
 assert.equal(a.c.probeKoreanFrame().eligible,true);a.dom.window.close();
 const b=fixture('<div><script>var q="오늘의 인기정보";</script><div style="display:none">많이 본 정보</div></div>');
 assert.equal(b.c.probeKoreanFrame().eligible,false);b.dom.window.close();
});
test('frame preflight respects hidden, aria-hidden and inert nested content',()=>{
 const f=fixture('<div aria-hidden="true"><h3>오늘의 인기정보</h3></div>'+
  '<div inert><p>많이 본 정보</p></div><p id="live">게임</p>');
 assert.equal(f.c.probeKoreanFrame().eligible,true);
 f.dom.window.document.querySelector('#live').hidden=true;
 assert.equal(f.c.probeKoreanFrame().eligible,false);
 f.dom.window.close();
});
test('frame probe discovers visible Korean inside open shadow root',()=>{
 const f=fixture('<div id="host"></div>');
 f.dom.window.document.querySelector('#host').attachShadow({mode:'open'}).innerHTML=
   '<div>오늘의 인기정보</div>';
 assert.equal(f.c.probeKoreanFrame().eligible,true);
 f.dom.window.close();
});

test('forced frame preflight uses the original Korean in existing extension annotations',()=>{
 const f=fixture('<p><ruby kra-annotated="true" data-kra-original="과학">科學<rt>과학</rt></ruby></p>'+
  '<div hidden>숨은 글</div>');
 try {
  assert.equal(f.c.probeKoreanFrame().eligible,false);
  assert.equal(f.c.probeKoreanFrame(true).reason,'existing-korean-annotation');
  f.dom.window.document.querySelector('p').hidden=true;
  assert.equal(f.c.probeKoreanFrame(true).eligible,false);
 } finally { f.dom.window.close(); }
});

test('forced preflight finds annotated Korean in a shadow root attached after indexing',()=>{
 const f=fixture('<div id="host"></div>');
 try {
  assert.equal(f.c.probeKoreanFrame().eligible,false);
  f.dom.window.document.querySelector('#host').attachShadow({mode:'open'}).innerHTML=
    '<ruby kra-annotated="true" data-kra-original="과학">科學<rt>과학</rt></ruby>';
  assert.equal(f.c.probeKoreanFrame(true).reason,'existing-korean-annotation');
 } finally { f.dom.window.close(); }
});

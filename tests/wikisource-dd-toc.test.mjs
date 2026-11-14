import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
import {createParagraphPlan} from '../paragraph-plan.js';

const content=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
const BLOCK_TAGS='p,li,dt,dd,td,th,h1,h2,h3,h4,h5,h6,blockquote,pre,figcaption';
function scanner(html,recognizeCollapsedContent=true){
 const dom=new JSDOM(html,{url:'https://ko.wikisource.org/wiki/대한민국헌법_(제10호)'});
 const context={document:dom.window.document,NodeFilter:dom.window.NodeFilter,
  OWN_RUBY:'ruby[kra-annotated="true"]',uiSettings:{recognizeCollapsedContent},
  lastScanStats:null,recoveryBlocks:new Set(),recoveryPage:null,
  seenSources:new Set(),analyzedNodeVersions:new WeakMap()};
 vm.createContext(context);
 vm.runInContext(content.slice(content.indexOf('  function sourceOf'),content.indexOf('  function pageIdentity')),context);
 vm.runInContext(content.slice(content.indexOf('  function selectedIntervals'),content.indexOf('  function applySettings')),context);
 vm.runInContext(content.slice(content.indexOf('  function openTextRoots'),content.indexOf('  function isKnownRecoverySource')),context);
 return {dom,context,entries:()=>context.collectTextNodes(),
  plan:entries=>createParagraphPlan(entries,context.sourceOf,BLOCK_TAGS)};
}
function clauseHtml(n=195) {
 const sections=Array.from({length:n},(_,i)=>
  '<ul><li>제'+(i+1)+'조 ① 대한민국은 국민을 보호한다.</li></ul>'+
  '<dl><dd>② 국민의 기본권과 의무는 법률로 정한다. 제'+(i+1)+'항.</dd></dl>').join('');
 return '<article><div class="mw-content-ltr mw-parser-output">'+sections+'</div></article>';
}
test('195 Wikisource definition-list clauses become independent source paragraphs',()=>{
 const x=scanner(clauseHtml());
 const entries=x.entries(),plan=x.plan(entries);
 const ddEntries=[...entries.values()].filter(e=>e.node.parentElement.closest('dd'));
 assert.equal(ddEntries.length,195);
 const clause='② 국민의 기본권과 의무는 법률로 정한다. 제30항.';
 const matches=plan.sentences.filter(s=>s.text.includes(clause));
 assert.equal(matches.length,1,'a definition clause must never be duplicated in an article-wide group');
 assert.equal(matches[0].text,clause);
 assert.ok(Math.max(...plan.sentences.map(s=>s.text.length))<300,
  'no 17k-char surrogate paragraph may be created for a short dd clause');
 assert.ok(plan.sentences.length>=390);
 x.dom.window.close();
});
test('real Vector TOC folded sublists are scanned when enabled without opening them',()=>{
 const html='<nav id="mw-panel-toc"><div id="vector-toc">'+
  '<ul class="vector-toc-contents"><li class="vector-toc-list-item vector-toc-level-1">'+
  '<a class="vector-toc-link" href="#조문">2 조문</a>'+
  '<ul id="toc-조문-sublist" class="vector-toc-list" style="display:none">'+
  '<li class="vector-toc-list-item vector-toc-level-2">'+
  '<a href="#제1장" class="vector-toc-link">제1장 총강</a></li></ul></li></ul>'+
  '</div></nav><article><p>대한민국의 헌법.</p></article>';
 const x=scanner(html,true),original=x.dom.window.document.body.innerHTML;
 let entries=x.entries();
 assert.ok([...entries.values()].some(e=>e.node.parentElement.closest('#toc-조문-sublist')),
  'a folded Vector list must be eligible for analysis');
 assert.equal(x.dom.window.document.body.innerHTML,original,'do not click open or rewrite the page');
 x.context.uiSettings.recognizeCollapsedContent=false;
 entries=x.entries();
 assert.equal([...entries.values()].some(e=>e.node.parentElement.closest('#toc-조문-sublist')),false);
 assert.ok([...entries.values()].some(e=>e.text.includes('대한민국의 헌법')));
 x.dom.window.close();
});
test('Vector expansion class, not only display:none, controls folded recognition',()=>{
 const html='<nav id="vector-toc"><ul class="vector-toc-contents">'+
   '<li id="toc-조문" class="vector-toc-list-item vector-toc-level-1">'+
   '<ul id="toc-조문-sublist" class="vector-toc-list">'+
   '<li class="vector-toc-list-item">제1장 총강</li>'+
   '<li class="vector-toc-list-item">제2장 국민의 권리와 의무</li>'+
   '</ul></li></ul></nav><p>본문의 법률은 유효하다.</p>';
 const x=scanner(html,true);
 const foldedText=()=>[...x.entries().values()].filter(e=>e.node.parentElement.closest('#toc-조문-sublist')).map(e=>e.text);
 assert.equal(foldedText().length,2);
 x.context.uiSettings.recognizeCollapsedContent=false;
 assert.equal(foldedText().length,0,'collapsed by Vector class must be skipped even without CSS display:none');
 x.dom.window.document.querySelector('#toc-조문').classList.add('vector-toc-list-item-expanded');
 assert.equal(foldedText().length,2,'expanded lists must remain eligible with the toggle OFF');
 x.dom.window.close();
});
test('authentic Vector CSS hides folded child li elements, which ON scans without opening',()=>{
 const html='<html class="client-js"><head><style>'+
  '#vector-toc .vector-toc-list-item:not(.vector-toc-list-item-expanded) > .vector-toc-list > .vector-toc-list-item { display:none; }'+
  '</style></head><body><nav id="vector-toc"><ul class="vector-toc-contents">'+
  '<li id="toc-조문" class="vector-toc-list-item vector-toc-level-1">'+
  '<ul class="vector-toc-list" id="toc-조문-sublist">'+
  '<li class="vector-toc-list-item">제1장 총강</li>'+
  '<li class="vector-toc-list-item">제2장 국민의 권리와 의무</li>'+
  '</ul></li></ul></nav><div style="display:none">숨겨진 광고</div></body></html>';
 const x=scanner(html,true);
 const child=x.dom.window.document.querySelector('#toc-조문-sublist > li');
 assert.equal(x.dom.window.getComputedStyle(child).display,'none');
 const matched=()=>[...x.entries().values()].filter(e=>e.node.parentElement.closest('#toc-조문-sublist')).map(e=>e.text);
 assert.equal(matched().length,2,'enabled scan must bypass folded child li display:none');
 assert.equal(x.entries().size,2,'ordinary hidden ad must not enter the scan');
 x.context.uiSettings.recognizeCollapsedContent=false;
 assert.equal(matched().length,0,'toggle OFF must skip both folded child items');
 child.parentElement.parentElement.classList.add('vector-toc-list-item-expanded');
 assert.equal(matched().length,2,'expanded Vector subsection must remain visible with OFF');
 x.dom.window.close();
});
test('ordinary hidden content is never made eligible by a folded TOC setting',()=>{
 const x=scanner('<nav id="vector-toc"><ul class="vector-toc-list" style="display:none">'+
  '<li>숨겨진 목차</li></ul></nav>'+
  '<div style="display:none"><p>숨겨진 광고</p></div>'+
  '<section hidden><p>숨겨진 서식</p></section><p>보이는 내용.</p>');
 const texts=[...x.entries().values()].map(e=>e.text);
 assert.ok(texts.some(v=>v.includes('숨겨진 목차')));
 assert.ok(texts.includes('보이는 내용.'));
 assert.ok(!texts.includes('숨겨진 광고'));
 assert.ok(!texts.includes('숨겨진 서식'));
 x.dom.window.close();
});
test('Minerva mobile folded article section is scanned ON without expanding, OFF skips it',()=>{
 const html='<body class="skin-minerva mf-collapsible-sections">'+
  '<main><div class="mw-parser-output">'+
  '<section id="mf-section-2" class="mf-section-2 collapsible-block" style="display:none">'+
  '<div class="mw-heading section-heading"><h2 id="조문">조문</h2></div>'+
  '<h3>제1장 총강</h3><dl><dd>제1조 ① 대한민국은 민주공화국이다.</dd></dl>'+
  '<p style="display:none">비공개 광고입니다.</p>'+
  '</section></div><p>다른 공개 본문.</p></main>'+
  '<aside style="display:none">숨겨진 광고입니다.</aside></body>';
 const x=scanner(html,true),section=x.dom.window.document.querySelector('#mf-section-2');
 const inSection=()=>[...x.entries().values()].filter(e=>e.node.parentElement.closest('#mf-section-2')).map(e=>e.text);
 assert.equal(x.dom.window.getComputedStyle(section).display,'none');
 assert.ok(inSection().some(text=>text.includes('대한민국은 민주공화국이다')));
 assert.ok(!inSection().some(text=>text.includes('비공개 광고')));
 assert.equal(section.classList.contains('open-block'),false,'scanning must not expand mobile sections');
 x.context.uiSettings.recognizeCollapsedContent=false;
 assert.equal(inSection().length,0,'default visibility must skip folded mobile article when OFF');
 section.style.display='block';
 assert.ok(inSection().some(text=>text.includes('민주공화국')),'visible mobile content stays eligible when OFF');
 x.dom.window.close();
});
test('collapsed switch does not bypass ordinary hidden sections on unrelated skins',()=>{
 const html='<body class="skin-vector"><div class="mw-parser-output">'+
  '<section id="mf-section-2" class="collapsible-block" style="display:none">'+
  '<p>비공개 본문</p></section></div><p>공개된 본문</p></body>';
 const x=scanner(html,true),texts=[...x.entries().values()].map(e=>e.text);
 assert.ok(texts.includes('공개된 본문'));
 assert.ok(!texts.some(t=>t.includes('비공개 본문')));
 x.dom.window.close();
});
test('real downloaded Wikisource HTML has no article-wide dd grouping',()=>{
 const file=process.env.KRA_REAL_WIKISOURCE_HTML;
 if(!file)return;
 const html=fs.readFileSync(file,'utf8');
 const x=scanner(html),entries=x.entries();
 const dd=[...entries.values()].filter(e=>e.node.parentElement.closest('dd'));
 assert.ok(dd.length>=170,'the real page should contain its dd-based legal clauses');
 const plan=x.plan(entries);
 const folded=x.dom.window.document.querySelector('#toc-조문-sublist');
 if(folded) {
  folded.parentElement.classList.remove('vector-toc-list-item-expanded');
  // ResourceLoader's live Vector skin hides individual <li> children, not ul.
  for(const li of folded.querySelectorAll(':scope > li'))li.style.display='none';
  const foldedText=()=>[...x.entries().values()].some(e=>e.node.parentElement.closest('#toc-조문-sublist'));
  assert.equal(foldedText(),true,'real folded Wikisource Vector TOC must be included by default');
  x.context.uiSettings.recognizeCollapsedContent=false;
  assert.equal(foldedText(),false,'real folded Wikisource Vector TOC must be excluded when disabled');
  x.context.uiSettings.recognizeCollapsedContent=true;
 }
 const first=x.dom.window.document.querySelector('.mw-parser-output dd').textContent.trim();
 const matching=plan.sentences.filter(s=>s.text.includes(first));
 assert.equal(matching.length,1);
 assert.ok(matching[0].text.length<500,'the first clause must be scoped to dd, not 19k-character article');
 console.log('REAL_WIKISOURCE_HTML',JSON.stringify({
  htmlBytes:html.length,hangulNodes:entries.size,ddNodes:dd.length,
  plannedParagraphs:plan.sentences.length,
  longestParagraphChars:Math.max(...plan.sentences.map(s=>s.text.length)),
  firstDdParagraphChars:matching[0].text.length
 }));
 x.dom.window.close();
});

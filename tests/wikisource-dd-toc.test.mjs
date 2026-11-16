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
  OWN_RUBY:'ruby[kra-annotated="true"]',BLOCK_TAGS,uiSettings:{recognizeCollapsedContent},
  lastScanStats:null,recoveryBlocks:new Set(),recoveryByElement:new WeakMap(),recoveryPage:null,
  seenSources:new Set(),analyzedNodeVersions:new WeakMap()};
 vm.createContext(context);
 vm.runInContext(content.slice(content.indexOf('  function sourceOf'),content.indexOf('  function pageIdentity')),context);
 vm.runInContext(content.slice(content.indexOf('  function selectedIntervals'),content.indexOf('  function applySettings')),context);
 vm.runInContext(content.slice(content.indexOf('  function openTextRoots'),content.indexOf('  function loanwordDisplay')),context);
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
test('real Vector TOC folded sublists are always recognized without opening them',()=>{
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
 assert.equal([...entries.values()].some(e=>e.node.parentElement.closest('#toc-조문-sublist')),true,'previously saved false must be ignored');
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
 assert.equal(foldedText().length,2,'obsolete false must not hide Vector content');
 x.dom.window.document.querySelector('#toc-조문').classList.add('vector-toc-list-item-expanded');
 assert.equal(foldedText().length,2,'expanded lists remain eligible');
 x.dom.window.close();
});
test('authentic Vector CSS hidden child li elements are recognized without opening',()=>{
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
 assert.equal(matched().length,2,'obsolete false must not hide folded child items');
 child.parentElement.parentElement.classList.add('vector-toc-list-item-expanded');
 assert.equal(matched().length,2,'expanded Vector subsection remains visible');
 x.dom.window.close();
});
test('ordinary hidden content is never made eligible by default folded recognition',()=>{
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
test('Minerva mobile folded article section is always recognized without expanding',()=>{
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
 assert.ok(inSection().some(text=>text.includes('대한민국은 민주공화국이다')),'obsolete false must not hide Minerva article');
 section.style.display='block';
 assert.ok(inSection().some(text=>text.includes('민주공화국')),'visible mobile content stays eligible');
 x.dom.window.close();
});
test('default folded recognition does not bypass unrelated hidden content',()=>{
 const html='<body class="skin-vector"><div class="mw-parser-output">'+
  '<section id="mf-section-2" class="collapsible-block" style="display:none">'+
  '<p>비공개 본문</p></section></div><p>공개된 본문</p></body>';
 const x=scanner(html,true),texts=[...x.entries().values()].map(e=>e.text);
 assert.ok(texts.includes('공개된 본문'));
 assert.ok(!texts.some(t=>t.includes('비공개 본문')));
 x.dom.window.close();
});
test('live Minerva post-hydration renames the section and uses hidden=until-found',()=>{
 const html='<body class="skin-minerva mf-collapsible-sections"><main>'+
 '<div class="mw-parser-output">'+
 '<section id="content-collapsible-block-1" class="mf-section-2 collapsible-block collapsible-block-js"'+
 ' hidden="until-found" style="content-visibility:hidden">'+
 '<h3>제1장 총강</h3><dl><dd>① 대한민국은 민주공화국이다.</dd></dl>'+
 '<p style="display:none">숨겨진 광고용 한글 텍스트.</p>'+
 '<div style="content-visibility:hidden"><p>숨겨진 별도 템플릿.</p></div>'+
 '</section></div></main></body>';
 const x=scanner(html),doc=x.dom.window.document;
 const section=doc.querySelector('#content-collapsible-block-1');
 assert.equal(section.getAttribute('hidden'),'until-found');
 assert.equal(doc.defaultView.getComputedStyle(section).contentVisibility,'hidden');
 const result=()=>[...x.entries().values()].map(e=>e.text);
 assert.ok(result().includes('① 대한민국은 민주공화국이다.'),
   'post-hydration hidden=until-found article must enter scan');
 assert.ok(!result().some(t=>t.includes('광고용 한글')));
 assert.ok(!result().some(t=>t.includes('별도 템플릿')));
 x.context.uiSettings.recognizeCollapsedContent=false;
 assert.ok(result().includes('① 대한민국은 민주공화국이다.'),
   'obsolete false must not suppress folded Korean');
 section.removeAttribute('hidden');
 section.style.contentVisibility='visible';
 assert.ok(result().includes('① 대한민국은 민주공화국이다.'),
   'the same article stays eligible after expansion');
 x.dom.window.close();
});
test('unrelated hidden=until-found templates are not automatically treated as articles',()=>{
 const html='<body class="skin-minerva"><main><div class="mw-parser-output">'+
 '<section hidden="until-found" style="content-visibility:hidden">'+
 '<p>숨겨진 일반 템플릿.</p></section>'+
 '<section class="mf-section-4 collapsible-block" id="other-widget" hidden="until-found"'+
 ' style="content-visibility:hidden"><p>올바르지 않은 숨김 광고.</p></section>'+
 '<p>보이는 기사 본문.</p></div></main></body>';
 const x=scanner(html),texts=[...x.entries().values()].map(e=>e.text);
 assert.deepEqual(texts,['보이는 기사 본문.']);
 x.dom.window.close();
});
test('ARIA-controls folded article body scans without a click; nested hidden templates stay excluded',()=>{
 const html='<main><article><h1>법률 안내</h1>'+
  '<button type="button" aria-expanded="false" aria-controls="law-clauses">조문 접기</button>'+
  '<div id="law-clauses" role="region" hidden aria-hidden="true" style="display:none">'+
  '<section><p>제1조 국민의 자유를 보장한다.</p></section>'+
  '<div style="display:none"><p>숨겨진 광고 및 템플릿</p></div>'+
  '</div></article></main>'+
  '<aside><button aria-expanded="false" aria-controls="ad-panel">광고</button>'+
  '<div id="ad-panel" style="display:none"><p>광고용 한글</p></div></aside>';
 const x=scanner(html,true),doc=x.dom.window.document;
 const original=doc.body.innerHTML;
 const targets=()=>[...x.entries().values()].map(e=>e.text.trim());
 assert.ok(targets().some(t=>t.includes('국민의 자유를 보장')));
 assert.ok(!targets().some(t=>t.includes('숨겨진 광고')));
 assert.ok(!targets().some(t=>t.includes('광고용 한글')));
 assert.equal(doc.body.innerHTML,original,'scan must not open or mutate the folded article');
 x.context.uiSettings.recognizeCollapsedContent=false;
 assert.ok(targets().some(t=>t.includes('국민의 자유를 보장')),'obsolete false must not hide controlled article');
 const panel=doc.getElementById('law-clauses');
 panel.hidden=false;panel.removeAttribute('aria-hidden');panel.style.display='block';
 assert.ok(targets().some(t=>t.includes('국민의 자유를 보장')),'visible article remains scanned');
 x.dom.window.close();
});
test('ARIA-controls on a non-collapsed or non-article region cannot bypass hidden content',()=>{
 const html='<main><button aria-expanded="true" aria-controls="already-open">열기</button>'+
  '<section id="already-open" style="display:none"><p>비공개 변경사항</p></section></main>'+
  '<aside><button aria-expanded="false" aria-controls="private-panel">열기</button>'+
  '<div id="private-panel" style="display:none"><p>비공개 광고</p></div></aside>'+
  '<main><p>공개 한국어 본문</p></main>';
 const x=scanner(html,true),texts=[...x.entries().values()].map(e=>e.text);
 assert.ok(texts.includes('공개 한국어 본문'));
 assert.ok(!texts.includes('비공개 변경사항'));
 assert.ok(!texts.includes('비공개 광고'));
 x.dom.window.close();
});
test('automatic recovery lookup uses indexed paragraph identity, not linear records search',()=>{
 const x=scanner('<main><p>대한민국은 민주공화국이다.</p></main>');
 const entry=[...x.entries().values()][0],element=entry.node.parentElement;
 const block={element,text:x.context.sourceOf(element).text,
  annotations:new Map([['0:4',{surface:'대한민국'}]])};
 x.context.recoveryBlocks.add(block);
 x.context.recoveryByElement.set(element,block);
 x.context.recoveryPage='page-test';
 x.context.pageIdentity=()=> 'page-test';
 x.context.recoveryBlocks[Symbol.iterator]=()=>{throw Error('O(N) recovery scan must not run');};
 assert.equal(x.context.isKnownRecoverySource(entry.node),true);
 block.annotations.clear();
 assert.equal(x.context.isKnownRecoverySource(entry.node),false);
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
  assert.equal(foldedText(),true,'legacy disabled value is ignored');
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

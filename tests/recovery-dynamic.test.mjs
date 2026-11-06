import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {createRequire} from 'node:module';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
function fixture({automatic=false}={}){
 const dom=new JSDOM('<main><article><h1>기사</h1><p id="prev">앞 문단</p><p id="target">학교에 갔다.</p><p id="next">뒤 문단</p></article></main>',{url:'https://fixture.test/article/1'});
 const context={document:dom.window.document,location:dom.window.location,MutationObserver:automatic?dom.window.MutationObserver:class{observe(){}disconnect(){}},OWN_RUBY:'ruby[kra-annotated="true"]',MAX_ENTRIES:3000,BLOCK_TAGS:'p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,pre,figcaption',recoveryBlocks:new Set(),ownDomChanges:new WeakSet(),recoveryPage:null,recoveryObserver:null,recoveryTimer:null,uiSettings:{restoreExistingAnnotations:true},currentTask:null,clearTimeout:automatic?clearTimeout:()=>{},setTimeout:automatic?setTimeout:()=>1,console};
 vm.createContext(context);const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
 vm.runInContext(source.slice(source.indexOf('  function sourceOf'),source.indexOf('  function captureSelection')),context);
 vm.runInContext(source.slice(source.indexOf('  function loanwordDisplay'),source.indexOf('  function insertConversions')),context);
 const p=context.document.querySelector('#target');const anchor=context.recoveryAnchor(p.firstChild);
 const entry={recoveryAnchor:anchor,annotations:[{start:0,end:2,surface:'학교',replacement:'學校',type:'hanja'}],selected:[{start:0,end:p.textContent.length}]};
 context.rememberRecovery(entry,[]);context.restoreKnownAnnotations();assert.equal(p.querySelectorAll('ruby').length,1);
 return {context,dom};
}
test('same paragraph redraw survives changed neighbors',()=>{
 const {context,dom}=fixture();context.document.querySelector('#next').textContent='추가 광고';const p=context.document.querySelector('#target');p.textContent='학교에 갔다.';context.restoreKnownAnnotations();assert.equal(p.querySelectorAll('ruby').length,1);dom.window.close();
});
test('replacement paragraph can match unique exact source after neighbor insertion',()=>{
 const {context,dom}=fixture();const p=context.document.querySelector('#target');p.outerHTML='<p id="ad">광고</p><p id="target">학교에 갔다.</p>';context.restoreKnownAnnotations();assert.equal(context.document.querySelectorAll('#target ruby').length,1);dom.window.close();
});
test('ambiguous replacement text is not guessed',()=>{
 const {context,dom}=fixture();context.document.querySelector('#target').outerHTML='<div>광고</div><p>학교에 갔다.</p><p>학교에 갔다.</p>';context.restoreKnownAnnotations();assert.equal(context.document.querySelectorAll('ruby').length,0);dom.window.close();
});
test('changed source, disabled setting and changed page do not restore',()=>{
 for(const mode of ['source','off','page']){const {context,dom}=fixture();const p=context.document.querySelector('#target');p.textContent=mode==='source'?'다른 문장':'학교에 갔다.';if(mode==='off')context.uiSettings.restoreExistingAnnotations=false;if(mode==='page')dom.reconfigure({url:'https://fixture.test/article/2'});context.location=dom.window.location;context.restoreKnownAnnotations();assert.equal(p.querySelectorAll('ruby').length,0,mode);dom.window.close();}
});

test('real MutationObserver restores repeated redraws without manual invocation',async()=>{
 const {context,dom}=fixture({automatic:true});
 try{
  const p=context.document.querySelector('#target');
  context.document.querySelector('#next').textContent='변경됨';p.textContent='학교에 갔다.';
  await new Promise(r=>setTimeout(r,210));assert.equal(p.querySelectorAll('ruby').length,1);
  p.textContent='학교에 갔다.';
  await new Promise(r=>setTimeout(r,210));assert.equal(p.querySelectorAll('ruby').length,1);
 }finally{context.resetRecovery();dom.window.close();}
});
test('new annotation after neighbor change reuses the existing recovery record',()=>{
 const {context,dom}=fixture();const p=context.document.querySelector('#target');context.document.querySelector('#next').textContent='새 문단';p.textContent='학교에 갔다.';
 context.recoveryAnchor(p.firstChild);assert.equal(context.recoveryBlocks.size,1);dom.window.close();
});

test('committed annotations restore during manual waits but not active analysis',()=>{
 for(const waiting of [false,true]){const {context,dom}=fixture();context.currentTask=waiting?{manualRequest:'batch2'}:{};const p=context.document.querySelector('#target');p.textContent='학교에 갔다.';context.restoreKnownAnnotations();assert.equal(p.querySelectorAll('ruby').length,waiting?1:0);context.resetRecovery();dom.window.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
const panelSource=source.slice(source.indexOf('  function isCompleteManualAnswer('),
 source.indexOf('  function recoverManualConnection('));

function fixture({copyOk=true,clipboardOk=false,overflows=true,hidden=false}={}){
 const dom=new JSDOM('<main>한국어</main>',{url:'https://fixture.test/article',pretendToBeVisual:true});
 const downloads=[],copied=[],scrolls=[],timeout=[];
 dom.window.HTMLAnchorElement.prototype.click=function(){downloads.push({
  href:this.href,name:this.download
 });};
 const context={
  document:dom.window.document,
  navigator:{clipboard:{writeText:async text=>{
   copied.push(text);
   if(!clipboardOk)throw Error('clipboard blocked');
  }}},
  Blob:dom.window.Blob,
  URL:{createObjectURL:()=> 'blob:fixture/prompt',revokeObjectURL:()=>{}},
  setTimeout:(callback,ms)=>{timeout.push(ms);return 1;},
  currentTask:null,refreshManualReopen(){},console,
  send:async msg=>copyOk?{ok:true}:{ok:false}
 };
 vm.createContext(context);vm.runInContext(panelSource,context);
 const panel=context.manualPanel();
 panel.hidden=hidden;
 panel.dataset.requestId='req-a';
 panel.querySelector('.kra-manual-prompt').value='PROMPT A';
 const answer=panel.querySelector('.kra-manual-response');
 const prompt=panel.querySelector('.kra-manual-prompt');
 Object.defineProperty(panel,'scrollHeight',{configurable:true,value:overflows?1200:300});
 Object.defineProperty(panel,'clientHeight',{configurable:true,value:300});
 panel.getBoundingClientRect=()=>({top:20,bottom:320});
 answer.getBoundingClientRect=()=>({top:700,bottom:815});
 panel.scrollTo=options=>{scrolls.push(options);panel.scrollTop=options.top;};
 return {dom,context,panel,answer,prompt,downloads,copied,scrolls,timeout,
  copy:()=>panel.querySelector('.kra-manual-copy').onclick({isTrusted:true}),
  download:()=>panel.querySelector('.kra-manual-download').onclick(),
  close:()=>dom.window.close()};
}
test('successful copy scrolls inside a small manual panel, not the underlying document',async()=>{
 const f=fixture();
 try{
  const before=f.dom.window.document.documentElement.scrollTop;
  await f.copy();
  assert.equal(f.scrolls.length,1);
  assert.equal(f.scrolls[0].top,668);
  assert.equal(f.scrolls[0].behavior,'smooth');
  assert.equal(f.panel.scrollTop,668);
  assert.equal(f.dom.window.document.documentElement.scrollTop,before);
  assert.notEqual(f.dom.window.document.activeElement,f.answer,
   'auto-scroll must not open the mobile keyboard');
  assert.match(f.panel.querySelector('.kra-manual-status').textContent,/已复制/);
 }finally{f.close();}
});
test('download scrolls the same panel after initiating the TXT download',()=>{
 const f=fixture();
 try{
  f.download();
  assert.equal(f.downloads.length,1);
  assert.equal(f.downloads[0].name,'Korean-Web-Annotator-manual-req-a.txt');
  assert.equal(f.timeout[0],30000);
  assert.equal(f.scrolls.length,1);
  assert.equal(f.scrolls[0].top,668);
  assert.equal(f.scrolls[0].behavior,'smooth');
  assert.match(f.panel.querySelector('.kra-manual-status').textContent,/导出/);
 }finally{f.close();}
});
test('a large panel without overflow is not scrolled after either copy or download',async()=>{
 const f=fixture({overflows:false});
 try{
  await f.copy();f.download();
  assert.equal(f.scrolls.length,0);
  assert.equal(f.panel.scrollTop,0);
 }finally{f.close();}
});
test('hidden panel never scrolls and untrusted synthetic copy cannot access the clipboard',async()=>{
 const f=fixture({hidden:true});
 try{
  await f.copy();f.download();
  assert.equal(f.scrolls.length,0);
  f.panel.hidden=false;
  await f.panel.querySelector('.kra-manual-copy').onclick({isTrusted:false});
  assert.equal(f.scrolls.length,0);
  assert.equal(f.copied.length,0);
 }finally{f.close();}
});
test('copy fallback still scrolls after prompting manual selection',async()=>{
 const f=fixture({copyOk:false,clipboardOk:false});
 try{
  await f.copy();
  assert.equal(f.copied.length,1);
  assert.equal(f.scrolls.length,1);
  assert.equal(f.scrolls[0].top,668);
  assert.equal(f.scrolls[0].behavior,'smooth');
  assert.match(f.panel.querySelector('.kra-manual-status').textContent,/复制失败|已复制/);
 }finally{f.close();}
});
test('scroll failure falls back to setting only panel.scrollTop',async()=>{
 const f=fixture();
 try{
  f.panel.scrollTo=()=>{throw Error('smooth scrolling unsupported');};
  await f.copy();
  assert.equal(f.panel.scrollTop,668);
 }finally{f.close();}
});

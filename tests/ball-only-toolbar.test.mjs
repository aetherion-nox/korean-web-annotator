import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {createRequire} from 'node:module';const {JSDOM}=createRequire(import.meta.url)('jsdom');
const tick=ms=>new Promise(r=>setTimeout(r,ms));
async function page(settings={}){
 const dom=new JSDOM('<p id="text">학교에 갔다.</p>',{url:'https://fixture.test'});const w=dom.window;let listener;
 const c={window:w,document:w.document,navigator:w.navigator,location:w.location,NodeFilter:w.NodeFilter,MutationObserver:w.MutationObserver,console,setTimeout:w.setTimeout.bind(w),clearTimeout:w.clearTimeout.bind(w),setInterval:w.setInterval.bind(w),clearInterval:w.clearInterval.bind(w),chrome:{runtime:{sendMessage:async m=>m.type==='GET_UI_SETTINGS'?{ok:true,uiSettings:settings}:{ok:true},onMessage:{addListener:fn=>listener=fn}}}};
 vm.createContext(c);vm.runInContext(fs.readFileSync(new URL('../content.js',import.meta.url),'utf8'),c);await tick(5);
 const apply=async uiSettings=>{listener({type:'APPLY_UI_SETTINGS',uiSettings},{},()=>{});await tick(5);};
 const select=async()=>{const range=w.document.createRange();range.selectNodeContents(w.document.getElementById('text'));w.getSelection().removeAllRanges();w.getSelection().addRange(range);w.document.dispatchEvent(new w.Event('selectionchange'));await tick(140);};
 const bar=()=>w.document.querySelector('.kra-mobile-selection-bar');const ball=()=>w.document.querySelector('.kra-floating-ball');
 return {dom,w,apply,select,bar,ball,close:()=>w.close()};
}
test('ball-only ignores selection and always display, while ball click opens and close stays closed',async()=>{
 for(const toolbarDisplay of ['selection','always']){
  const p=await page({toolbarBallOnly:true,toolbarDisplay});try{
   assert.ok(p.ball()&&!p.ball().hidden);assert.ok(!p.bar()||p.bar().hidden);
   await p.select();assert.ok(!p.bar()||p.bar().hidden);
   p.ball().click();assert.equal(p.bar().hidden,false);assert.equal(p.bar().querySelector('.kra-mobile-primary').disabled,false);
   p.bar().querySelector('.kra-mobile-close').click();await p.select();assert.equal(p.bar().hidden,true);
   p.ball().click();assert.equal(p.bar().hidden,false);
  }finally{p.close();}
 }
});
test('off retains selection behavior and live setting changes enable the ball and hide the bar',async()=>{
 const p=await page({floatingBallEnabled:false});try{
  await p.select();assert.equal(p.bar().hidden,false);
  await p.apply({toolbarBallOnly:true});assert.ok(p.ball()&&!p.ball().hidden);assert.equal(p.bar().hidden,true);
  await p.select();assert.equal(p.bar().hidden,true);
  await p.apply({floatingBallEnabled:false});assert.equal(p.ball().hidden,true);assert.equal(p.bar().hidden,false);
 }finally{p.close();}
});
test('dragging the ball does not open a ball-only toolbar',async()=>{
 const p=await page({toolbarBallOnly:true});try{
  for(const [type,x]of [['pointerdown',10],['pointermove',40],['pointerup',40]]){
   const event=new p.w.MouseEvent(type,{bubbles:true,clientX:x,clientY:20,button:0});Object.defineProperty(event,'pointerId',{value:1});p.ball().dispatchEvent(event);
  }
  p.ball().dispatchEvent(new p.w.MouseEvent('click',{bubbles:true,detail:1}));assert.ok(!p.bar()||p.bar().hidden);
  p.ball().click();assert.equal(p.bar().hidden,false);
 }finally{p.close();}
});
test('popup defaults off, links both dependencies, restores preference and persists run settings',async()=>{
 const dom=new JSDOM(fs.readFileSync(new URL('../popup.html',import.meta.url),'utf8'));let stored={uiSettings:{floatingBallEnabled:false,mobileSelectionToolbar:false,toolbarDisplay:'always'}};
 const c={document:dom.window.document,console,chrome:{storage:{local:{get:async()=>stored,set:async x=>Object.assign(stored,x)}},tabs:{query:async()=>[]},runtime:{sendMessage:async()=>({ok:false})}}};vm.createContext(c);vm.runInContext(fs.readFileSync(new URL('../popup.js',import.meta.url),'utf8'),c);await tick(5);
 try{
  const get=id=>dom.window.document.getElementById(id);const change=async(id,checked)=>{get(id).checked=checked;get(id).dispatchEvent(new dom.window.Event('change'));await tick(5);};
  assert.ok(get('toolbarBallOnly'));assert.equal(get('toolbarBallOnly').checked,false);
  await change('toolbarBallOnly',true);assert.equal(get('floatingBallEnabled').checked,true);assert.equal(get('mobileSelectionToolbar').checked,true);assert.equal(stored.uiSettings.toolbarBallOnly,true);assert.equal(get('toolbarDisplay').disabled,true);
  assert.equal(vm.runInContext('currentUiSettings()',c).toolbarBallOnly,true);await vm.runInContext('saveAndGetRunSettings().catch(()=>{})',c);assert.equal(stored.uiSettings.toolbarBallOnly,true);
  await change('floatingBallEnabled',false);assert.equal(get('toolbarBallOnly').checked,false);assert.equal(stored.uiSettings.toolbarBallOnly,false);assert.equal(get('toolbarDisplay').disabled,false);assert.equal(get('toolbarDisplay').value,'always');
  await change('toolbarBallOnly',true);await change('mobileSelectionToolbar',false);assert.equal(stored.uiSettings.toolbarBallOnly,false);
 }finally{dom.window.close();}
});
test('background defaults off and normalizes inconsistent toolbar dependencies',()=>{
 const src=fs.readFileSync(new URL('../service-worker.js',import.meta.url),'utf8');const c={normalizeUiLocale:()=> 'zh-CN'};vm.createContext(c);vm.runInContext(src.slice(src.indexOf('function sanitizeUiSettings'),src.indexOf('function normalizeUiLocale')),c);
 assert.equal(c.sanitizeUiSettings({}).toolbarBallOnly,false);assert.equal(c.sanitizeUiSettings({toolbarBallOnly:true}).toolbarBallOnly,true);
 assert.equal(c.sanitizeUiSettings({toolbarBallOnly:true,floatingBallEnabled:false}).toolbarBallOnly,false);assert.equal(c.sanitizeUiSettings({toolbarBallOnly:true,mobileSelectionToolbar:false}).toolbarBallOnly,false);
});
test('running tasks cannot bypass ball-only visibility',()=>{
 const dom=new JSDOM('<div id="bar"><button class="kra-mobile-primary"></button></div>');const bar=dom.window.document.getElementById('bar');bar.hidden=true;
 const c={document:dom.window.document,uiSettings:{toolbarBallOnly:true},currentTask:{operationId:'running'},toolbar:bar,toolbarDismissed:false,toolbarForcedOpen:false,selectionSnapshot:null,pageHasHangul:true,refreshFloatingBall(){},captureSelection:()=>[{}],selectionHasHangul:()=>true,getToolbar:()=>bar,floatingBall:null,refreshManualReopen(){}};
 vm.createContext(c);const src=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');vm.runInContext(src.slice(src.indexOf('  function refreshToolbar()'),src.indexOf('  function dismissToolbar()')),c);
 c.refreshToolbar();assert.equal(bar.hidden,true);c.toolbarForcedOpen=true;c.refreshToolbar();assert.equal(bar.hidden,false);c.toolbarForcedOpen=false;c.refreshToolbar();assert.equal(bar.hidden,true);dom.window.close();
});
test('saved ball-only preference reloads and contradictory dependencies safely disable it',async()=>{
 for(const settings of [{toolbarBallOnly:true},{toolbarBallOnly:true,floatingBallEnabled:false},{toolbarBallOnly:true,mobileSelectionToolbar:false}]){
  const dom=new JSDOM(fs.readFileSync(new URL('../popup.html',import.meta.url),'utf8'));
  const c={document:dom.window.document,console,chrome:{storage:{local:{get:async()=>({uiSettings:settings})}},tabs:{query:async()=>[]},runtime:{sendMessage:async()=>({ok:false})}}};vm.createContext(c);vm.runInContext(fs.readFileSync(new URL('../popup.js',import.meta.url),'utf8'),c);await tick(5);
  try{assert.equal(dom.window.document.getElementById('toolbarBallOnly').checked,settings.floatingBallEnabled!==false&&settings.mobileSelectionToolbar!==false);}finally{dom.window.close();}
 }
});
test('round logo shows Hangul above Hanja and follows actual toolbar state in gray and blue',async()=>{
 const p=await page({toolbarBallOnly:true});try{
  const style=p.w.document.createElement('style');style.textContent=fs.readFileSync(new URL('../content.css',import.meta.url),'utf8');p.w.document.head.append(style);
  const glyphs=[...p.ball().children].map(e=>e.textContent);assert.deepEqual(glyphs,['한','漢']);
  const visual=()=>p.w.getComputedStyle(p.ball());assert.equal(visual().borderRadius,'50%');assert.equal(visual().backgroundColor,'rgb(115, 125, 139)');assert.equal(p.ball().getAttribute('aria-expanded'),'false');
  p.ball().click();assert.equal(p.bar().hidden,false);assert.equal(visual().backgroundColor,'rgb(40, 91, 151)');
  p.bar().querySelector('.kra-mobile-close').click();assert.equal(p.ball().getAttribute('aria-expanded'),'false');assert.equal(visual().backgroundColor,'rgb(115, 125, 139)');
  const automatic=await page({toolbarDisplay:'always'});try{
   const style=automatic.w.document.createElement('style');style.textContent=fs.readFileSync(new URL('../content.css',import.meta.url),'utf8');automatic.w.document.head.append(style);assert.equal(automatic.bar().hidden,false);assert.equal(automatic.w.getComputedStyle(automatic.ball()).backgroundColor,'rgb(40, 91, 151)');
  }finally{automatic.close();}
 }finally{p.close();}
});

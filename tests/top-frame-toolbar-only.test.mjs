import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createParagraphPlan} from '../paragraph-plan.js';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
const contentSource=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8')
 .replace('  let createParagraphPlan;','  let createParagraphPlan = globalThis.__testCreateParagraphPlan;');
const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function installFrame(window,options={}){
 const calls=[],ports=[];
 let listener;
 const settings={toolbarDisplay:'always',toolbarHangulOnly:false,
  mobileSelectionToolbar:true,floatingBallEnabled:true,
  ...(options.settings||{})};
 const chrome={runtime:{
  onMessage:{addListener:fn=>listener=fn},
  sendMessage:async message=>{
   calls.push(message);
   return message.type==='GET_UI_SETTINGS'?{ok:true,uiSettings:settings}:{ok:true,started:true};
  },
  getURL:path=>path,
  connect:()=>{
   const port={out:[],onMessage:{addListener:fn=>{port.receive=fn}},
    onDisconnect:{addListener:fn=>{port.disconnectListener=fn}},
    postMessage(message){port.out.push(message)},
    disconnect(){}};
   ports.push(port);return port;
  }
 }};
 const sandbox={window,document:window.document,navigator:window.navigator,
  location:window.location,NodeFilter:window.NodeFilter,
  MutationObserver:window.MutationObserver,
  console,
  __testCreateParagraphPlan:createParagraphPlan,
  chrome,
  setTimeout:window.setTimeout.bind(window),
  clearTimeout:window.clearTimeout.bind(window),
  setInterval:window.setInterval.bind(window),
  clearInterval:window.clearInterval.bind(window)};
 vm.createContext(sandbox);
 vm.runInContext(contentSource,sandbox);
 return {window,calls,ports,send:message=>new Promise(resolve=>{
  const pending=listener(message,{},resolve);
  if(pending!==true)resolve(pending);
 })};
}

async function setup({topText='한국어 본문',childText='한국 정보',settings}={}){
 const dom=new JSDOM('<main><p id="parent"></p></main><iframe id="recommendations"></iframe>',
  {url:'https://example.test/article',pretendToBeVisual:true});
 const top=dom.window;
 top.document.querySelector('#parent').textContent=topText;
 const child=top.document.querySelector('#recommendations').contentWindow;
 child.document.body.innerHTML='<aside><p id="child"></p></aside>';
 child.document.querySelector('#child').textContent=childText;
 assert.notEqual(child.top,child,'the test must use a genuine nested window');
 const main=installFrame(top,{settings});
 const sub=installFrame(child,{settings});
 await tick(25);
 return {dom,main,sub,top,child,close:()=>dom.window.close()};
}

test('only the parent owns toolbar, floating ball, and toolbar visibility observer',async()=>{
 const fixture=await setup();
 try{
  const {top,child,main,sub}=fixture;
  assert.equal(top.document.querySelectorAll('.kra-mobile-selection-bar').length,1);
  assert.equal(top.document.querySelectorAll('.kra-floating-ball').length,1);
  for(const selector of ['.kra-mobile-selection-bar','.kra-floating-ball',
    '.kra-manual-reopen','.kra-diagnostics'])
   assert.equal(child.document.querySelectorAll(selector).length,0,
    'embedded frame must not create '+selector);
  await sub.send({type:'APPLY_UI_SETTINGS',uiSettings:{toolbarDisplay:'always',
   toolbarHangulOnly:false,mobileSelectionToolbar:true}});
  const range=child.document.createRange();
  range.selectNodeContents(child.document.querySelector('#child'));
  child.getSelection().removeAllRanges();child.getSelection().addRange(range);
  child.document.dispatchEvent(new child.Event('selectionchange'));
  await tick(150);
  assert.equal(child.document.querySelectorAll('.kra-mobile-selection-bar,.kra-floating-ball').length,0);
  assert.equal(top.document.querySelectorAll('.kra-mobile-selection-bar').length,1);
  assert.equal((await sub.send({type:'KRA_FRAME_PROBE'})).eligible,true);
  assert.equal((await sub.send({type:'KRA_PING'})).ok,true);
  assert.equal((await main.send({type:'KRA_PING'})).ok,true);
 }finally{fixture.close();}
});

test('an iframe still receives shared model progress, annotates its own DOM, and can restore without UI',async()=>{
 const fixture=await setup();
 try{
  const {child,top,sub}=fixture;
  const response=await sub.send({type:'START_ANNOTATION',mergeGroupId:'merged',
   mergeHost:false,modes:{hanja:true,loanword:true}});
  assert.equal(response.ok,true);
  assert.equal(response.started,true);
  const port=sub.ports[0],start=port.out.find(m=>m.type==='START');
  assert.ok(start,'iframe must still send its text to shared worker');
  assert.equal(start.mergeGroupId,'merged');
  assert.equal(start.sentences.length,1);
  assert.match(start.context,/한국 정보/);
  port.receive({type:'LOCAL_PROGRESS',operationId:start.operationId,stage:'analysis',
   currentSentence:1,totalSentences:1,percent:40});
  port.receive({type:'MODEL_PROGRESS',operationId:start.operationId,
   modelCompleted:0,modelTotal:1});
  port.receive({type:'RESULTS',operationId:start.operationId,source:'model',
   results:[{id:start.sentences[0].id,annotations:[
    {start:0,end:2,surface:'한국',replacement:'韓國',type:'hanja'}]}]});
  port.receive({type:'DONE',operationId:start.operationId,stats:{},results:[]});
  assert.equal(child.document.querySelectorAll('ruby[kra-annotated="true"]').length,1);
  assert.equal(child.document.querySelector('ruby[kra-annotated="true"] rt').textContent,'한국');
  assert.equal(child.document.querySelectorAll('.kra-mobile-selection-bar,.kra-floating-ball').length,0);
  assert.equal(top.document.querySelectorAll('.kra-mobile-selection-bar').length,1);
  const restore=await sub.send({type:'RESTORE_ANNOTATION'});
  assert.equal(restore.ok,true);
  assert.equal(child.document.querySelectorAll('ruby[kra-annotated="true"]').length,0);
  assert.equal(child.document.querySelectorAll('.kra-mobile-selection-bar,.kra-floating-ball').length,0);
 }finally{fixture.close();}
});

test('the single parent toolbar routes full-page runs into the shared multi-frame coordinator',async()=>{
 const fixture=await setup();
 try{
  const {main,top,child}=fixture;
  top.document.querySelector('.kra-mobile-page').click();
  await tick(0);
  const call=main.calls.find(x=>x.type==='KRA_START_PAGE_FROM_TOOLBAR');
  assert.ok(call,'whole-page click must use the worker rather than main-only startAnnotation');
  assert.equal(call.modes.hanja,true);
  assert.equal(call.modes.loanword,true);
  assert.equal(child.document.querySelectorAll('.kra-mobile-selection-bar').length,0);
 }finally{fixture.close();}
});

test('the main frame retains its controls when only the iframe contains Korean',async()=>{
 const fixture=await setup({topText:'No Korean here',childText:'많이 본 정보',
  settings:{toolbarDisplay:'selection',toolbarHangulOnly:true}});
 try{
  const {top,main}=fixture;
  const r=await main.send({type:'START_ANNOTATION',mergeGroupId:'merged',
   mergeHost:true,modes:{hanja:true,loanword:true}});
  assert.equal(r.started,true);
  assert.equal(top.document.querySelectorAll('.kra-mobile-selection-bar').length,1);
  assert.equal(top.document.querySelector('.kra-mobile-selection-bar').hidden,false);
  assert.equal(main.ports[0].out.find(m=>m.type==='START').sentences.length,0);
 }finally{fixture.close();}
});

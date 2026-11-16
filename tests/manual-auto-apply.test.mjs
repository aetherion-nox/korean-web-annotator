import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const {JSDOM}=createRequire(import.meta.url)('jsdom');

const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
const panelSource=source.slice(source.indexOf('  function isCompleteManualAnswer('),
  source.indexOf('  function recoverManualConnection('));
const eventsSource=source.slice(source.indexOf('  function handleManualEvent('),
  source.indexOf('  function status(',source.indexOf('  function handleManualEvent(')));
const endSource=source.slice(source.indexOf('  function finishTask('),
  source.indexOf('  function cancelTask('));

function fixture({offline=false,merged=false}={}){
 const dom=new JSDOM('<main><p>한국어 문장</p></main>',{
  url:'https://fixture.test/manual',pretendToBeVisual:true
 });
 const sent=[],calls=[],status=[];
 const task={operationId:'op',manualLocalOnly:offline,mergedGroup:merged,
  port:{postMessage:m=>sent.push(m),disconnect(){}},manualPlan:[],finished:false,
  reconcile(){},keepalive:123};
 const context={
  document:dom.window.document, currentTask:task,uiSettings:{hideToolbarOnFirstManual:false},
  clearTimeout(){},clearInterval(){},setTimeout:()=>123,console,navigator:dom.window.navigator,
  watchManualReply:()=>calls.push('watchdog'),dismissToolbar(){},
  configureRecovery(){},refreshManualReopen(){},status:s=>status.push(s),
  publishState(){}, getToolbar:()=>null,addDiagnostic(){},
  applyManualRecovery:async()=>{},recoverMergedManual:async()=>{},
  seenSources:new Set()
 };
 vm.createContext(context);vm.runInContext(panelSource,context);
 vm.runInContext(eventsSource,context);
 vm.runInContext(endSource,context);
 const request=n=>({type:'MANUAL_REVIEW_REQUEST',requestId:'r'+n,
  batchNumber:n,batchTotal:2,targetCount:1,text:'prompt '+n,
  bindings:[{target_id:'t0',sentenceId:'p0',start:0,end:2,surface:'한국',
   choices:[{choice_id:'KEEP',annotations:[]},{choice_id:'c0',annotations:[]}]}]});
 context.handleManualEvent(task,request(1));
 task.manualLocalOnly=offline;
 const panel=dom.window.document.querySelector('.kra-manual-review');
 const input=panel.querySelector('.kra-manual-response');
 const apply=panel.querySelector('.kra-manual-apply');
 const importButton=panel.querySelector('.kra-manual-import');
 const type=text=>{input.value=text;input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
 return {context,dom,task,sent,calls,status,panel,input,apply,importButton,request,type,
  close:()=>dom.window.close()};
}
const answer=(requestId='r1')=>JSON.stringify({batch_id:requestId,results:[{t:'t0',c:'c0'}]});

test('pasted complete JSON automatically submits immediately without button click',()=>{
 const f=fixture();
 try{
  f.type(answer());
  assert.equal(f.sent.length,1);
  assert.deepEqual(JSON.parse(f.sent[0].text),JSON.parse(answer()));
  assert.equal(f.sent[0].type,'MANUAL_REVIEW_RESPONSE');
  assert.equal(f.sent[0].requestId,'r1');
  assert.equal(f.calls.length,1,'existing background watchdog still runs');
  assert.equal(f.apply.disabled,true);
  assert.equal(f.importButton.disabled,true);
  // A browser emits extra input events for some paste/IME interactions.
  f.type(answer());
  assert.equal(f.sent.length,1,'same batch cannot be submitted twice in flight');
 }finally{f.close();}
});

test('partial typing and incomplete Markdown fence do not spam model submissions',()=>{
 const f=fixture();
 try{
  for(const text of ['{','{"batch_id":"r1","results":','```json\n'+answer()]){
   f.type(text);
   assert.equal(f.sent.length,0);
   assert.equal(f.apply.disabled,false);
   assert.match(f.panel.querySelector('.kra-manual-status').textContent,/JSON/);
  }
  f.type('```json\n'+answer()+'\n```');
  assert.equal(f.sent.length,1);
  assert.equal(f.sent[0].text,'```json\n'+answer()+'\n```');
 }finally{f.close();}
});

test('backend validation error re-enables controls; edited answer automatically resubmits',()=>{
 const f=fixture();
 try{
  f.type(JSON.stringify({batch_id:'incorrect',results:[{t:'t0',c:'c0'}]}));
  assert.equal(f.sent.length,1);
  f.context.handleManualEvent(f.task,{
   type:'MANUAL_REVIEW_ERROR',requestId:'r1',recoverable:false,error:'batch_id 不匹配'
  });
  assert.equal(f.panel.hidden,false);
  assert.equal(f.apply.disabled,false);
  assert.equal(f.importButton.disabled,false);
  assert.match(f.panel.querySelector('.kra-manual-status').textContent,/batch_id/);
  assert.equal(f.input.value.includes('incorrect'),true,'preserve user draft on error');
  f.type(answer());
  assert.equal(f.sent.length,2);
  assert.equal(f.sent[1].requestId,'r1');
 }finally{f.close();}
});

test('manual apply button remains a way to retry malformed JSON and never silently drops it',()=>{
 const f=fixture();
 try{
  f.type('not even json');
  assert.equal(f.sent.length,0);
  f.apply.click();
  assert.equal(f.sent.length,1);
  assert.equal(f.sent[0].text,'not even json');
 }finally{f.close();}
});

test('next manual batch opens input with clean state and auto-submits only that batch',()=>{
 const f=fixture();
 try{
  f.type(answer('r1'));
  f.context.handleManualEvent(f.task,f.request(2));
  assert.equal(f.input.value,'');
  assert.equal(f.apply.disabled,false);
  assert.equal(f.task.manualRequest,'r2');
  f.type(answer('r2'));
  assert.equal(f.sent.length,2);
  assert.equal(f.sent[1].requestId,'r2');
  assert.equal(f.panel.hidden,false,'before application completes keep panel open');
 }finally{f.close();}
});

test('offline recovery auto-applies on paste then final completion folds editor without discarding JSON',async()=>{
 const f=fixture({offline:true});
 try{
  f.task.manualPlan=[{requestId:'r1'}];
  f.context.applyManualRecovery=async task=>{
   assert.equal(task.manualRequest,'r1');
   f.context.finishTask(task,'全部批次已成功应用',true);
  };
  f.type(answer());
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.task.finished,true);
  assert.equal(f.panel.hidden,true);
  assert.equal(f.input.value,answer());
  assert.equal(f.panel.querySelector('.kra-manual-prompt').value,'prompt 1');
 }finally{f.close();}
});

test('offline partial/error response preserves editor and enables correction',async()=>{
 const f=fixture({offline:true});
 try{
  f.context.applyManualRecovery=async()=>{throw Error('剩余 1 个目标需要补交');};
  f.type(answer());
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.task.finished,false);
  assert.equal(f.panel.hidden,false);
  assert.equal(f.apply.disabled,false);
  assert.equal(f.importButton.disabled,false);
  assert.match(f.panel.querySelector('.kra-manual-status').textContent,/剩余 1 个目标/);
  assert.equal(f.input.value,answer());
 }finally{f.close();}
});

test('merged offline recovery uses its own validated replay path on input',async()=>{
 const f=fixture({offline:true,merged:true});
 try{
  f.context.recoverMergedManual=async(task,text)=>{
   assert.equal(task.manualLocalOnly,true);
   assert.equal(text,answer());
   f.context.finishTask(task,'全部批次完成',true);
  };
  f.type(answer());
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.task.finished,true);
  assert.equal(f.panel.hidden,true);
 }finally{f.close();}
});

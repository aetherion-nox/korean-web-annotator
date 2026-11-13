import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');

test('all successfully applied manual batches collapse the input editor without losing its content',()=>{
 const elements=new Map();
 const panel={hidden:false,dataset:{operationId:'op'},querySelector:key=>{
  if(!elements.has(key))elements.set(key,{disabled:false,textContent:'',value:''});
  return elements.get(key);
 }};
 panel.querySelector('.kra-manual-prompt').value='original prompt';
 panel.querySelector('.kra-manual-response').value='{"batch_id":"abc","results":[]}';
 let refreshed=0,disconnected=0;
 const task={operationId:'op',finished:false,manualBackup:{bindings:[]},manualRequest:'abc',
  reconcile(){},port:{disconnect(){disconnected++}}};
 const c={currentTask:task,document:{querySelector:key=>key==='.kra-manual-review'?panel:null},
  clearTimeout(){},clearInterval(){},configureRecovery(){},refreshManualReopen(){refreshed++}};
 vm.createContext(c);
 vm.runInContext(code.slice(code.indexOf('  function finishTask('),code.indexOf('  function cancelTask(')),c);
 c.finishTask(task,'全部手动批次已完成。',true);
 assert.equal(task.finished,true);
 assert.equal(panel.hidden,true,'completed review should be automatically collapsible');
 assert.equal(panel.querySelector('.kra-manual-response').value,'{"batch_id":"abc","results":[]}');
 assert.equal(panel.querySelector('.kra-manual-prompt').value,'original prompt');
 assert.equal(refreshed,1);
 assert.equal(disconnected,1);
});

test('an incomplete task is not mistaken for successfully applied answers',()=>{
 const element=new Map(),panel={hidden:false,dataset:{operationId:'op'},querySelector:key=>{
  if(!element.has(key))element.set(key,{disabled:false,value:'answer',textContent:''});
  return element.get(key);
 }};
 const task={operationId:'op',finished:false,port:{disconnect(){}},reconcile(){}};
 const c={currentTask:task,document:{querySelector:()=>panel},clearTimeout(){},clearInterval(){},configureRecovery(){},refreshManualReopen(){}};
 vm.createContext(c);
 vm.runInContext(code.slice(code.indexOf('  function finishTask('),code.indexOf('  function cancelTask(')),c);
 c.finishTask(task,'连接已失效：必须重新连接',false);
 assert.equal(panel.hidden,false);
 assert.equal(panel.querySelector('.kra-manual-response').value,'answer');
 assert.equal(panel.querySelector('.kra-manual-status').textContent,'连接已失效：必须重新连接');
});

test('worker DONE waits for in-flight accepted answer checkpoint before any completion',async()=>{
 const hooks={},messages=[],port={
  onDisconnect:{addListener:fn=>hooks.disconnect=fn},
  onMessage:{addListener:fn=>hooks.message=fn},
  postMessage:m=>messages.push(m),disconnect(){}
 };
 let resume, rescued=0, finished=0;
 const c={currentTask:null,sequence:0,uiSettings:{},history:[],diagnostics:[],
  document:{querySelector:()=>null,location:{href:'https://example.test/article'}},
  location:{href:'https://example.test/article'},chrome:{runtime:{connect:()=>port,getURL:x=>x}},
  collectTextNodes:()=>new Map(),lastScanStats:{textNodes:0,hangulNodes:0},
  cancelTask(){},addDiagnostic(){},status(){},sourceOf(){},BLOCK_TAGS:'p',
  setInterval:()=>1,clearInterval(){},clearTimeout(){},getToolbar:()=>({}),
  seenSources:new Set(),publishState(){},configureRecovery(){},
  recoverManualConnection(){rescued++;return true;},
  finishTask(){finished++}
 };
 vm.createContext(c);
 const snippet=code.slice(code.indexOf('  let createParagraphPlan;'),
  code.indexOf('  chrome.runtime.onMessage.addListener',code.indexOf('  let createParagraphPlan;')));
 vm.runInContext(snippet,c);
 vm.runInContext('createParagraphPlan=()=>({sentences:[],context:""})',c);
 const started=await c.startAnnotation({modes:{hanja:true,loanword:true},mergeGroupId:'group',mergeHost:true});
 assert.equal(started.ok,true);
 const task=vm.runInContext('currentTask',c);
 task.manualRequest='abc';
 task.manualBackup={requestId:'abc',bindings:[{target_id:'t0'}]};
 task.pendingAcceptedRecovery=new Promise(resolve=>{resume=resolve});
 const done=hooks.message({type:'DONE',operationId:task.operationId,results:[],stats:{}});
 assert.equal(rescued,0);
 assert.equal(finished,0);
 resume();
 await done;
 assert.equal(rescued,1,'the unfinished manual batch must be recovered rather than discarded');
 assert.equal(finished,0,'DONE must never lock the manual editor before accepted answers apply');
});

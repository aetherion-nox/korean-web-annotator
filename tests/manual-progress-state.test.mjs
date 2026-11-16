import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const {JSDOM}=createRequire(import.meta.url)('jsdom');

const src=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
const activitySource=src.slice(src.indexOf('  function reportTaskActivity('),
  src.indexOf('  function finishTask(',src.indexOf('  function reportTaskActivity(')));
const startSource=src.slice(src.indexOf('  let createParagraphPlan;'),
  src.indexOf('  chrome.runtime.onMessage.addListener',src.indexOf('  let createParagraphPlan;')));

function fixture(){
 const dom=new JSDOM('<div class="kra-mobile-selection-bar">'+
  '<span class="kra-task-label"></span>'+
  '<progress class="kra-task-progress" value="0" max="100"></progress>'+
  '<span class="kra-task-detail" hidden></span></div>',
  {url:'https://fixture.test/article'});
 const bar=dom.window.document.querySelector('.kra-mobile-selection-bar');
 const logs={cleared:[],timers:[],status:[]};
 const now=Date.now();
 const task={operationId:'op',finished:false,manualRequest:'req-one',
  manualBackup:{batchNumber:1,batchTotal:3,targetCount:500},
  operation:{startedAt:now-18000},activityTimer:17,
  activity:{phase:'prepare',phaseStartedAt:now-18000,lastConfirmedAt:null,
   detail:'正在建立引擎连接'}};
 const ctx={document:dom.window.document,window:dom.window,currentTask:task,
  getToolbar:()=>bar,refreshToolbar(){},
  clearInterval(id){logs.cleared.push(id);},setInterval(fn,ms){
   logs.timers.push({fn,ms});return 20+logs.timers.length;
  }};
 vm.createContext(ctx);vm.runInContext(activitySource,ctx);
 return {dom,bar,task,ctx,logs,progress:bar.querySelector('progress'),
  detail:bar.querySelector('.kra-task-detail'),close:()=>dom.window.close()};
}

test('manual prompt replaces stale engine startup state and pauses its clock',()=>{
 const f=fixture();
 try{
  f.ctx.renderTaskActivity(f.task);
  assert.match(f.detail.textContent,/正在建立引擎连接/);
  f.ctx.status('等待手动回填：第 1/3 批次（500 个词）');
  assert.equal(f.task.activity.phase,'manual');
  assert.equal(f.task.activityTimer,null,'manual user-wait must stop its timer');
  assert.deepEqual(f.logs.cleared,[17]);
  assert.match(f.detail.textContent,/等待用户.*JSON/);
  assert.match(f.detail.textContent,/已暂停引擎卡顿计时/);
  assert.doesNotMatch(f.detail.textContent,/正在建立引擎连接|本阶段 18秒|距本阶段上次真实反馈/);
  assert.equal(f.progress.value,0);
  assert.ok(f.progress.hasAttribute('value'),'manual stage must have determinate, not animated, progress');
  assert.equal(f.bar.querySelector('.kra-task-label').textContent,'等待手动回填：第 1/3 批次（500 个词）');
  // Updating an unrelated status without a numerical progress value must
  // retain a determinate bar, not restart a misleading marquee animation.
  f.ctx.status('打开手动审核');
  assert.ok(f.progress.hasAttribute('value'));
  f.ctx.renderTaskActivity(f.task);
  assert.match(f.detail.textContent,/已暂停引擎卡顿计时/);
  assert.equal(f.logs.timers.length,0,'no user-wait wall-clock ticker remains');
 }finally{f.close();}
});

test('later manual batches use completed batch fraction without claiming completion',()=>{
 const f=fixture();
 try{
  f.task.manualBackup={batchNumber:2,batchTotal:3};
  f.ctx.status('等待手动回填：第 2/3 批次');
  assert.equal(f.progress.value,33);
  assert.equal(f.task.activity.phase,'manual');
  f.task.manualBackup={batchNumber:3,batchTotal:3};
  f.ctx.status('等待手动回填：第 3/3 批次');
  assert.equal(f.progress.value,67);
  assert.ok(f.progress.hasAttribute('value'));
 }finally{f.close();}
});

test('submitting manual JSON resumes a new validation stage, not the old engine connection clock',()=>{
 const f=fixture();
 try{
  f.ctx.status('等待手动回填：第 1/3 批次');
  f.ctx.reportTaskActivity(f.task,'validation','已提交手动审核答案，等待后台校验');
  assert.equal(f.task.activity.phase,'validation');
  assert.equal(f.logs.timers.length,1);
  assert.equal(f.logs.timers[0].ms,1000);
  assert.equal(f.task.activity.lastConfirmedAt,null);
  f.ctx.renderTaskActivity(f.task);
  assert.match(f.detail.textContent,/本阶段 0秒/);
  assert.doesNotMatch(f.detail.textContent,/本阶段 18秒|正在建立引擎连接/);
  // A ticking UI is not an engine response. No real event means the
  // confirmed-feedback field remains null.
  f.logs.timers[0].fn();
  assert.equal(f.task.activity.lastConfirmedAt,null);
  f.ctx.reportTaskActivity(f.task,'model','已收到并校验模型答案',true);
  assert.equal(f.task.activity.phase,'model');
  assert.ok(f.task.activity.lastConfirmedAt>0);
  assert.match(f.detail.textContent,/最近收到真实反馈/);
 }finally{f.close();}
});

test('streaming-port events invoke the real progress reporter rather than a silent undefined alias',async()=>{
 const handlers={},milestones=[],manual=[];
 const port={onDisconnect:{addListener:fn=>handlers.disconnected=fn},
  onMessage:{addListener:fn=>handlers.message=fn},
  postMessage(){},disconnect(){}};
 const ctx={currentTask:null,sequence:0,uiSettings:{},history:[],diagnostics:[],
  document:{querySelector:()=>null,location:{href:'https://fixture.test/article'}},
  location:{href:'https://fixture.test/article'},chrome:{runtime:{connect:()=>port,getURL:x=>x}},
  collectTextNodes:()=>new Map(),lastScanStats:{textNodes:0,hangulNodes:0},
  cancelTask(){},stopHydrationGrace(){},startHydrationGrace(){},addDiagnostic(){},
  status(){},sourceOf(){},BLOCK_TAGS:'p',setInterval:()=>1,clearInterval(){},
  clearTimeout(){},getToolbar:()=>({}),seenSources:new Set(),publishState(){},
  configureRecovery(){},recoverManualConnection(){return false;},finishTask(){},
  reportTaskActivity(task,phase,detail,verified){milestones.push({phase,detail,verified});},
  handleManualEvent(task,event){manual.push(event);}
 };
 vm.createContext(ctx);vm.runInContext(startSource,ctx);
 vm.runInContext('createParagraphPlan=()=>({sentences:[],context:""})',ctx);
 const started=await ctx.startAnnotation({modes:{hanja:true,loanword:true},
  mergeGroupId:'group',mergeHost:true});
 assert.equal(started.ok,true);
 const task=vm.runInContext('currentTask',ctx);
 const send=message=>handlers.message({operationId:task.operationId,...message});
 await send({type:'LOCAL_PROGRESS',stage:'analysis-phase',phase:'kiwi',event:'done',
  currentSentence:1,sentenceCharacters:1200,completedSentences:0,totalSentences:1,percent:0});
 assert.equal(milestones.at(-1).phase,'local','real worker phase must update live UI');
 assert.equal(milestones.at(-1).verified,true);
 await send({type:'MANUAL_REVIEW_REQUEST',requestId:'req1',
  batchNumber:1,batchTotal:2,targetCount:500,text:'prompt'});
 assert.equal(manual.length,1);
 assert.equal(milestones.at(-1).phase,'manual');
 assert.equal(milestones.at(-1).verified,true);
 await send({type:'MANUAL_REVIEW_ERROR',requestId:'req1',error:'needs correction'});
 assert.equal(milestones.at(-1).phase,'manual','rejected JSON needs human input, not model running');
 const count=milestones.length;
 await send({type:'PONG'});
 assert.equal(milestones.length,count,'keepalive PONG must not be counted as completed engine work');
});

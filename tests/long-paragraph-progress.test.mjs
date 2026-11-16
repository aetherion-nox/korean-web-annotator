import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
const activitySource=source.slice(source.indexOf('  function reportTaskActivity('),
 source.indexOf('  function finishTask(',source.indexOf('  function reportTaskActivity(')));
const startSource=source.slice(source.indexOf('  let createParagraphPlan;'),
 source.indexOf('  chrome.runtime.onMessage.addListener',source.indexOf('  let createParagraphPlan;')));

function fixture(){
 const dom=new JSDOM('<main>한국어</main><div class="kra-mobile-selection-bar">'+
  '<span class="kra-task-label"></span><progress class="kra-task-progress" max="100" value="0"></progress>'+
  '<span class="kra-task-detail" hidden></span></div>',
  {url:'https://fixture.test/long'});
 const toolbar=dom.window.document.querySelector('.kra-mobile-selection-bar');
 const events=[],portHandlers={},port={
  onDisconnect:{addListener:fn=>portHandlers.disconnect=fn},
  onMessage:{addListener:fn=>portHandlers.message=fn},
  postMessage(){},disconnect(){}
 };
 const ctx={currentTask:null,sequence:0,uiSettings:{},history:[],diagnostics:[],
  document:dom.window.document,window:dom.window,
  location:{href:'https://fixture.test/long'},
  chrome:{runtime:{connect:()=>port,getURL:x=>x}},
  collectTextNodes:()=>new Map(),lastScanStats:{textNodes:0,hangulNodes:0},
  cancelTask(){},stopHydrationGrace(){},startHydrationGrace(){},addDiagnostic(){},
  sourceOf(){},BLOCK_TAGS:'p',setInterval:()=>123,clearInterval(){},
  clearTimeout(){},getToolbar:()=>toolbar,refreshToolbar(){},
  seenSources:new Set(),publishState(){},configureRecovery(){},
  recoverManualConnection(){return false;},finishTask(){},
  console
 };
 vm.createContext(ctx);
 vm.runInContext(activitySource,ctx);
 vm.runInContext(startSource,ctx);
 vm.runInContext('createParagraphPlan=()=>({sentences:[],context:""})',ctx);
 const deliver=async(result,task)=>portHandlers.message({operationId:task.operationId,...result});
 return {ctx,dom,toolbar,events,deliver,
  detail:toolbar.querySelector('.kra-task-detail'),
  progress:toolbar.querySelector('progress'),
  close:()=>dom.window.close()};
}

test('actual worker long-text milestones show text length, real completed counters and stage durations',async()=>{
 const f=fixture();
 try{
  const started=await f.ctx.startAnnotation({modes:{hanja:true,loanword:true},
   mergeGroupId:'group',mergeHost:true});
  assert.equal(started.ok,true);
  const task=vm.runInContext('currentTask',f.ctx);
  const common={type:'LOCAL_PROGRESS',currentSentence:1,completedSentences:0,
   totalSentences:2,percent:0,sentenceCharacters:7924};
  await f.deliver({...common,stage:'analysis-paragraph',event:'start',batchIndex:1,batchTotal:2},task);
  assert.equal(task.activity.longParagraph.characters,7924);
  assert.match(f.detail.textContent,/正在分析长段落/);
  await f.deliver({...common,stage:'analysis-phase',phase:'kiwi',event:'start'},task);
  await f.deliver({...common,stage:'analysis-phase',phase:'kiwi',event:'done',elapsedMs:120.5},task);
  await f.deliver({...common,stage:'analysis-phase',phase:'converter',event:'start'},task);
  await f.deliver({...common,stage:'analysis-phase',phase:'converter',event:'checkpoint',
   substep:'scoring',processed:256,total:1800,substepElapsedMs:450.5},task);
  assert.match(f.detail.textContent,/已处理 256\/1800 词组/);
  assert.match(f.detail.textContent,/Kiwi 分词 0\.12秒/);
  assert.match(f.detail.textContent,/本段 \d+秒/);
  assert.match(f.detail.textContent,/当前步骤 \d+秒/);
  assert.ok(f.progress.hasAttribute('value'));
  assert.equal(f.progress.value,0,'substep checkpoint is NOT whole-page completion');
  await f.deliver({...common,stage:'analysis-phase',phase:'converter',event:'done',elapsedMs:1145.9},task);
  assert.match(f.detail.textContent,/Converter 词源匹配 1\.15秒/);
  await f.deliver({...common,stage:'analysis-paragraph',event:'done'},task);
  assert.equal(task.activity.lastConfirmedAt!=null,true);
  await f.deliver({...common,stage:'analysis-paragraph',event:'start',
   currentSentence:2,sentenceCharacters:90},task);
  assert.equal(task.activity.longParagraph,null,'short next segment clears old long-text state');
 }finally{f.close();}
});

test('long paragraph with no fresh checkpoint is not called confirmed work or certain deadlock',async()=>{
 const f=fixture();
 try{
  const task={operationId:'test',finished:false,operation:{startedAt:Date.now()-200000},
   activityTimer:123,activity:{phase:'local',phaseStartedAt:Date.now()-200000,
    lastConfirmedAt:Date.now()-180000,detail:'正在分析长段落 · 7,924 字符',
    longParagraph:{index:1,characters:7924,startedAt:Date.now()-200000,
     stepStartedAt:Date.now()-190000,stage:'converter',substep:'lookup',
     checkpoint:{substep:'lookup',processed:0,total:1600},finished:[]}}};
  f.ctx.currentTask=task;
  f.ctx.renderTaskActivity(task);
  assert.match(f.detail.textContent,/整批词典查询进行中/);
  assert.match(f.detail.textContent,/无法确认是否卡住/);
  assert.doesNotMatch(f.detail.textContent,/正在持续执行|引擎仍在工作/);
  assert.equal(f.detail.dataset.wait,'long');
  assert.ok(f.progress.hasAttribute('value'));
 }finally{f.close();}
});

test('fast short paragraphs remain ordinary and manual wait pauses the same clock',async()=>{
 const f=fixture();
 try{
  const task={operationId:'test',finished:false,manualRequest:'m1',manualBackup:{batchNumber:1,batchTotal:2},
   operation:{startedAt:Date.now()},activityTimer:123,
   activity:{phase:'local',phaseStartedAt:Date.now(),lastConfirmedAt:Date.now(),
    detail:'正在分析第 1 段（90 字符）'}};
  f.ctx.currentTask=task;
  f.ctx.renderTaskActivity(task);
  assert.doesNotMatch(f.detail.textContent,/长段落|本段 \d+秒/);
  f.ctx.status('等待手动回填：第 1/2 批次');
  assert.match(f.detail.textContent,/已暂停引擎卡顿计时/);
  assert.ok(f.progress.hasAttribute('value'));
 }finally{f.close();}
});

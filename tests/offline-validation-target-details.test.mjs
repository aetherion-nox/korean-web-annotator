import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SOURCE=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
const helperStart=SOURCE.indexOf('  function manualMissingTargetDetails(');
const helperEnd=SOURCE.indexOf('  function manualRetryPrompt(',helperStart);
const applyStart=SOURCE.indexOf('  async function applyManualRecovery(');
const applyEnd=SOURCE.indexOf('  function panelStatus(',applyStart);
const mergedStart=SOURCE.indexOf('  async function applyMergedOfflineFrame(');
const mergedEnd=SOURCE.indexOf('  function watchManualReply(',mergedStart);
assert.ok(helperStart>0&&helperEnd>helperStart&&applyStart>0&&applyEnd>applyStart);
assert.ok(mergedStart>0&&mergedEnd>mergedStart);

function setup({rows=[],binding,projectBinding}={}){
 const sourceBinding=binding||{target_id:'t42',sentenceId:'p3',start:2,end:4,
  surface:'원잠',choices:[{choice_id:'c0',annotations:[]},{choice_id:'KEEP',annotations:[]}]};
 const backup={requestId:'batch-7',bindings:[sourceBinding]};
 const text=JSON.stringify({batch_id:backup.requestId,results:rows});
 const entry={id:'e0',text:'이 원잠학교',selected:[{start:0,end:6}],annotations:[]};
 const task={
  operationId:'page-op',mergeGroupId:'frame-group-10',mergedGroup:true,
  manualBackup:backup,manualRequest:backup.requestId,
  manualRecoveryAccepted:new Map(),manualOriginalPrompt:'',entries:new Map([['e0',entry]]),
  modes:{hanja:true,loanword:true},
  paragraphPlan:{sentences:[{id:'p3',text:'이 원잠학교'}],
   projectBinding:projectBinding||(()=>[{sentenceId:'e0',start:2,end:4,surface:'원잠',annotations:[]}])},
  paint(){throw Error('The validate phase must never paint')}
 };
 const ctx={
  currentTask:task,console,
  stagePageRepairs:()=>({retired:new Set(),groups:new Map(),reasons:new Map(),applied:[]}),
  manualLiteralChoice:async()=>null
 };
 vm.createContext(ctx);
 vm.runInContext(SOURCE.slice(helperStart,helperEnd),ctx);
 vm.runInContext(SOURCE.slice(applyStart,applyEnd),ctx);
 vm.runInContext(SOURCE.slice(mergedStart,mergedEnd),ctx);
 return {ctx,task,entry,backup,text};
}

test('offline validation identifies the exact missing target and its original source',async()=>{
 const {ctx,task,text}=setup();
 await assert.rejects(ctx.applyManualRecovery(task,text,{dryRun:true}),e=>{
  assert.match(e.message,/尚有 1 个目标/);
  assert.match(e.message,/t42「원잠」/);
  assert.match(e.message,/p3:2-4/);
  assert.match(e.message,/本批答案中未找到有效结果/);
  return true;
 });
 assert.equal(task.manualRecoveryAccepted.size,0,'a dry run cannot commit state');
});

test('unusable per-target origin is a valid null fallback in dry-run validation',async()=>{
 const {ctx,task,text}=setup({rows:[{t:'t42',c:'not-a-choice'}]});
 await ctx.applyManualRecovery(task,text,{dryRun:true});
 assert.equal(task.manualRecoveryAccepted.size,0,'dry-run still must not mutate state');
});

test('wrong field type reports the specific offending target while retaining strict t/c schema',async()=>{
 const {ctx,task,text}=setup({rows:[{t:'t42',c:17}]});
 await assert.rejects(ctx.applyManualRecovery(task,text,{dryRun:true}),e=>{
  assert.match(e.message,/t42「원잠」/);
  assert.match(e.message,/答案字段不符合 t\/c 格式或 c 类型无效/);
  return true;
 });
});

test('duplicate target response reports original spelling and duplication reason',async()=>{
 const {ctx,task,text}=setup({rows:[{t:'t42',c:'c0'},{t:'t42',c:'c0'}]});
 await assert.rejects(ctx.applyManualRecovery(task,text,{dryRun:true}),e=>{
  assert.match(e.message,/t42「원잠」/);
  assert.match(e.message,/重复 target_id（本次出现 2 条）/);
  return true;
 });
});

test('projection disagreement reports the precise original target and projection error',async()=>{
 const {ctx,task,text}=setup({rows:[{t:'t42',c:'c0'}],
  projectBinding:()=>{throw Error('批次段落位置不一致');}});
 await assert.rejects(ctx.applyManualRecovery(task,text,{dryRun:true}),e=>{
  assert.match(e.message,/t42「원잠」/);
  assert.match(e.message,/原文结构无法安全对应：批次段落位置不一致/);
  return true;
 });
});

test('passing dryRun validates choices but never paints or commits annotations',async()=>{
 const {ctx,task,text,entry}=setup({rows:[{t:'t42',c:'c0'}]});
 const result=await ctx.applyManualRecovery(task,text,{dryRun:true});
 assert.equal(result.accepted,1);
 assert.equal(entry.annotations.length,0);
 assert.equal(task.manualRecoveryAccepted.size,0);
});

test('actual cross-frame validate handler returns target details and preserves original task',async()=>{
 const {ctx,task,backup,text}=setup();
 const answer=await ctx.applyMergedOfflineFrame({
  groupId:'frame-group-10',phase:'validate',
  frame:{operationId:'page-op',backup,answer:text}
 });
 assert.equal(answer.ok,false);
 assert.match(answer.error,/t42「원잠」/);
 assert.match(answer.error,/本批答案中未找到有效结果/);
 assert.equal(task.manualBackup,backup);
 assert.equal(task.manualRecoveryAccepted.size,0);
});

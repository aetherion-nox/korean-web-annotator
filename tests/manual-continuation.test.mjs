import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {normalizeBatchContextTier,describeBatchBudget} from '../batch-budget.js';
test('explicit capacities migrate current to 32k and include 256k',()=>{
 assert.equal(normalizeBatchContextTier('current'),'32k');
 for(const [tier,size] of [['32k',32000],['128k',128000],['256k',256000],['512k',512000],['1m',1000000]]){
  assert.equal(normalizeBatchContextTier(tier),tier);assert.equal(describeBatchBudget('',[],{tier}).contextTokens,size);
 }
});
function environment(){
 const nodes=new Map();const panel={dataset:{operationId:'op'},querySelector:key=>{if(!nodes.has(key))nodes.set(key,{value:'',textContent:'',disabled:false});return nodes.get(key);}};
 const entry={id:'s',text:'가나',selected:[{start:0,end:2}],annotations:[],localAnnotations:[]};
 const event=(n)=>({type:'MANUAL_REVIEW_REQUEST',requestId:'batch'+n,batchNumber:n,batchTotal:2,targetCount:1,text:'prompt'+n,bindings:[{target_id:'t0',sentenceId:'s',start:n-1,end:n,surface:entry.text[n-1],choices:[{choice_id:'KEEP',annotations:[]},{choice_id:'c0',annotations:[{start:n-1,end:n,surface:entry.text[n-1],replacement:n===1?'可':'那',type:'hanja'}]}]}]});
 const task={operationId:'op',entries:new Map([['node',entry]]),modes:{hanja:true},manualBackup:event(1),manualRequest:'batch1',manualLocalOnly:true,manualPlan:[event(1),event(2)],paint:()=>entry.annotations.length};
 const context={uiSettings:{hideToolbarOnFirstManual:false},configureRecovery:()=>{},addDiagnostic:()=>{},seenSources:new Set(),configureAutomaticAnnotation:()=>{},currentTask:task,document:{querySelector:()=>panel},manualPanel:()=>panel,getToolbar:()=>panel,status:()=>{},refreshManualReopen:()=>{},publishState:()=>{},clearTimeout:()=>{},clearInterval:()=>{},setTimeout:()=>1,finishTask:(t,m,done)=>{t.finished=true;t.completed=done;},console};
 vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../review-validation-core.js',import.meta.url),'utf8'),context);const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');const code=source.slice(source.indexOf('  function recoverManualConnection'),source.indexOf('  function status(',source.indexOf('  function recoverManualConnection')));vm.runInContext(code,context);
 return {context,task,entry,panel};
}
test('disconnected first batch advances to second and completes both',()=>{
 const {context,task,entry}=environment();
 context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:[{target_id:'t0',choice_id:'c0'}]}));
 assert.equal(task.finished,undefined);assert.equal(task.manualRequest,'batch2');assert.equal(task.manualLocalOnly,true);
 context.applyManualRecovery(task,JSON.stringify({batch_id:'batch2',results:[{target_id:'t0',choice_id:'KEEP'}]}));
 assert.equal(task.completed,true);assert.equal(entry.annotations.length,1);
});
test('invalid recovery answer does not change entries or advance batch',()=>{
 const {context,task,entry}=environment();assert.throws(()=>context.applyManualRecovery(task,JSON.stringify({batch_id:'wrong',results:[]})));assert.equal(entry.annotations.length,0);assert.equal(task.manualRequest,'batch1');
});
test('acceptance stops the response watchdog instead of timing next batch',()=>{
 const {context,task,panel}=environment();panel.dataset.operationId='op';let timers=0;context.setTimeout=()=>++timers;
 panel.querySelector('.kra-manual-response').value=JSON.stringify({batch_id:'batch1',results:[{target_id:'t0',choice_id:'c0'}]});
 context.handleManualEvent(task,{type:'MANUAL_REVIEW_ACCEPTED',requestId:'batch1',targetCount:1});assert.equal(timers,0);
});
test('accepted batch remains available before later model events arrive',()=>{
 const {context,task,panel,entry}=environment();task.manualLocalOnly=false;
 panel.querySelector('.kra-manual-response').value=JSON.stringify({batch_id:'batch1',results:[{target_id:'t0',choice_id:'c0'}]});
 context.handleManualEvent(task,{type:'MANUAL_REVIEW_ACCEPTED',requestId:'batch1',targetCount:1});
 assert.equal(entry.annotations.length,1);assert.ok(task.manualApplied.has('batch1'));
 context.recoverManualConnection(task,'lost');
 context.applyManualRecovery(task,panel.querySelector('.kra-manual-response').value);
 assert.equal(task.manualRequest,'batch2');assert.equal(entry.annotations.length,1);
});

test('offline recovery preserves valid rows and reports only invalid choice IDs',()=>{
 const {context,task,entry,panel}=environment();
 const second={target_id:'t1',sentenceId:'s',start:1,end:2,surface:'나',
  choices:[{choice_id:'KEEP',annotations:[]},{choice_id:'c0',annotations:[{start:1,end:2,surface:'나',replacement:'那',type:'hanja'}]}]};
 task.manualBackup={...task.manualBackup,bindings:[task.manualBackup.bindings[0],second]};
 task.manualOriginalPrompt='Original instructions\n{"format":"shared-pools-v3","context":"가나","sentences":[{"sentence_id":"s0","text":"가나"}],"candidates":[],"targets":[{"target_id":"t0","sentence_id":"s0","surface":"가","options":{"KEEP":null}},{"target_id":"t1","sentence_id":"s0","surface":"나","options":{"KEEP":null}}],"batch_id":"batch1"}';
 const bad=JSON.stringify({batch_id:'batch1',results:[{target_id:'t0',choice_id:'c0'},{target_id:'t1',choice_id:'c99'}]});
 assert.throws(()=>context.applyManualRecovery(task,bad),/t1.*INVALID_CHOICE/);
 assert.equal(task.manualRecoveryAccepted.size,1);
 assert.equal(entry.annotations.length,1); // verified choices are provisionally visible
 assert.equal(entry.hasPreview,true);
 assert.match(panel.querySelector('.kra-manual-prompt').value,/"target_id":"t1"/);
 assert.doesNotMatch(panel.querySelector('.kra-manual-prompt').value,/"target_id":"t0"/);
 assert.throws(()=>context.applyManualRecovery(task,JSON.stringify({batch_id:'wrong',results:[{target_id:'t1',choice_id:'c0'}]})),/batch_id/);
 assert.equal(task.manualRecoveryAccepted.size,1);
 context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:[{target_id:'t1',choice_id:'c0'}]}),{advance:false,paint:false});
 assert.equal(task.manualRecoveryAccepted.size,2);
 assert.equal(entry.annotations.length,2);
});
test('unknown and duplicated IDs are distinguished instead of conflated with invalid choices',()=>{
 const {context,task}=environment();
 assert.throws(()=>context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:[
  {target_id:'t999',choice_id:'KEEP'}]})),/未知 target_id：t999/);
 assert.throws(()=>context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:[
  {target_id:'t0',choice_id:'KEEP'},{target_id:'t0',choice_id:'c0'}]})),/重复 target_id：t0/);
});

test('a pending server batch previews accepted decisions without committing the batch',()=>{
 const {context,task,entry,panel}=environment();
 task.manualLocalOnly=false;
 context.handleManualEvent(task,{type:'MANUAL_REVIEW_ERROR',requestId:'batch1',
   error:'已保留 1/2 条答案，剩余待修复',
   acceptedRows:[{target_id:'t0',choice_id:'c0'}],acceptedCount:1,repairPrompt:'repair only t1'});
 assert.equal(entry.annotations[0].replacement,'可');
 assert.equal(entry.hasPreview,true);
 assert.equal(task.manualApplied,undefined);
 assert.equal(panel.querySelector('.kra-manual-apply').disabled,false);
 assert.equal(task.manualRecoveryAccepted.size,1);
});
test('offline mixed-invalid replies preserve valid choices while isolating duplicates',()=>{
 const {context,task,entry}=environment();
 const second={target_id:'t1',sentenceId:'s',start:1,end:2,surface:'나',
   choices:[{choice_id:'KEEP',annotations:[]},{choice_id:'c0',annotations:[{start:1,end:2,surface:'나',replacement:'那',type:'hanja'}]}]};
 task.manualBackup={...task.manualBackup,bindings:[task.manualBackup.bindings[0],second]};
 assert.throws(()=>context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:[
  {target_id:'t0',choice_id:'c0'},
  {target_id:'t1',choice_id:'KEEP'},
  {target_id:'t1',choice_id:'c0'},
  {target_id:'foreign',choice_id:'KEEP'}
 ]})),/重复 target_id：t1/);
 assert.equal(task.manualRecoveryAccepted.size,1);
 assert.equal(entry.annotations.length,1);
 assert.equal(entry.hasPreview,true);
 context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:[{target_id:'t1',choice_id:'c0'}]}),{advance:false,paint:false});
 assert.equal(entry.annotations.length,2);
 assert.equal(entry.hasPreview,false);
});

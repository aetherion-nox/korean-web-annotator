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
 const context={uiSettings:{hideToolbarOnFirstManual:false},configureRecovery:()=>{},seenSources:new Set(),configureAutomaticAnnotation:()=>{},currentTask:task,document:{querySelector:()=>panel},manualPanel:()=>panel,getToolbar:()=>panel,status:()=>{},refreshManualReopen:()=>{},publishState:()=>{},clearTimeout:()=>{},clearInterval:()=>{},setTimeout:()=>1,finishTask:(t,m,done)=>{t.finished=true;t.completed=done;},console};
 vm.createContext(context);const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');const code=source.slice(source.indexOf('  function recoverManualConnection'),source.indexOf('  function status(',source.indexOf('  function recoverManualConnection')));vm.runInContext(code,context);
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

test('page-only recovery rejects direct unverified Hanja string without changing annotations',()=>{
 const {context,task,entry}=environment();
 const proposed={batch_id:'batch1',results:[{target_id:'t0',choice_id:'可'}]};
 assert.throws(()=>context.applyManualRecovery(task,JSON.stringify(proposed)),/后台校验/);
 assert.equal(entry.annotations.length,0);
 assert.equal(task.manualRequest,'batch1');
});

test('disconnected page recovery accepts missing batch_id only with matching IDs and count',()=>{
 const {context,task,entry}=environment();
 assert.throws(()=>context.applyManualRecovery(task,JSON.stringify({results:[]})),/不完整/);
 assert.throws(()=>context.applyManualRecovery(task,JSON.stringify({results:[{target_id:'other',choice_id:'c0'}]})),/target_id/);
 assert.throws(()=>context.applyManualRecovery(task,JSON.stringify({batch_id:'wrong',results:[{target_id:'t0',choice_id:'c0'}]})),/batch_id/);
 assert.equal(task.manualRequest,'batch1');assert.equal(entry.annotations.length,0);
 context.applyManualRecovery(task,JSON.stringify({results:[{target_id:'t0',choice_id:'c0'}]}));
 assert.equal(task.manualRequest,'batch2');
 context.applyManualRecovery(task,JSON.stringify({results:[{target_id:'t0',choice_id:'KEEP'}]}));
 assert.equal(task.completed,true);assert.equal(entry.annotations.length,1);
});
test('missing batch_id never permits raw model origins in disconnected page recovery',()=>{
 const {context,task,entry}=environment();
 assert.throws(()=>context.applyManualRecovery(task,JSON.stringify({results:[{target_id:'t0',choice_id:'可'}]})),/后台校验/);
 assert.equal(task.manualRequest,'batch1');
 assert.equal(entry.annotations.length,0);
});

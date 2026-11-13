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
 const context={chrome:{runtime:{getURL:name=>new URL('../'+name,import.meta.url).href}},uiSettings:{hideToolbarOnFirstManual:false},configureRecovery:()=>{},seenSources:new Set(),configureAutomaticAnnotation:()=>{},currentTask:task,document:{querySelector:()=>panel},manualPanel:()=>panel,getToolbar:()=>panel,status:()=>{},refreshManualReopen:()=>{},publishState:()=>{},clearTimeout:()=>{},clearInterval:()=>{},setTimeout:()=>1,finishTask:(t,m,done)=>{t.finished=true;t.completed=done;},console};
 vm.createContext(context);const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');const code=source.slice(source.indexOf('  function recoverManualConnection'),source.indexOf('  function status(',source.indexOf('  function recoverManualConnection')));vm.runInContext(code,context,{importModuleDynamically:specifier=>import(specifier)});
 return {context,task,entry,panel};
}
test('disconnected first batch advances to second and completes both',async()=>{
 const {context,task,entry}=environment();
 await context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:['c0']}));
 assert.equal(task.finished,undefined);assert.equal(task.manualRequest,'batch2');assert.equal(task.manualLocalOnly,true);
 await context.applyManualRecovery(task,JSON.stringify({batch_id:'batch2',results:[null]}));
 assert.equal(task.completed,true);assert.equal(entry.annotations.length,1);
});
test('invalid recovery answer does not change entries or advance batch',async()=>{
 const {context,task,entry}=environment();await assert.rejects(context.applyManualRecovery(task,JSON.stringify({batch_id:'wrong',results:[]})));assert.equal(entry.annotations.length,0);assert.equal(task.manualRequest,'batch1');
});
test('acceptance stops the response watchdog instead of timing next batch',()=>{
 const {context,task,panel}=environment();panel.dataset.operationId='op';let timers=0;context.setTimeout=()=>++timers;
 panel.querySelector('.kra-manual-response').value=JSON.stringify({batch_id:'batch1',results:['c0']});
 context.handleManualEvent(task,{type:'MANUAL_REVIEW_ACCEPTED',requestId:'batch1',targetCount:1});assert.equal(timers,0);
});
test('accepted batch remains available before later model events arrive',async()=>{
 const {context,task,panel,entry}=environment();task.manualLocalOnly=false;
 panel.querySelector('.kra-manual-response').value=JSON.stringify({batch_id:'batch1',results:['c0']});
 context.handleManualEvent(task,{type:'MANUAL_REVIEW_ACCEPTED',requestId:'batch1',targetCount:1});
 assert.equal(entry.annotations.length,1);assert.ok(task.manualApplied.has('batch1'));
 context.recoverManualConnection(task,'lost');
 await context.applyManualRecovery(task,panel.querySelector('.kra-manual-response').value);
 assert.equal(task.manualRequest,'batch2');assert.equal(entry.annotations.length,1);
});

test('page-only recovery rejects direct Hanja string when experimental mode metadata is absent',async()=>{
 const {context,task,entry}=environment();
 const proposed={batch_id:'batch1',results:['可']};
 await assert.rejects(context.applyManualRecovery(task,JSON.stringify(proposed)),/无效答案/);
 assert.equal(entry.annotations.length,0);
 assert.equal(task.manualRequest,'batch1');
});

test('disconnected page recovery accepts missing batch_id only with matching IDs and count',async()=>{
 const {context,task,entry}=environment();
 await assert.rejects(context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:[]})),/不完整/);
 await assert.rejects(context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:['c0']})),/target_id/);
 await assert.rejects(context.applyManualRecovery(task,JSON.stringify({batch_id:'wrong',results:['c0']})),/batch_id/);
 assert.equal(task.manualRequest,'batch1');assert.equal(entry.annotations.length,0);
 await context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:['c0']}));
 assert.equal(task.manualRequest,'batch2');
 await context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:[null]}));
 assert.equal(task.completed,true);assert.equal(entry.annotations.length,1);
});
test('missing batch_id does not bypass experimental-origin eligibility checks',async()=>{
 const {context,task,entry}=environment();
 await assert.rejects(context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:['可']})),/无效答案/);
 assert.equal(task.manualRequest,'batch1');
 assert.equal(entry.annotations.length,0);
});

test('disconnected recovery accepts model-supplied Latin origin only with experimental permission',async()=>{
 const {context,task,entry}=environment();
 task.modes.loanword=true;
 task.manualBackup.bindings[0].literalOrigin={eligible:true,hanja:false,loanword:true,known:[]};
 await context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:['game']}));
 assert.equal(task.manualRequest,'batch2');
 assert.equal(entry.annotations.length,1);
 assert.equal(entry.annotations[0].replacement,'game');
 assert.equal(entry.annotations[0].origin_source,'model-unverified');
 assert.equal(entry.annotations[0].type,'loanword');
});

test('disconnected recovery rejects known dictionary spellings masquerading as new origins',async()=>{
 const {context,task,entry}=environment();
 task.modes.loanword=true;
 task.manualBackup.bindings[0].literalOrigin={eligible:true,hanja:false,loanword:true,known:[{type:'loanword',replacement:'game'}]};
 await assert.rejects(context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:['game']})),/无效答案/);
 assert.equal(entry.annotations.length,0);
 assert.equal(task.manualRequest,'batch1');
});

test('disconnected recovery fails closed for prohibited names and malformed Hanzi spans',async()=>{
 const {context,task,entry}=environment();
 const meta={eligible:false,hanja:true,loanword:true,known:[]};
 task.manualBackup.bindings[0].literalOrigin=meta;task.modes.loanword=true;
 await assert.rejects(context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:['game']})),/无效答案/);
 meta.eligible=true;
 await assert.rejects(context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:['韓字']})),/无效答案/);
 await assert.rejects(context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:['game',extra:true]})),/无效答案/);
 assert.equal(entry.annotations.length,0);assert.equal(task.manualRequest,'batch1');
});

test('disconnected Latin origin preserves the existing alphanumeric suffix',async()=>{
 const {context,task,entry}=environment();
 entry.text='가나42';
 task.manualBackup.bindings[0].surface='가나42';
 task.manualBackup.bindings[0].start=0;task.manualBackup.bindings[0].end=4;
 task.manualBackup.bindings[0].literalOrigin={eligible:true,hanja:false,loanword:true,known:[]};
 task.modes.loanword=true;entry.selected=[{start:0,end:4}];
 await context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:['game42']}));
 assert.equal(entry.annotations.length,1);
 assert.equal(entry.annotations[0].replacement,'game');
 assert.equal(entry.annotations[0].surface,'가나');
 assert.equal(entry.annotations[0].start,0);assert.equal(entry.annotations[0].end,2);
});

test('partial page results preview valid rows, preserve them and complete after small retry',async()=>{
 const {context,task,entry,panel}=environment();
 const other={target_id:'t1',sentenceId:'s',start:1,end:2,surface:'나',
   choices:[{choice_id:'KEEP',annotations:[]},{choice_id:'c0',annotations:[{start:1,end:2,surface:'나',replacement:'那',type:'hanja'}]}]};
 task.manualBackup.bindings.push(other);
 await assert.rejects(context.applyManualRecovery(task,JSON.stringify({
   batch_id:'batch1',results:['c0','invalid']
 })),/已验证 1\/2/);
 assert.equal(task.manualRequest,'batch1');
 assert.equal(task.manualRecoveryAccepted.size,1);
 assert.equal(entry.annotations.length,1);
 assert.equal(entry.hasPreview,true);
 assert.match(panel.querySelector('.kra-manual-prompt').value,/1/);
 await context.applyManualRecovery(task,JSON.stringify({
   batch_id:'batch1',partial:true,results:[[1,'c0']]
 }));
 assert.equal(task.manualRequest,'batch2');
 assert.equal(entry.annotations.length,2);
 assert.equal(entry.hasPreview,false);
});

test('wrong-length positional answer is rejected without assigning uncertain offsets',async()=>{
 const {context,task,entry}=environment();
 task.manualBackup.bindings.push({target_id:'t1',sentenceId:'s',start:1,end:2,surface:'나',
  choices:[{choice_id:'KEEP',annotations:[]},{choice_id:'c0',annotations:[{start:1,end:2,surface:'나',replacement:'那',type:'hanja'}]}]});
 await assert.rejects(context.applyManualRecovery(task,JSON.stringify({
  batch_id:'batch1',results:['c0',null,'c0']
 })),/长度/);
 assert.equal(task.manualRecoveryAccepted?.size||0,0);
 assert.equal(entry.annotations.length,0);
 await context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:['c0',null]}));
 assert.equal(task.manualRequest,'batch2');
});

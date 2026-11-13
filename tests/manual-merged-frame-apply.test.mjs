import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
function fixture(){
 const source='가',entry={id:'p0',text:source,
  selected:[{start:0,end:1}],annotations:[],localAnnotations:[]};
 const task={operationId:'orig-op',mergeGroupId:'frame-group-7',mergedGroup:true,
  finished:false,entries:new Map([['p0',entry]]),modes:{hanja:true,loanword:false},
  paragraphPlan:{sentences:[{id:'p0',text:source}],
   projectBinding:(binding,choice)=>[{
    sentenceId:binding.sentenceId,start:binding.start,end:binding.end,
    surface:binding.surface,annotations:choice.annotations}]},
  manualRequest:null,manualBackup:null,paint:()=>entry.annotations.length};
 const panel={querySelector:()=>({value:'',textContent:''})};
 const c={currentTask:task,document:{querySelector:()=>panel},
  configureRecovery(){},clearTimeout(){},clearInterval(){},status(){},
  manualPanel:()=>panel,console,JSON};
 vm.createContext(c);
 vm.runInContext(src.slice(src.indexOf('  function recoverManualConnection'),
  src.indexOf('  function status(')),c);
 const batch={requestId:'late-batch',bindings:[{
  target_id:'t0',sentenceId:'p0',start:0,end:1,surface:'가',
  choices:[
   {choice_id:'KEEP',annotations:[]},
   {choice_id:'c0',annotations:[{start:0,end:1,surface:'가',replacement:'可',type:'hanja'}]}
  ]
 }]};
 const frame={frameId:3,operationId:'orig-op',backup:batch,
  originalPrompt:'',answer:JSON.stringify({batch_id:'late-batch',results:[{t:'t0',c:'c0'}]})};
 return {c,task,entry,frame};
}
test('two-phase rescue validates before it modifies the source DOM',async()=>{
 const {c,task,entry,frame}=fixture();
 assert.equal((await c.applyMergedOfflineFrame({groupId:'frame-group-7',phase:'validate',frame})).ok,true);
 assert.deepEqual(entry.annotations,[]);
 assert.equal(task.manualBackup,null,'temporary backup must not overwrite current panel state');
 assert.equal((await c.applyMergedOfflineFrame({groupId:'frame-group-7',phase:'commit',frame})).ok,true);
 assert.equal(entry.annotations[0].replacement,'可');
 assert.equal(task.manualOfflineCommitted.has('late-batch'),true);
 assert.equal((await c.applyMergedOfflineFrame({groupId:'frame-group-7',phase:'commit',frame})).alreadyApplied,true);
 assert.equal(entry.annotations.length,1,'replay is idempotent');
});
test('stale frame operation identity and mismatching DOM spans are rejected',async()=>{
 const {c,entry,frame}=fixture();
 assert.equal((await c.applyMergedOfflineFrame({groupId:'other',phase:'validate',frame})).ok,false);
 assert.equal((await c.applyMergedOfflineFrame({groupId:'frame-group-7',phase:'commit',frame:{...frame,operationId:'new-doc'}})).ok,false);
 entry.text='다';
 const r=await c.applyMergedOfflineFrame({groupId:'frame-group-7',phase:'validate',frame});
 assert.equal(r.ok,false);
 assert.deepEqual(entry.annotations,[]);
});
test('invalid choice and missing rows stay recoverable without partial commit',async()=>{
 const {c,entry,frame}=fixture();
 frame.answer=JSON.stringify({batch_id:'late-batch',results:[{t:'t0',c:'unknown'}]});
 const r=await c.applyMergedOfflineFrame({groupId:'frame-group-7',phase:'validate',frame});
 assert.equal(r.ok,false);
 assert.equal(entry.annotations.length,0);
 const fixed={...frame,answer:JSON.stringify({batch_id:'late-batch',results:[{t:'t0',c:null}]})};
 assert.equal((await c.applyMergedOfflineFrame({groupId:'frame-group-7',phase:'validate',frame:fixed})).ok,true);
 assert.equal((await c.applyMergedOfflineFrame({groupId:'frame-group-7',phase:'commit',frame:fixed})).ok,true);
 assert.equal(entry.annotations.length,0,'null keeps original Hangul and still counts as applied');
});

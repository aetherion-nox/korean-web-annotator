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
test('malformed c value and missing rows stay recoverable without partial commit',async()=>{
 const {c,entry,frame}=fixture();
 frame.answer=JSON.stringify({batch_id:'late-batch',results:[{t:'t0',c:17}]});
 const r=await c.applyMergedOfflineFrame({groupId:'frame-group-7',phase:'validate',frame});
 assert.equal(r.ok,false);
 assert.equal(entry.annotations.length,0);
 const fixed={...frame,answer:JSON.stringify({batch_id:'late-batch',results:[{t:'t0',c:null}]})};
 assert.equal((await c.applyMergedOfflineFrame({groupId:'frame-group-7',phase:'validate',frame:fixed})).ok,true);
 assert.equal((await c.applyMergedOfflineFrame({groupId:'frame-group-7',phase:'commit',frame:fixed})).ok,true);
 assert.equal(entry.annotations.length,0,'null keeps original Hangul and still counts as applied');
});

test('same-spelling loanword literals survive cross-frame offline validation and retain unverified provenance',async()=>{
 for(const [surface,context,start,raw] of [
  ['머스크','멜론머스크',2,'musk'],
  ['유고','‘유고의 그림자’',1,'Yugo']
 ]){
  const {c,task,entry,frame}=fixture();
  entry.text=context;
  entry.selected=[{start:0,end:context.length}];
  task.paragraphPlan.sentences=[{id:'p0',text:context}];
  task.modes={hanja:true,loanword:true};
  frame.backup.bindings=[{
   target_id:surface==='머스크'?'t560':'t577',
   sentenceId:'p0',start,end:start+surface.length,surface,
   choices:[
    {choice_id:'KEEP',annotations:[]},
    {choice_id:'c0',annotations:[{start,end:start+surface.length,surface,replacement:raw,type:'loanword'}]}
   ],
   literalOrigin:{eligible:true,hanja:true,loanword:true,hanjaEligible:false,
    loanwordEligible:true,known:[{type:'loanword',replacement:raw}]}
  }];
  frame.answer=JSON.stringify({batch_id:'late-batch',
   results:[{t:frame.backup.bindings[0].target_id,c:raw}]});
  const checked=await c.applyMergedOfflineFrame({groupId:'frame-group-7',phase:'validate',frame});
  assert.equal(checked.ok,true,checked.error||'offline validation failed');
  assert.equal(entry.annotations.length,0,'dry-run may not modify the page');
  const committed=await c.applyMergedOfflineFrame({groupId:'frame-group-7',phase:'commit',frame});
  assert.equal(committed.ok,true,committed.error||'commit failed');
  assert.deepEqual(Array.from(entry.annotations,x=>[x.start,x.end,x.surface,x.replacement]),
   [[start,start+surface.length,surface,raw]]);
  assert.equal(entry.annotations[0].origin_source,'model-unverified',
   'same spelling must not silently inherit dictionary-backed provenance');
 }
});

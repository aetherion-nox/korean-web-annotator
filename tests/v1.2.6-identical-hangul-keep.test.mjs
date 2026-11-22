import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validateChoices,validateExperimentalChoices,identicalHangulKeep} from '../choice-review.js';
import {createManualReviewSession} from '../manual-review.js';
import {choicePreviewParser} from '../model-stream.js';

const keep=s=>({choice_id:null,type:'keep',replacement:s,entry_id:null,definitions:[]});
const hanja=(c,r)=>({choice_id:c,type:'hanja',replacement:r,entry_id:1234,definitions:['sample'],written_form:'만전',part_of_speech:'명사'});
const word=(id,surface)=>({target_id:id,context:surface,surface,start:0,end:surface.length,options:[keep(surface),hanja('c0','萬全')]});
const flags={reviewPosFilter:false,retryInvalidDictionaryChoices:true,discardInvalidReviewResults:false,
 experimentalHanja:true,experimentalLoanword:true};

test('exact identical Hangul including Korean names is equivalent to explicit JSON null',()=>{
 for(const surface of ['이재명','국힘','조희대','김한수','최교진','우','내']){
  const t=word('t0',surface);
  assert.equal(identicalHangulKeep(t,surface),true);
  for(const fn of [validateChoices,validateExperimentalChoices]){
   const result=fn([t],{results:[{t:'t0',c:surface}]},flags);
   assert.equal(result.accepted.length,1,surface);
   assert.equal(result.accepted[0].option.type,'keep');
   assert.equal(result.unresolved.length,0);
   assert.equal(result.experimentalAccepted||0,0,'Hangul echoes are never classified as generated etymology');
  }
 }
});

test('different Hangul, extra suffix, different case and Hanja cannot become null automatically',()=>{
 const t=word('t0','이재명');
 for(const value of ['이재명이','재명','이재명 ','이 재명','리재명','이재명!','']){
  const row={t:'t0',c:value};
  for(const fn of [validateChoices,validateExperimentalChoices]){
   const result=fn([t],{results:[row]},flags);
   assert.equal(result.accepted.length,0,value);
   assert.equal(result.unresolved.length,1,value);
  }
 }
 // Hanja may independently be permitted as an experimental origin, but
 // it must never be quietly rewritten to null via the Hangul-echo rule.
 const origin=validateExperimentalChoices([t],{results:[{t:'t0',c:'李在明'}]},flags);
 assert.ok(origin.accepted.every(row=>row.option.type!=='keep'));
 const loan=word('t0','트위터');
 assert.equal(identicalHangulKeep(loan,'Twitter'),false);
 assert.equal(identicalHangulKeep(loan,'트위터'),true);
 assert.equal(identicalHangulKeep({surface:'A'},'A'),false,'only Hangul can be this compatibility form');
});

test('duplicate null and identical Hangul rows are the same decision, but a different Hangul still conflicts',()=>{
 const t=word('t0','국힘');
 for(const fn of [validateChoices,validateExperimentalChoices]){
  const ok=fn([t],{results:[{t:'t0',c:'국힘'},{t:'t0',c:null}]},flags);
  assert.equal(ok.accepted.length,1);
  const fail=fn([t],{results:[{t:'t0',c:'국힘'},{t:'t0',c:'국힘당'}]},flags);
  assert.equal(fail.accepted.length,0);
  assert.equal(fail.unresolved.length,1);
 }
});

test('manual submission: 13 raw Hangul echoes accepted; only the other 2 wrong choices need retry',async()=>{
 const ids=['이재명','이재명','이재명','이재명','우','이재명','국힘',
  '조희대','김한수','최교진','국힘','조희대','조선일보'];
 const targets=[
  ...ids.map((s,i)=>word('orig'+i,s)),
  word('orig13','참석차'),word('orig14','만전')
 ];
 const events=[],session=createManualReviewSession({operationId:'hangul-echo',post:e=>events.push(e)});
 const done=session.request({...flags,context:'source'},targets);
 const req=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 const rows=[
  ...ids.map((s,i)=>({t:'t'+i,c:s})),
  {t:'t13',c:'參席'},{t:'t14',c:'p1046'}
 ];
 const first=session.submit({operationId:'hangul-echo',requestId:req.requestId,
  text:JSON.stringify({batch_id:req.requestId,results:rows})});
 assert.equal(first,false,'two invalid answers are still pending');
 const err=events.filter(e=>e.type==='MANUAL_REVIEW_ERROR'&&e.invalidTargetIds).at(-1);
 assert.equal(err.acceptedCount,13);
 assert.deepEqual(err.invalidTargetIds,['t13','t14']);
 assert.equal(err.acceptedRows.length,13);
 assert.ok(err.acceptedRows.every(row=>row.c===null));
 const repaired=session.submit({operationId:'hangul-echo',requestId:req.requestId,
  text:JSON.stringify({batch_id:req.requestId,results:[{t:'t13',c:null},{t:'t14',c:null}]})});
 assert.equal(repaired,true);
 const completed=await done;
 assert.equal(completed.results.length,15);
 assert.ok(completed.results.every(row=>row.c===null));
});

test('manual duplicate equivalent to null is accepted without false conflict',async()=>{
 const events=[],session=createManualReviewSession({operationId:'duplicate-echo',post:e=>events.push(e)});
 const done=session.request({...flags,context:'국힘'},[word('first','국힘')]);
 const req=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 assert.equal(session.submit({operationId:'duplicate-echo',requestId:req.requestId,
  text:JSON.stringify({batch_id:req.requestId,results:[{t:'t0',c:'국힘'},{t:'t0',c:null}]})}),true);
 assert.deepEqual((await done).results,[{t:'first',c:null}]);
});

test('streaming preview does not show speculative annotation for identical Hangul',()=>{
 const target=word('t0','국힘');
 let current=[];
 const update=choicePreviewParser([target],result=>{current=result;},()=>null,{choiceIndex:{}});
 update(JSON.stringify({results:[{t:'t0',c:'국힘'}]}));
 assert.equal(current.length,1);
 assert.equal(current[0].option.type,'keep');
});

test('disconnected recovery: identical Hangul commits safe null; mismatched Hangul remains retryable',async()=>{
 const entry={id:'p0',text:'국힘',selected:[{start:0,end:2}],annotations:[],localAnnotations:[]};
 const task={operationId:'orig',mergeGroupId:'frame-group-3',mergedGroup:true,
  finished:false,entries:new Map([['p0',entry]]),
  modes:{hanja:true,loanword:false},manualRequest:null,manualBackup:null,
  paragraphPlan:{sentences:[{id:'p0',text:'국힘'}],projectBinding:(b,c)=>[{
   sentenceId:b.sentenceId,start:b.start,end:b.end,surface:b.surface,annotations:c.annotations}]},
  paint:()=>entry.annotations.length};
 const panel={querySelector:()=>({value:'',textContent:''})};
 const c={currentTask:task,document:{querySelector:()=>panel},clearTimeout(){},clearInterval(){},
  status(){},console,JSON};
 vm.createContext(c);
 const src=readFileSync(new URL('../content.js',import.meta.url),'utf8');
 vm.runInContext(src.slice(src.indexOf('  function recoverManualConnection'),
  src.indexOf('  function status(')),c);
 const backup={requestId:'batch-echo',retryInvalidDictionaryChoices:true,
  discardInvalidReviewResults:false,choiceIndex:{t0:{}},bindings:[{
    target_id:'t0',sentenceId:'p0',start:0,end:2,surface:'국힘',
    choices:[{choice_id:null,annotations:[]}]
  }]};
 const apply=async(phase,value)=>c.applyMergedOfflineFrame({
  groupId:'frame-group-3',phase,partial:true,frame:{frameId:0,operationId:'orig',
   backup,originalPrompt:'',answer:JSON.stringify({
    batch_id:'batch-echo',results:[{t:'t0',c:value}]})}
 });
 const valid=await apply('validate','국힘');
 assert.equal(valid.ok,true,valid.error);
 assert.equal(valid.checked.accepted,1);
 assert.equal((await apply('commit','국힘')).ok,true);
 assert.equal(task.manualRecoveryAccepted.size,1);
 assert.equal(task.manualOfflineCommitted.has('batch-echo'),true);
 assert.equal(entry.annotations.length,0);
 const second=await apply('commit','다른말');
 assert.equal(second.alreadyApplied,true,'no retry can overwrite a committed keep');
});

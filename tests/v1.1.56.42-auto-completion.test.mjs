import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {reviewTargets} from '../choice-review.js';
import {runSentencePipeline} from '../annotation-pipeline.js';
import {requestTimeoutGuard} from '../request-timeout.js';
const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');

const target=(id,start)=>({
 target_id:id,start,end:start+2,surface:'학교',context:'학교 학교 학교 학교',
 options:[{choice_id:null,type:'keep',replacement:'학교',entry_id:null,definitions:[]},
  {choice_id:'c0',type:'hanja',replacement:'學校',entry_id:42,definitions:['school']}]
});
test('a transient API failure automatically halves the request and finishes every target',async()=>{
 const targets=[0,1,2,3].map(i=>target('t'+i,i*3));
 const called=[],accepted=[];
 const diagnostics=[];
 const result=await reviewTargets({
  enableModelReview:true,provider:'fixture',model:'test',endpoint:'https://fixture.test/api',
  request:async(_,current)=>{
   called.push(current.map(t=>t.target_id));
   if(called.length===1)throw new TypeError('network interrupted');
   return {results:current.map(t=>({t:t.target_id,c:'c0'}))};
  },
  onAccepted:items=>accepted.push(...items.map(a=>a.target.target_id)),
  onDiagnostic:d=>diagnostics.push(d)
 },targets);
 assert.deepEqual(called,[['t0','t1','t2','t3'],['t0','t1'],['t2','t3']]);
 assert.equal(result.unresolved.length,0);
 assert.deepEqual(accepted,['t0','t1','t2','t3']);
 assert.ok(diagnostics.some(d=>d.stage==='retry'));
});
test('a valid yet incomplete API response is retried with progressively smaller subsets',async()=>{
 const targets=[0,1,2].map(i=>target('t'+i,i*3)),calls=[];
 const result=await reviewTargets({
  enableModelReview:true,model:'test',provider:'fixture',endpoint:'https://fixture.test/api',
  request:async(_,rows)=>{
   calls.push(rows.map(r=>r.target_id));
   return {results:rows.length>1?[{t:rows[0].target_id,c:'c0'}]:
    rows.map(r=>({t:r.target_id,c:'c0'}))};
  }
 },targets);
 assert.equal(result.accepted.length,3);
 assert.equal(result.unresolved.length,0);
 assert.ok(calls.length>=3);
});
test('permanent HTTP failures are not pointlessly retried or called complete',async()=>{
 let requests=0;const diagnostics=[];
 const result=await reviewTargets({enableModelReview:true,model:'test',
  provider:'fixture',endpoint:'https://fixture.test/api',
  request:async()=>{requests++;const error=Error('401');error.permanent=true;throw error;},
  onDiagnostic:d=>diagnostics.push(d)
 },[target('t0',0)]);
 assert.equal(requests,1);
 assert.equal(result.unresolved.length,1);
 assert.ok(diagnostics.some(d=>d.stage==='incomplete'));
 assert.equal(result.errors[0].permanent,true);
});
test('pipeline DONE explicitly reports missing model choices instead of false 100% success',async()=>{
 const identity={engine_version:'test',dictionary_fingerprint:'fixture'},events=[];
 const analysis={...identity,annotations:[],targets:[target('t0',0)],
  stats:{local_determined:0,pending:1}};
 await runSentencePipeline({operationId:'op',sentences:[{id:'p0',text:'학교 학교 학교 학교'}],
  modes:{hanja:true,loanword:false},progressiveAnnotation:false
 },event=>events.push(event),{
  enabled:true,status:async()=>identity,analyze:async()=>analysis,
  modelConfig:async()=>({provider:'fixture',model:'test',
   endpoint:'https://fixture.test/api',request:async()=>({results:[]})})
 });
 const done=events.find(e=>e.type==='DONE');
 assert.equal(done.reviewIncomplete,true);
 assert.equal(done.unansweredTargets,1);
 assert.equal(done.stats.model_unanswered,1);
 assert.equal(done.canAutoResume,true);
});
test('streaming activity extends idle timeout; explicit cleanup prevents late abort',async()=>{
 const guard=requestTimeoutGuard({hardMs:3000,idleMs:1000});
 await new Promise(resolve=>setTimeout(resolve,650));
 guard.activity();
 await new Promise(resolve=>setTimeout(resolve,650));
 assert.equal(guard.signal.aborted,false,'received data must reset the idle deadline');
 guard.cleanup();
 await new Promise(resolve=>setTimeout(resolve,450));
 assert.equal(guard.signal.aborted,false,'finished request must not time out later');
});
test('whole-page continuation starts a fresh merged run only for the same page and is bounded',async()=>{
 const win={};win.top=win;
 let queued,clock=0;
 const messages=[],statuses=[];
 const page='https://example.test/article';
 const ctx={window:win,location:{href:page},currentTask:null,
  pageIdentity:()=>page,status:message=>statuses.push(message),
  addDiagnostic:()=>{},clearTimeout:()=>{},
  setTimeout:fn=>{queued=fn;return ++clock;},
  send:async message=>{messages.push(message);return {ok:true};},
  uiSettings:{progressiveAnnotation:true}};
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('  let createParagraphPlan;'),
  source.indexOf('  function startAnnotation(')),ctx);
 const task={wholePage:true,mergedGroup:true,mergedHost:true,manualPanelShown:false,
  startPageUrl:page,modes:{hanja:true,loanword:true}};
 ctx.task=task;
 for(let i=0;i<3;i++){
  assert.equal(vm.runInContext('scheduleAutoResume(task,"worker stopped")',ctx),true);
  await queued();
 }
 assert.equal(messages.length,3);
 assert.ok(messages.every(m=>m.type==='KRA_START_PAGE_FROM_TOOLBAR'&&m.autoResume===true&&!m.forceRegenerate));
 assert.equal(vm.runInContext('scheduleAutoResume(task,"again")',ctx),false);
 assert.match(statuses.at(-1),/已达/);
 ctx.location.href='https://example.test/elsewhere';
 assert.equal(vm.runInContext('scheduleAutoResume(task,"after navigation")',ctx),false);
});
test('auto-resume is disabled for child frames, manual answers and selections',()=>{
 const win={};win.top=win;
 const ctx={window:win,location:{href:'https://example.test/article'},
  pageIdentity:()=>'',currentTask:null,clearTimeout(){},setTimeout(){},
  status(){},addDiagnostic(){},send(){},uiSettings:{}};
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('  let createParagraphPlan;'),
  source.indexOf('  function startAnnotation(')),ctx);
 const task={wholePage:true,mergedGroup:true,mergedHost:false,
  startPageUrl:ctx.location.href};
 ctx.task=task;
 assert.equal(vm.runInContext('scheduleAutoResume(task,"child")',ctx),false);
 task.mergedHost=true;task.manualRequest='draft';
 assert.equal(vm.runInContext('scheduleAutoResume(task,"manual")',ctx),false);
 task.manualRequest=null;task.wholePage=false;
 assert.equal(vm.runInContext('scheduleAutoResume(task,"selection")',ctx),false);
});

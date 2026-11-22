import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAnalysis} from '../local-engine.js';
import {runSentencePipeline} from '../annotation-pipeline.js';
import {summarizeExperimentalHanjaAnswers} from '../experimental-hanja-diagnostics.js';
import {createManualReviewSession} from '../manual-review.js';

const keep=s=>({choice_id:null,type:'keep',replacement:s,entry_id:null,definitions:[]});
const target=(id,surface,flags={})=>({target_id:id,start:0,end:surface.length,
 surface,context:surface,options:[keep(surface)],...flags});
const audit=(target,choice,config={})=>summarizeExperimentalHanjaAnswers(
 [target],{results:[{t:target.target_id,c:choice}]},
 {experimentalHanja:true,hanjaReadingCheck:true,...config});

test('local analysis keeps experimental Hanja-only target without dictionary candidate',()=>{
 const text='원잠';const flags={experimental_hanja_audit:true};
 const data={engine_version:'audit',dictionary_fingerprint:'dict',annotations:[],
  targets:[{target_id:'t0',start:0,end:2,surface:text,options:[keep(text)],...flags}],
  stats:{local_determined:0,pending:1}};
 const out=validateAnalysis(text,data);
 assert.equal(out.targets.length,1);
 assert.equal(out.targets[0].experimental_hanja_audit,true);
 assert.equal(out.stats.experimental_hanja_audit_generated,1);
 assert.equal(out.stats.experimental_hanja_audit_retained,1);
 assert.equal(out.stats.experimental_hanja_audit_filtered,0);
 assert.equal(out.stats.experimental_loanword_audit_generated,0);
 assert.equal(out.stats.pending,1);
 assert.equal(data.targets.length,1,'source analysis must not be mutated');
});

test('KEEP-only native target remains filtered, while Latin audit preserves its existing behavior',()=>{
 const text='원잠 게임';
 const base={engine_version:'audit',dictionary_fingerprint:'dict',annotations:[],
  stats:{pending:2}};
 const original=[
  {target_id:'a',start:0,end:2,surface:'원잠',options:[keep('원잠')]},
  {target_id:'b',start:3,end:5,surface:'게임',experimental_loanword_audit:true,options:[keep('게임')]}
 ];
 const result=validateAnalysis(text,{...base,targets:original});
 assert.deepEqual(result.targets.map(t=>t.target_id),['b']);
 assert.equal(result.stats.experimental_loanword_audit_generated,1);
 assert.equal(result.stats.experimental_loanword_audit_retained,1);
 assert.equal(result.stats.experimental_hanja_audit_retained,0);
 assert.equal(result.stats.structural_rejections,1);
});

test('diagnostics distinguish accepted Hanja from phonological conflict, geometric rejection and names',()=>{
 const word=target('t0','한국');
 assert.deepEqual(audit(word,'韓國').proposed,1);
 assert.deepEqual([audit(word,'韓國').accepted,audit(word,'韓國').rejected],[1,0]);
 const sound=audit(word,'美國');
 assert.equal(sound.rejected,1);
 assert.equal(sound.reasons.hanja_reading_conflict,1);
 assert.deepEqual(sound.samples.map(x=>x.reason),['hanja_reading_conflict']);
 const length=audit(target('t1','원잠'),'原子潛水艇');
 assert.equal(length.rejected,1);
 assert.equal(length.reasons.hanja_alignment_or_boundary,1);
 const name=audit(target('t2','한국',{suspected_person_name:true}),'韓國');
 assert.equal(name.rejected,1);
 assert.equal(name.reasons.person_name_hanja_blocked,1);
 assert.equal(audit(word,'美國',{hanjaReadingCheck:false}).accepted,1,
  'diagnostics must reflect the configured reading check, without modifying it');
});

test('conflicting answer with Hanja is counted as conflict before considering dictionary validity',()=>{
 const t={...target('t0','한국'),options:[keep('한국'),
  {choice_id:'c0',type:'hanja',replacement:'韓國',entry_id:'dict',definitions:['country']}]};
 for(const choices of [['c0','韓國'],['c999','韓國'],['韓國',null]]){
  const report=summarizeExperimentalHanjaAnswers([t],
   {results:choices.map(c=>({t:'t0',c}))},{experimentalHanja:true,hanjaReadingCheck:true});
  assert.equal(report.proposed,1);
  assert.equal(report.accepted,0);
  assert.equal(report.reasons.conflicting_well_formed_answers,1);
 }
 const same=summarizeExperimentalHanjaAnswers([t],
  {results:Array.from({length:30},()=>({t:'t0',c:'韓國'}))},
  {experimentalHanja:true,hanjaReadingCheck:true});
 assert.equal(same.proposed,1);
 assert.equal(same.accepted,1);
});

test('malformed rows and dictionary-backed personal Hanja are excluded from direct-origin counts',()=>{
 const person=target('t0','한국',{dictionary_person_name:true,verified_person_hanja:['韓國']});
 const report=summarizeExperimentalHanjaAnswers([person],{results:[
  {t:'t0',c:'韓國'},{t:'t0',c:'韓國',extra:true},
  {t:'t0',c:'美國'},{t:'unknown',c:'韓國'}
 ]},{experimentalHanja:true,hanjaReadingCheck:true});
 assert.equal(report.proposed,1);
 assert.equal(report.reasons.conflicting_well_formed_answers,1);
 assert.equal(report.samples.length,1);
});

test('manual response preserves pre-fallback Hanja reading rejection diagnostics',async()=>{
 const reports=[],events=[];
 const session=createManualReviewSession({operationId:'manual-audit',post:e=>events.push(e)});
 const t=target('origin','한국',{experimental_hanja_audit:true});
 const pending=session.request({manualPrepared:{requestId:'batch',text:'prompt',bindings:[],targetCount:1},
  experimentalHanja:true,hanjaReadingCheck:true,
  discardInvalidReviewResults:true,retryInvalidDictionaryChoices:false,
  onExperimentalHanjaAnswers:row=>reports.push(row)},[t]);
 assert.equal(session.submit({operationId:'manual-audit',requestId:'batch',text:JSON.stringify({
  batch_id:'batch',results:[{t:'t0',c:'美國'}]})}),true);
 const answer=await pending;
 assert.deepEqual(answer.results,[{t:'origin',c:null}]);
 assert.equal(reports.length,1);
 assert.equal(reports[0].reasons.hanja_reading_conflict,1);
 assert.ok(events.some(e=>e.type==='MANUAL_REVIEW_ACCEPTED'));
});

test('pipeline keeps a generated Hanja audit target and reports model submission and acceptance',async()=>{
 const text='원잠',t=target('t0',text,{experimental_hanja_audit:true});
 const identity={engine_version:'audit-fixture',dictionary_fingerprint:'dictionary'};
 const events=[],submitted=[];
 const stats=await runSentencePipeline({
  operationId:'audit',sentences:[{id:'s0',text}],
  modes:{hanja:true,loanword:false},experimentalHanjaAudit:true
 },e=>events.push(e),{
  enabled:true,status:async()=>identity,cache:new Map(),persist:async()=>{},
  analyze:async()=>({...identity,annotations:[],targets:[t],
   stats:{pending:1,experimental_hanja_audit_generated:1,experimental_hanja_audit_retained:1,
    experimental_hanja_audit_filtered:0}}),
  modelConfig:async()=>({model:'test',endpoint:'local://test',experimentalHanja:true,
   hanjaReadingCheck:true,reviewPosFilter:false,request:async(_config,targets)=>{
    submitted.push(targets);
    return {results:targets.map(x=>({t:x.target_id,c:'原潛'}))};
   }})
 });
 assert.equal(submitted.length,1);
 assert.equal(submitted[0][0].experimental_hanja_audit,true);
 assert.equal(stats.experimental_hanja_audit_generated,1);
 assert.equal(stats.experimental_hanja_audit_retained,1);
 assert.equal(stats.experimental_hanja_audit_reviewable,1);
 assert.equal(stats.experimental_hanja_audit_sent,1);
 assert.equal(stats.experimental_hanja_audit_request_occurrences,1);
 assert.equal(stats.model_direct_hanja_proposed,1);
 assert.equal(stats.model_direct_hanja_accepted,1);
 assert.equal(stats.model_direct_hanja_rejected,0);
 assert.ok(events.some(e=>e.type==='RESULTS'&&e.source==='model'&&
  e.results.some(r=>r.annotations.some(a=>a.replacement==='原潛'))));
 assert.ok(events.some(e=>e.type==='DIAGNOSTIC'&&e.diagnostic.stage==='experimental-hanja-audit'&&
  e.diagnostic.message.includes('进入模型请求 1')));
});

test('diagnostic does not attach the original paragraph and bounds samples',()=>{
 const t=target('t0','한국');
 const report=summarizeExperimentalHanjaAnswers([t],{
  results:Array.from({length:70},(_,i)=>({t:'t0',c:'漢'.repeat(i+1)}))
 },{experimentalHanja:true,hanjaReadingCheck:true});
 assert.ok(report.samples.length<=12);
 assert.ok(report.samples.every(x=>!Object.hasOwn(x,'context')));
 assert.equal(report.proposed,70);
 assert.equal(report.accepted,0);
 assert.equal(report.rejected,70);
});

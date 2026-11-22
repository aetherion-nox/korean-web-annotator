import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ENGINE_SWITCH_DEFAULTS,engineSwitchValues} from '../engine-defaults.js';
import {validateChoices,validateExperimentalChoices,reviewTargets} from '../choice-review.js';
import {createManualReviewSession} from '../manual-review.js';
import {parsePartialReviewJson} from '../partial-review-json.js';
import {choicePreviewParser} from '../model-stream.js';
import {normalizeManualAnswer} from '../manual-answer-format.js';

const keep=s=>({choice_id:null,type:'keep',replacement:s,entry_id:null,definitions:[]});
const sense=(id,value)=>({choice_id:id,type:'hanja',replacement:value,entry_id:id,definitions:['test']});
const t=(id,surface,options=[sense('c0','可')])=>({target_id:id,start:0,end:surface.length,surface,context:surface,options:[keep(surface),...options]});
const discard={discardInvalidReviewResults:true,retryInvalidDictionaryChoices:false,reviewPosFilter:false};

test('discard mode defaults off, retry defaults on, and both saved on resolve to discard only',()=>{
 assert.equal(ENGINE_SWITCH_DEFAULTS.discardInvalidReviewResults,false);
 assert.equal(ENGINE_SWITCH_DEFAULTS.retryInvalidDictionaryChoices,true);
 assert.deepEqual([engineSwitchValues({}).retryInvalidDictionaryChoices,engineSwitchValues({}).discardInvalidReviewResults],[true,false]);
 const both=engineSwitchValues({retryInvalidDictionaryChoices:true,discardInvalidReviewResults:true});
 assert.equal(both.discardInvalidReviewResults,true);
 assert.equal(both.retryInvalidDictionaryChoices,false);
 assert.equal(engineSwitchValues({retryInvalidDictionaryChoices:false,discardInvalidReviewResults:false}).retryInvalidDictionaryChoices,true);
 const html=readFileSync(new URL('../options.html',import.meta.url),'utf8');
 const engine=readFileSync(new URL('../engine-settings.js',import.meta.url),'utf8');
 assert.match(html,/id="discardInvalidReviewResults"/);
 assert.match(engine,/changed==='discardInvalidReviewResults'/);
 assert.match(engine,/changed==='retryInvalidDictionaryChoices'/);
 assert.match(engine,/retryInvalidDictionaryChoices'.*discardInvalidReviewResults'/);
});

test('quoted null, NULL and mixed-case Null remain KEEP and are not retried',()=>{
 const targets=[t('t0','가'),t('t1','나'),t('t2','다'),t('t3','라')];
 const valid=validateChoices(targets,{results:[
  {t:'t0',c:null},{t:'t1',c:'null'},{t:'t2',c:'NULL'},{t:'t3',c:'Null'}]},discard);
 assert.equal(valid.accepted.length,4);
 assert.equal(valid.unresolved.length,0);
 assert.ok(valid.accepted.every(row=>row.option.type==='keep'));
 const ex=validateExperimentalChoices(targets,{results:[{t:'t0',c:'NULL'},{t:'t1',c:'null'}]},
  {...discard,experimentalHanja:true,experimentalLoanword:true});
 assert.equal(ex.accepted.length,4);
 assert.equal(ex.unresolved.length,0);
 assert.ok(ex.accepted.every(a=>a.option.type==='keep'));
 assert.deepEqual(ex.accepted.filter(a=>a.implicitNull).map(a=>a.target.target_id),['t2','t3']);
});

test('invalid keys, extra fields, unknown targets, duplicates and omissions only invalidate their own rows',()=>{
 const targets=[t('t0','가'),t('t1','나'),t('t2','다'),t('t3','라'),t('t4','마'),t('t5','바'),t('t6','사')];
 const res=validateChoices(targets,{results:[
  {t:'t0',c:'c0'}, {t:'t1',c:'c999'}, {t:'t2',c:'anything'},
  {t:'t3',c:'c0'}, {t:'t3',c:'c0'},
  {t:'t4',c:'c0',extra:1}, {t:'t5',c:'null'},
  {t:'foreign',c:'c0'}
 ]},discard);
 assert.deepEqual(res.accepted.map(a=>a.target.target_id),['t0','t1','t2','t3','t4','t5','t6']);
 assert.equal(res.unresolved.length,0);
 assert.deepEqual(res.accepted.filter(a=>a.discardedInvalid).map(a=>a.target.target_id),['t1','t2']);
 assert.equal(res.accepted.find(a=>a.target.target_id==='t3').option.choice_id,'c0');
 assert.deepEqual(res.accepted.filter(a=>a.implicitNull).map(a=>a.target.target_id),['t4','t6']);
 assert.equal(res.accepted.at(-1).implicitNull,true);
 assert.equal(res.invalidDictionaryChoiceIds.length,0);
});

test('discard-mode API never makes a second choice request after incomplete or invalid model response',async()=>{
 const targets=[t('t0','가'),t('t1','나'),t('t2','다'),t('t3','라')];
 const calls=[],applied=[];
 const res=await reviewTargets({
  ...discard,enableModelReview:true,model:'fixture',provider:'custom',
  context:'가나다라',smartSegmentation:true,experimentalHanja:true,experimentalLoanword:true,
  request:async(config,wire)=>{
   calls.push(wire.map(x=>x.target_id));
   return {results:[{t:'t0',c:'c0'},{t:'t1',c:'c999'},{t:'t2',c:'NULL'}]};
  },
  onAccepted:rows=>applied.push(...rows.map(row=>row.target.target_id))
 },targets);
 assert.deepEqual(calls,[['t0','t1','t2','t3']]);
 assert.deepEqual(applied,['t0','t1','t2','t3']);
 assert.equal(res.unresolved.length,0);
 assert.equal(res.accepted.find(row=>row.target.target_id==='t1').discardedInvalid,true);
 assert.equal(res.accepted.find(row=>row.target.target_id==='t3').implicitNull,true);
 assert.equal(res.errors.length,0);
});

test('malformed JSON can recover safe rows, but unparseable rows are not invented',()=>{
 const malformed='{"batch_id":"b","results":[{"t":"t0","c":"c0"},{"t":"t":"t1","c":"c0"},{"t":"t2","c":"NULL"}]}';
 const recovered=parsePartialReviewJson(malformed);
 assert.equal(recovered.recovered,true);
 const res=validateChoices([t('t0','가'),t('t1','나'),t('t2','다')],recovered.response,discard);
 assert.deepEqual(res.accepted.map(a=>a.target.target_id),['t0','t1','t2']);
 assert.equal(res.unresolved.length,0);
 assert.equal(res.accepted.find(a=>a.target.target_id==='t1').implicitNull,true);
});

test('manual discard mode finishes with valid subset and produces no correction prompt',async()=>{
 const events=[];
 const session=createManualReviewSession({operationId:'op',post:e=>events.push(e)});
 const target0=t('original0','가'),target1=t('original1','나'),target2=t('original2','다');
 const original={format:'shared-pools-v4',batch_id:'b',sentences:[{sentence_id:'s0',text:'가나다'}],
  candidates:[{candidate_id:'p0',type:'hanja',replacement:'可'}],
  targets:[{target_id:'t0',sentence_id:'s0',options:{c0:'p0'}},
   {target_id:'t1',sentence_id:'s0',options:{c0:'p0'}},{target_id:'t2',sentence_id:'s0',options:{c0:'p0'}}]};
 const pending=session.request({
  ...discard,manualPrepared:{requestId:'b',text:'Instructions\\n'+JSON.stringify(original),bindings:[],targetCount:3}
 },[target0,target1,target2]);
 const ok=session.submit({operationId:'op',requestId:'b',text:JSON.stringify({batch_id:'b',results:[
  {t:'t0',c:'c0'},{t:'t1',c:'c999'}
 ]})});
 assert.equal(ok,true);
 const accepted=events.find(e=>e.type==='MANUAL_REVIEW_ACCEPTED');
 assert.equal(accepted.discardedCount,1);
 assert.equal(accepted.implicitNullCount,1);
 assert.deepEqual(accepted.acceptedRows,[{t:'t0',c:'c0'},{t:'t1',c:null},{t:'t2',c:null}]);
 assert.equal(events.filter(e=>e.type==='MANUAL_REVIEW_ERROR').length,0);
 assert.deepEqual((await pending).results,[{t:'original0',c:'c0'},{t:'original1',c:null},{t:'original2',c:null}]);
});

test('manual mode discards completely unparsable reply without follow-up, but rejects mismatched batch IDs',async()=>{
 const events=[];
 const session=createManualReviewSession({operationId:'op',post:e=>events.push(e)});
 const target0=t('original0','가');
 const pending=session.request({...discard,manualPrepared:{requestId:'b',text:'dummy',bindings:[],targetCount:1}},[target0]);
 assert.equal(session.submit({operationId:'op',requestId:'b',text:'{"batch_id":"foreign","results":[{"t":"t":"t0","c":null}'}),false);
 assert.equal(session.submit({operationId:'op',requestId:'b',text:'{"batch_id":"b","results":[{"t":"t":"t0","c":null}'}),true);
 assert.deepEqual((await pending).results,[{t:'original0',c:null}]);
 assert.equal(events.filter(e=>e.type==='MANUAL_REVIEW_ACCEPTED').length,1);
});

test('discard mode preserves Korean for malformed nonconversion field without inventing an origin',()=>{
 const malformed={batch_id:'b',results:[{t:'t0',n2:'c0'}]};
 const previous=normalizeManualAnswer(malformed,{requestId:'b',knownTargetIds:new Set(['t0'])});
 assert.deepEqual(previous.results,malformed.results);
 const discardResponse=normalizeManualAnswer(malformed,{requestId:'b',knownTargetIds:new Set(['t0']),discardInvalidReviewResults:true});
 assert.deepEqual(discardResponse.results,malformed.results);
 const checked=validateChoices([t('t0','가')],discardResponse,discard);
 assert.equal(checked.accepted.length,1);
 assert.equal(checked.unresolved.length,0);
 assert.equal(checked.accepted[0].option.type,'keep');
 assert.equal(checked.accepted[0].implicitNull,true);
});

test('manual discard filters foreign rows from a batchless answer but preserves known valid rows',async()=>{
 const events=[];
 const session=createManualReviewSession({operationId:'op',post:e=>events.push(e)});
 const pending=session.request({...discard,manualPrepared:{requestId:'batch',text:'dummy',bindings:[],targetCount:2}},
  [t('original0','가'),t('original1','나')]);
 assert.equal(session.submit({operationId:'op',requestId:'batch',text:JSON.stringify({results:[
  {t:'t0',c:'c0'},{t:'foreign',c:'c0'},{t:'t1',n2:'c0'}
 ]})}),true);
 const event=events.find(e=>e.type==='MANUAL_REVIEW_ACCEPTED');
 assert.equal(event.discardedCount,1);
 assert.deepEqual((await pending).results,[{t:'original0',c:'c0'},{t:'original1',c:null}]);
});

test('discard mode retains retries for network errors rather than interpreting them as invalid model output',async()=>{
 let calls=0;
 const result=await reviewTargets({
  ...discard,enableModelReview:true,smartSegmentation:false,model:'fixture',
  request:async()=>{calls++;if(calls===1)throw new TypeError('Network unavailable');return {results:[{t:'t0',c:'c0'}]};}
 },[t('t0','가')]);
 assert.equal(calls,2);
 assert.equal(result.accepted.length,1);
 assert.equal(result.unresolved.length,0);
});

test('streaming preview does not temporarily accept invalid choices as KEEP in discard mode',()=>{
 const targets=[t('t0','가'),t('t1','나'),t('t2','다')];
 let latest=[];
 const preview=choicePreviewParser(targets,rows=>latest=rows,()=>null,discard);
 preview('{"results":[{"t":"t0","c":"c0"},{"t":"t1","c":"c999"},{"t":"t2","c":"NULL"}]}');
 assert.deepEqual(latest.map(a=>a.target.target_id),['t0','t2']);
 assert.deepEqual(latest.map(a=>a.option.type),['hanja','keep']);
});

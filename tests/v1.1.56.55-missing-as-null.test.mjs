import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePartialReviewJson} from '../partial-review-json.js';
import {validateChoices,validateExperimentalChoices,reviewTargets} from '../choice-review.js';
import {createManualReviewSession} from '../manual-review.js';
const keep=s=>({choice_id:null,type:'keep',replacement:s,entry_id:null,definitions:[]});
const hanja=(id,writing)=>({choice_id:id,type:'hanja',replacement:writing,entry_id:id,definitions:['test']});
const target=(id,surface)=>({target_id:id,start:0,end:surface.length,surface,context:surface,
 options:[keep(surface),hanja('c0','可')]});
const discard={discardInvalidReviewResults:true,retryInvalidDictionaryChoices:false,reviewPosFilter:false};
const targets=[target('t867','가'),target('t868','나'),target('t869','다')];
const malformed='{"batch_id":"b","results":[{"t":"t867","c":"c0"},{"t":"t":"t868","c":null},{"t":"t869","c":"c0"}]}';

test('malformed middle JSON row is discarded; absent t868 becomes implicit JSON null',()=>{
 const parsed=parsePartialReviewJson(malformed);
 assert.equal(parsed.recovered,true);
 assert.deepEqual(parsed.response.results,[{t:'t867',c:'c0'},{t:'t869',c:'c0'}]);
 const result=validateChoices(targets,parsed.response,discard);
 assert.deepEqual(result.accepted.map(r=>r.target.target_id),['t867','t868','t869']);
 assert.deepEqual(result.accepted.map(r=>r.option.type),['hanja','keep','hanja']);
 assert.equal(result.accepted[1].implicitNull,true);
 assert.equal(result.unresolved.length,0);
});

test('different malformed JSON rows do not manufacture values, missing are kept',()=>{
 const cases=[
  '{"results":[{"t":"t867","c":"c0"},{"t":"t868","c":},{"t":"t869","c":"c0"}]}',
  '{"results":[{"t":"t867","c":"c0"},{"t":"t868",,"c":"c0"},{"t":"t869","c":"c0"}]}',
  '{"results":[{"t":"t867","c":"c0"},{"t":"t868","c":true,},{"t":"t869","c":"c0"}]}'
 ];
 for(const source of cases){
  const parsed=parsePartialReviewJson(source);
  const checked=validateChoices(targets,parsed.response,discard);
  assert.equal(checked.accepted.length,3);
  assert.deepEqual(checked.accepted.map(r=>r.option.type),['hanja','keep','hanja']);
  assert.equal(checked.accepted[1].implicitNull,true);
 }
});

test('missing and blank c become implicit null; duplicates and invalid IDs become discarded KEEP',()=>{
 const t0=target('t0','가'),t1=target('t1','나'),t2=target('t2','다'),t3=target('t3','라'),t4=target('t4','마'),t5=target('t5','바');
 const result=validateChoices([t0,t1,t2,t3,t4,t5],{results:[
  {t:'t0',c:'c0'},{t:'t1'},{t:'t2',c:''},{t:'t3',c:' '},
  {t:'t4',c:'c999'},{t:'t4',c:'c999'}
 ]},discard);
 assert.deepEqual(result.accepted.map(r=>r.target.target_id),['t0','t1','t2','t3','t4','t5']);
 assert.deepEqual(result.accepted.filter(r=>r.implicitNull).map(r=>r.target.target_id),['t1','t2','t3','t5']);
 assert.equal(result.accepted.find(r=>r.target.target_id==='t4').discardedInvalid,true);
 assert.equal(result.unresolved.length,0);
});

test('experimental validator also converts missing targets to implicit null',()=>{
 const result=validateExperimentalChoices(targets,{results:[{t:'t867',c:'c0'}]},
  {...discard,experimentalHanja:true,experimentalLoanword:true});
 assert.deepEqual(result.accepted.map(r=>r.target.target_id),['t867','t868','t869']);
 assert.deepEqual(result.accepted.filter(r=>r.implicitNull).map(r=>r.target.target_id),['t868','t869']);
});

test('non-discard mode preserves prior behavior: omitted target remains unresolved',()=>{
 const result=validateChoices(targets,{results:[{t:'t867',c:'c0'},{t:'t869',c:'c0'}]},
  {retryInvalidDictionaryChoices:true,discardInvalidReviewResults:false,reviewPosFilter:false});
 assert.deepEqual(result.unresolved.map(r=>r.target_id),['t868']);
});

test('API mode accepts malformed answer and treats t868 as null, with only one request',async()=>{
 const calls=[],committed=[];
 const response=parsePartialReviewJson(malformed).response;
 const result=await reviewTargets({
  ...discard,enableModelReview:true,smartSegmentation:true,
  experimentalHanja:true,experimentalLoanword:true,context:'가나다',model:'stub',
  request:async(config,wire)=>{calls.push(wire.map(t=>t.target_id));return response;},
  onAccepted:rows=>committed.push(...rows)
 },targets);
 assert.equal(calls.length,1);
 assert.deepEqual(committed.map(x=>x.option.type),['hanja','keep','hanja']);
 assert.equal(result.unresolved.length,0);
});

test('manual mode accepts malformed answer and includes explicit null for t868',async()=>{
 const events=[];
 const session=createManualReviewSession({operationId:'op',post:ev=>events.push(ev)});
 const pending=session.request({...discard,manualPrepared:{
  requestId:'b',text:'demo',bindings:[],targetCount:3
 }},[target('original867','가'),target('original868','나'),target('original869','다')]);
 assert.equal(session.submit({operationId:'op',requestId:'b',text:malformed.replaceAll('t867','t0').replaceAll('t868','t1').replaceAll('t869','t2')}),true);
 const accepted=events.find(e=>e.type==='MANUAL_REVIEW_ACCEPTED');
 assert.ok(accepted);
 assert.equal(accepted.implicitNullCount,1);
 assert.equal(accepted.discardedCount,0);
 assert.deepEqual((await pending).results,[
  {t:'original867',c:'c0'},{t:'original869',c:'c0'},{t:'original868',c:null}
 ]);
});

test('shuffled t order is accepted by identifier and omitted middle target becomes KEEP',()=>{
 const reversed={results:[{t:'t869',c:'c0'},{t:'t867',c:'c0'}]};
 const assessed=validateChoices(targets,reversed,discard);
 assert.deepEqual(assessed.accepted.map(r=>r.target.target_id),['t867','t868','t869']);
 assert.deepEqual(assessed.accepted.map(r=>r.option.type),['hanja','keep','hanja']);
 assert.deepEqual(assessed.accepted.filter(r=>r.implicitNull).map(r=>r.target.target_id),['t868']);
});

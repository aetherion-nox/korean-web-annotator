import test from 'node:test';
import assert from 'node:assert/strict';
import {validateChoices,validateExperimentalChoices,reviewTargets} from '../choice-review.js';
import {createManualReviewSession} from '../manual-review.js';
import {parsePartialReviewJson} from '../partial-review-json.js';
import {choicePreviewParser} from '../model-stream.js';

const keep=s=>({choice_id:null,type:'keep',replacement:s,entry_id:null,definitions:[]});
const choice=(id,r)=>({choice_id:id,type:'hanja',replacement:r,entry_id:id,definitions:['test']});
const target=(id,s)=>({target_id:id,start:0,end:s.length,surface:s,context:s,
 options:[keep(s),choice('c0','可'),choice('c1','加')]});
const config={discardInvalidReviewResults:true,retryInvalidDictionaryChoices:false,reviewPosFilter:false};

test('one well-formed t/c survives any number of malformed duplicates, in any order',()=>{
 const targets=[target('t0','가'),target('t1','나'),target('t2','다')];
 const malformed=[
  {t:'t0',c:17},{t:'t0',c:'c1',extra:1},{t:'t0'},
  {t:'t0',c:''},{t:'t0',c:' '},{t:'t0',n2:'c1'},
  {t:'t0',c:['c1']},null,2,{t:'foreign',c:'c1'}
 ];
 for(const placement of ['before','after']){
  const rows=placement==='before'?[...malformed,{t:'t0',c:'c0'}]:
    [{t:'t0',c:'c0'},...malformed];
  rows.push({t:'t1',c:'c1'});
  const v=validateChoices(targets,{results:rows},config);
  assert.deepEqual(v.accepted.map(a=>a.option.type),['hanja','hanja','keep']);
  assert.equal(v.accepted.find(a=>a.target.target_id==='t0').option.choice_id,'c0');
  assert.equal(v.accepted.find(a=>a.target.target_id==='t0').discardedInvalid,undefined);
  assert.equal(v.unresolved.length,0);
 }
});

test('two or more well-formed t/c answers invalidate target even with malformed siblings',()=>{
 const targets=[target('t0','가'),target('t1','나')];
 const rows=[{t:'t0',c:'c0'},{t:'t0',c:'c1',extra:'bad'},
  {t:'t1',c:'c1'},{t:'t0',c:null},{t:'t0',c:42},{t:'t0',c:'  '}];
 const discarded=validateChoices(targets,{results:rows},config);
 assert.deepEqual(discarded.accepted.map(a=>a.option.type),['keep','hanja']);
 assert.equal(discarded.accepted[0].discardedInvalid,true);
 assert.deepEqual(discarded.unresolved,[]);
 const correction=validateChoices(targets,{results:rows},
  {...config,discardInvalidReviewResults:false,retryInvalidDictionaryChoices:true});
 assert.deepEqual(correction.unresolved.map(t=>t.target_id),['t0']);
 assert.deepEqual(correction.accepted.map(a=>a.target.target_id),['t1']);
});

test('experimental review uses the same structural filtering before duplicate counting',()=>{
 const v=validateExperimentalChoices([target('t0','가'),target('t1','나')],{results:[
  {t:'t0',c:'c0',extra:1},{t:'t1',c:null},{t:'t0',c:'c0'},
  {t:'t0',n1:'c1'}, {t:'t0',c:99}
 ]},{...config,experimentalHanja:true,experimentalLoanword:true});
 assert.deepEqual(v.accepted.map(a=>a.option.type),['hanja','keep']);
 assert.equal(v.unresolved.length,0);
});

test('syntax-broken JSON recovery retains the unique valid row despite malformed duplicate',()=>{
 const raw='{"batch_id":"b","results":[{"t":"t0","c":"c0"},'+
  '{"t":"t0","c":false},{"t":"t":"t0","c":"c1"},'+
  '{"t":"t1","c":"c1"}]}';
 const parsed=parsePartialReviewJson(raw);
 assert.equal(parsed.recovered,true);
 assert.deepEqual(parsed.response.results,[{t:'t0',c:'c0'},{t:'t1',c:'c1'}]);
 const v=validateChoices([target('t0','가'),target('t1','나')],parsed.response,config);
 assert.deepEqual(v.accepted.map(a=>a.option.type),['hanja','hanja']);
});

test('API mode makes one request and keeps unique valid row amid malformed duplicates',async()=>{
 const targets=[target('t0','가'),target('t1','나')];
 let calls=0;
 const r=await reviewTargets({
  ...config,enableModelReview:true,smartSegmentation:true,context:'가나',model:'fixture',
  request:async()=>{calls++;return {results:[
   {t:'t0',c:'c0',extra:true},{t:'t1',c:null},
   {t:'t0',c:'c0'},{t:'t0',c:42}
  ]};}
 },targets);
 assert.equal(calls,1);
 assert.deepEqual(r.accepted.map(a=>a.option.type),['hanja','keep']);
 assert.equal(r.unresolved.length,0);
});

test('manual mode accepts one valid row among malformed copies without retry',async()=>{
 const events=[];
 const session=createManualReviewSession({operationId:'op',post:e=>events.push(e)});
 const pending=session.request({...config,manualPrepared:{
  requestId:'batch',text:'prompt',bindings:[],targetCount:2
 }},[target('original0','가'),target('original1','나')]);
 const rows=[{t:'t1',c:'c1'},{t:'t0',n2:'c1'},{t:'t0',c:'c0'},
  {t:'t0',c:123},{t:'t0',c:'c1',extra:1},{t:'t0',c:''}];
 assert.equal(session.submit({operationId:'op',requestId:'batch',
  text:JSON.stringify({batch_id:'batch',results:rows})}),true);
 const event=events.find(e=>e.type==='MANUAL_REVIEW_ACCEPTED');
 assert.ok(event);
 assert.equal(event.discardedCount,0);
 assert.deepEqual((await pending).results,[{t:'original1',c:'c1'},{t:'original0',c:'c0'}]);
});

test('manual mode rejects multiple valid rows despite any malformed siblings',async()=>{
 const events=[];
 const session=createManualReviewSession({operationId:'op',post:e=>events.push(e)});
 const pending=session.request({...config,manualPrepared:{
  requestId:'batch',text:'prompt',bindings:[],targetCount:1
 }},[target('original0','가')]);
 const rows=[{t:'t0',c:123},{t:'t0',c:'c0'},{t:'t0',extra:1},
  {t:'t0',c:'c1'}];
 assert.equal(session.submit({operationId:'op',requestId:'batch',
  text:JSON.stringify({batch_id:'batch',results:rows})}),true);
 assert.equal(events.find(e=>e.type==='MANUAL_REVIEW_ACCEPTED').discardedCount,1);
 assert.deepEqual((await pending).results,[{t:'original0',c:null}]);
});

test('streaming preview ignores malformed rows but excludes multiple valid rows',()=>{
 const targets=[target('t0','가'),target('t1','나')];
 const snapshots=[];
 const accept=choicePreviewParser(targets,rows=>snapshots.push(rows.map(r=>r.target.target_id+':'+r.option.choice_id)),()=>null,config);
 accept('{"results":[{"t":"t0","c":"c0"},{"t":"t0","c":');
 accept('42},{"t":"t1","c":"c1"}]}');
 assert.deepEqual(snapshots.at(-1),['t0:c0','t1:c1']);
 const previews=[];
 const dup=choicePreviewParser(targets,rows=>previews.push(rows.map(r=>r.target.target_id)),()=>null,config);
 dup('{"results":[{"t":"t0","c":"c0"},{"t":"t0","c":"c1"},{"t":"t1","c":"c1"}]}');
 assert.deepEqual(previews.at(-1),['t1']);
});

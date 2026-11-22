import test from 'node:test';
import assert from 'node:assert/strict';
import {validateChoices,validateExperimentalChoices,reviewTargets} from '../choice-review.js';
import {createManualReviewSession} from '../manual-review.js';

const keep=s=>({choice_id:null,type:'keep',replacement:s,entry_id:null,definitions:[]});
const hanja=(id,v)=>({choice_id:id,type:'hanja',replacement:v,entry_id:id,definitions:['test']});
const target=(id,s)=>({target_id:id,start:0,end:s.length,surface:s,context:s,
 options:[keep(s),hanja('c0','可'),hanja('c1','加')]});
const discard={discardInvalidReviewResults:true,retryInvalidDictionaryChoices:false,reviewPosFilter:false};

test('different valid c duplicates invalidate target but exact identical copies collapse to one',()=>{
 const targets=[target('t0','가'),target('t1','나'),target('t2','다'),target('t3','라')];
 const answer={results:[
  {t:'t1',c:'c0'},{t:'t0',c:'c0'},{t:'t3',c:'c0'},
  {t:'t0',c:'c0'},{t:'t3',c:null},
  {t:'t2',c:'c1'}
 ]};
 const result=validateChoices(targets,answer,discard);
 assert.equal(result.unresolved.length,0);
 assert.deepEqual(result.accepted.map(a=>a.target.target_id),['t0','t1','t2','t3']);
 assert.deepEqual(result.accepted.map(a=>a.option.type),['hanja','hanja','hanja','keep']);
 assert.deepEqual(result.accepted.filter(a=>a.discardedInvalid).map(a=>a.target.target_id),['t3']);
 assert.deepEqual(result.invalidDictionaryChoiceIds,[]);
});

test('one well-formed answer survives malformed duplicates',()=>{
 const targets=[target('t0','가'),target('t1','나'),target('t2','다')];
 const result=validateChoices(targets,{results:[
  {t:'t2',c:'c1'},{t:'t0',c:'c0'},
  {t:'t0',c:'c0',extra:'invalid'},{t:'t1',c:'c0'}
 ]},discard);
 assert.equal(result.accepted.length,3);
 assert.equal(result.accepted.find(a=>a.target.target_id==='t0').discardedInvalid,undefined);
 assert.equal(result.accepted.find(a=>a.target.target_id==='t0').option.type,'hanja');
 assert.equal(result.accepted.find(a=>a.target.target_id==='t1').option.type,'hanja');
});

test('experimental origins also treat repeated t as invalid, not as a free-form spelling',()=>{
 const t0=target('t0','가'),t1=target('t1','나');
 const result=validateExperimentalChoices([t0,t1],{results:[
  {t:'t0',c:'可'},{t:'t1',c:'c0'},{t:'t0',c:null}
 ]},{...discard,experimentalHanja:true});
 assert.deepEqual(result.accepted.map(a=>a.option.type),['keep','hanja']);
 assert.equal(result.accepted[0].discardedInvalid,true);
 assert.equal(result.unresolved.length,0);
});

test('API makes no correction request for duplicated t and commits only KEEP for that t',async()=>{
 const targets=[target('t0','가'),target('t1','나')];
 let calls=0;
 const result=await reviewTargets({
  ...discard,enableModelReview:true,smartSegmentation:true,
  model:'stub',context:'가나',request:async()=>{calls++;return {results:[
   {t:'t0',c:'c0'},{t:'t1',c:'c0'},{t:'t0',c:'c1'}]};}
 },targets);
 assert.equal(calls,1);
 assert.deepEqual(result.accepted.map(r=>r.option.type),['keep','hanja']);
 assert.equal(result.accepted[0].discardedInvalid,true);
 assert.equal(result.unresolved.length,0);
});

test('manual session ignores malformed duplicate before counting a single valid row',async()=>{
 const events=[];
 const s=createManualReviewSession({operationId:'op',post:e=>events.push(e)});
 const pending=s.request({...discard,manualPrepared:{
  requestId:'batch',text:'prompt',bindings:[],targetCount:3
 }},[target('origin0','가'),target('origin1','나'),target('origin2','다')]);
 const answer={batch_id:'batch',results:[
  {t:'t1',c:'c0'},{t:'t0',c:'c0'},{t:'t0',c:'c0',extra:true},
  {t:'t2',c:'NULL'}
 ]};
 assert.equal(s.submit({operationId:'op',requestId:'batch',text:JSON.stringify(answer)}),true);
 const accepted=events.find(e=>e.type==='MANUAL_REVIEW_ACCEPTED');
 assert.ok(accepted);
 assert.equal(accepted.discardedCount,0);
 assert.equal(events.some(e=>e.type==='MANUAL_REVIEW_ERROR'),false);
 const mapped=new Map((await pending).results.map(row=>[row.t,row.c]));
 assert.equal(mapped.get('origin0'),'c0');
 assert.equal(mapped.get('origin1'),'c0');
 assert.equal(mapped.get('origin2'),null);
 assert.equal(mapped.size,3);
});

test('ordinary correction mode still treats duplicate t as unresolved, never chooses first answer',()=>{
 const a=target('t0','가'),b=target('t1','나');
 const v=validateChoices([a,b],{results:[
  {t:'t0',c:'c0'},{t:'t1',c:'c0'},{t:'t0',c:'c1'}
 ]},{discardInvalidReviewResults:false,retryInvalidDictionaryChoices:true,reviewPosFilter:false});
 assert.deepEqual(v.accepted.map(row=>row.target.target_id),['t1']);
 assert.deepEqual(v.unresolved.map(row=>row.target_id),['t0']);
});

test('two, three, four or many identical answers collapse to one in both modes',()=>{
 const rowsFor=count=>Array.from({length:count},()=>({t:'t0',c:'c0'}));
 for(const count of [2,3,4,10,100]){
  const rows=[{t:'t1',c:'c1'},...rowsFor(count),{t:'t2',c:null}];
  const result=validateChoices([target('t0','가'),target('t1','나'),target('t2','다')],{results:rows},discard);
  assert.equal(result.accepted.length,3);
  assert.equal(result.unresolved.length,0);
  assert.deepEqual(result.accepted.map(r=>r.option.type),['hanja','hanja','keep']);
  assert.equal(result.accepted[0].discardedInvalid,undefined);
  const strict=validateChoices([target('t0','가')],{results:rowsFor(count)},
   {...discard,discardInvalidReviewResults:false,retryInvalidDictionaryChoices:true});
  assert.equal(strict.unresolved.length,0);
  assert.deepEqual(strict.accepted.map(a=>a.option.choice_id),['c0']);
 }
});

test('three mixed valid and malformed occurrences invalidate entire manual target',async()=>{
 const events=[];
 const session=createManualReviewSession({operationId:'op',post:e=>events.push(e)});
 const pending=session.request({...discard,manualPrepared:{
  requestId:'batch',text:'prompt',bindings:[],targetCount:2
 }},[target('original0','가'),target('original1','나')]);
 const rows=[
  {t:'t0',c:'c0'}, // valid
  {t:'t1',c:'c1'}, // independent valid target
  {t:'t0',c:'c1',extra:1}, // structurally invalid
  {t:'t0',c:'c1'}, // another valid row; must not win
  {t:'t0'}, // missing c
  {t:'t0',c:null} // explicit null
 ];
 assert.equal(session.submit({operationId:'op',requestId:'batch',text:JSON.stringify({batch_id:'batch',results:rows})}),true);
 const accepted=events.find(e=>e.type==='MANUAL_REVIEW_ACCEPTED');
 assert.equal(accepted.discardedCount,1);
 assert.deepEqual((await pending).results,[{t:'original1',c:'c1'},{t:'original0',c:null}]);
 assert.equal(events.some(e=>e.type==='MANUAL_REVIEW_ERROR'),false);
});

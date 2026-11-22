import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewPayload,buildManualPrompt,normalizePooledChoiceAnswers} from '../review-payload.js';
import {createManualReviewSession} from '../manual-review.js';
import {parsePartialReviewJson} from '../partial-review-json.js';
import {partitionMergedManualRecovery} from '../manual-merged-recovery.js';
import {choicePreviewParser} from '../model-stream.js';

const keep=s=>({choice_id:null,type:'keep',replacement:s,entry_id:null,definitions:[]});
const sense=(id,replacement)=>({choice_id:id,type:'hanja',replacement,entry_id:1,definitions:['verified sense']});
const target=(id,surface,choice='c0',replacement='可')=>({
 target_id:id,context:surface,surface,start:0,end:surface.length,options:[keep(surface),sense(choice,replacement)]
});
const flags={reviewPosFilter:false,retryInvalidDictionaryChoices:true,discardInvalidReviewResults:false};

test('v5 wire sends only a flat pooled p array, while private map retains local choices',()=>{
 const result=buildReviewPayload('가 나',[target('t99','가','c1','可'),target('t486','나','n0','難')],flags);
 assert.equal(result.payload.format,'shared-pools-v5');
 assert.deepEqual(result.payload.targets.map(t=>t.options),[['p0'],['p1']]);
 assert.deepEqual(result.choiceIndex,{t99:{p0:['c1']},t486:{p1:['n0']}});
 const wire=JSON.stringify(result.payload);
 assert.doesNotMatch(wire,/"c1"\s*:/);
 assert.doesNotMatch(wire,/"n0"\s*:/);
 const manual=buildManualPrompt('가 나',[target('t99','가','c1','可')],'batch',flags);
 const serialized=JSON.parse(manual.slice(manual.indexOf('{"format":"shared-pools-v5"')));
 assert.deepEqual(serialized.targets[0].options,['p0']);
 assert.doesNotMatch(manual,/"c1"\s*:/);
});

test('dictionary p output resolves per target, duplicate rendered pools choose one safe local mapping, null is preserved',()=>{
 const one=target('t99','가','c1','可'),two=target('t486','나','n0','難');
 const packed=buildReviewPayload('가 나',[one,two],flags);
 const raw={results:[
  {t:'t99',c:packed.payload.targets[0].options[0]},
  {t:'t486',c:packed.payload.targets[1].options[0]},
  {t:'t99',c:'c1'},{t:'t486',c:'p999'},{t:'t99',c:null}
 ]};
 const converted=normalizePooledChoiceAnswers(raw,packed.choiceIndex);
 assert.deepEqual(converted.results.map(x=>x.c),['c1','n0','invalid_local_key:c1','p999',null]);
 assert.equal(raw.results[0].c,'p0','original model answer is never mutated');
 const duplicate=target('duplicate','가');
 duplicate.options.push({...sense('c8','可')});
 const duplicated=buildReviewPayload('',[duplicate],flags);
 assert.deepEqual(duplicated.payload.targets[0].options,['p0']);
 assert.deepEqual(duplicated.choiceIndex.duplicate.p0,['c0']);
 assert.equal(normalizePooledChoiceAnswers({results:[{t:'duplicate',c:'p0'}]},duplicated.choiceIndex).results[0].c,'c0');
});

test('partial malformed model JSON still salvages independent complete pooled rows',()=>{
 const raw='{"batch_id":"example","results":['+
  '{"t":"t0","c":"p0"},'+
  '{"t":"t1":"bad","c":"p1"},'+
  '{"t":"t2","c":null}]}';
 const data=parsePartialReviewJson(raw);
 assert.equal(data.recovered,true);
 assert.deepEqual(data.response.results,[{t:'t0',c:'p0'},{t:'t2',c:null}]);
});

test('manual session keeps valid p selections while rejecting invalid p, then retries only missing target',async()=>{
 const events=[],session=createManualReviewSession({operationId:'v5-partial',post:e=>events.push(e)});
 const done=session.request({...flags,context:'가 나'},[target('original0','가'),target('original1','나','c2','羅')]);
 const prepared=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 assert.ok(prepared.choiceIndex?.t0,'private index must accompany the recovery snapshot');
 assert.doesNotMatch(prepared.text,/"c0"\s*:/);
 const payload=JSON.parse(prepared.text.slice(prepared.text.indexOf('{"format":"shared-pools-v5"')));
 assert.deepEqual(prepared.choiceIndex.t0[payload.targets[0].options[0]],['c0']);
 const first=session.submit({operationId:'v5-partial',requestId:prepared.requestId,text:JSON.stringify({
  batch_id:prepared.requestId,results:[{t:'t0',c:payload.targets[0].options[0]},{t:'t1',c:'p999'}]
 })});
 assert.equal(first,false);
 const partial=events.filter(e=>e.type==='MANUAL_REVIEW_ERROR'&&e.acceptedRows).at(-1);
 assert.deepEqual(partial.acceptedRows,[{t:'t0',c:'c0'}]);
 assert.deepEqual(partial.invalidTargetIds,['t1'],JSON.stringify({choiceIndex:prepared.choiceIndex,partial}));
 const retry=JSON.parse(partial.repairPrompt.slice(partial.repairPrompt.indexOf('{"format":"shared-pools-v5"')));
 assert.deepEqual(retry.targets.map(t=>t.target_id),['t1']);
 assert.deepEqual(retry.targets[0].options,[payload.targets[1].options[0]]);
 const second=session.submit({operationId:'v5-partial',requestId:prepared.requestId,text:JSON.stringify({
  batch_id:prepared.requestId,results:[{t:'t0',c:null},{t:'t1',c:payload.targets[1].options[0]}]
 })});
 assert.equal(second,true);
 assert.deepEqual((await done).results,[{t:'original0',c:'c0'},{t:'original1',c:'c2'}]);
});

test('manual rejects a foreign batch even if a pooled p key matches',async()=>{
 const events=[],session=createManualReviewSession({operationId:'foreign-batch',post:e=>events.push(e)});
 const done=session.request(flags,[target('original0','가')]);
 const req=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 assert.equal(session.submit({operationId:'foreign-batch',requestId:req.requestId,text:JSON.stringify({
  batch_id:'someone-else',results:[{t:'t0',c:'p0'}]})}),false);
 assert.match(events.at(-1).error,/batch_id/);
 assert.equal(session.submit({operationId:'foreign-batch',requestId:req.requestId,text:JSON.stringify({
  batch_id:req.requestId,results:[{t:'t0',c:'p0'}]})}),true);
 assert.deepEqual((await done).results,[{t:'original0',c:'c0'}]);
});

test('merged iframe offline partition keeps each private p mapping and target ownership separate',()=>{
 const routing=[
  {sentenceId:'frame0',frameId:0,operationId:'top',localId:'p0'},
  {sentenceId:'frame1',frameId:1,operationId:'child',localId:'p0'}
 ];
 const backup={requestId:'merged',choiceIndex:{t0:{p0:['c0']},t1:{p1:['c1']}},
  bindings:[
   {target_id:'t0',sentenceId:'frame0',choices:[{choice_id:'c0'}]},
   {target_id:'t1',sentenceId:'frame1',choices:[{choice_id:'c1'}]}
  ]};
 const payload={format:'shared-pools-v5',batch_id:'merged',
  sentences:[{sentence_id:'frame0',text:'가'},{sentence_id:'frame1',text:'나'}],
  targets:[{target_id:'t0',sentence_id:'frame0',options:['p0']},
   {target_id:'t1',sentence_id:'frame1',options:['p1']}],
  candidates:[{candidate_id:'p0',replacement:'可'},{candidate_id:'p1',replacement:'羅'}]};
 const routed=partitionMergedManualRecovery(routing,{...backup,smartSegmentation:true},
  {batch_id:'merged',results:[{t:'t0',c:'p0'},{t:'t1',c:'p1'}]},
  'PROMPT\n'+JSON.stringify(payload));
 assert.equal(routed.length,2);
 assert.deepEqual(routed[0].backup.choiceIndex,{t0:{p0:['c0']}});
 assert.deepEqual(routed[1].backup.choiceIndex,{t1:{p1:['c1']}});
 for(const frame of routed){
  const data=JSON.parse(frame.originalPrompt.slice(frame.originalPrompt.indexOf('{"format":"shared-pools-v5"')));
  assert.equal(data.targets.length,1);
  assert.equal(data.candidates.length,1);
  assert.equal(data.targets[0].options.length,1);
 }
});

test('stream parser previews only uniquely mapped pooled choices',()=>{
 const t=target('t0','가');
 const c=buildReviewPayload('가',[t],flags);
 for(const [answer,expected] of [['p0',1],['c0',0],['p999',0],[null,1]]){
  let latest=[];
  const feed=choicePreviewParser([t],rows=>{latest=rows;},()=>null,{choiceIndex:c.choiceIndex});
  feed(JSON.stringify({results:[{t:'t0',c:answer}]}));
  assert.equal(latest.length,expected,String(answer));
 }
});

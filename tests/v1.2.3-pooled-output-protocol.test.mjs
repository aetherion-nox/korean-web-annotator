import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewInstructions,buildManualPrompt,buildReviewPayload,normalizePooledChoiceAnswers} from '../review-payload.js';
import {choicePreviewParser} from '../model-stream.js';
import {reviewTargets} from '../choice-review.js';
import {createManualReviewSession} from '../manual-review.js';

const keep=s=>({choice_id:null,type:'keep',replacement:s,definitions:[]});
const t=(id,s,hanja)=>({target_id:id,context:s,start:0,end:s.length,surface:s,
 options:[keep(s),{choice_id:'c1',type:'hanja',replacement:hanja,entry_id:1,definitions:['country']}]});
const strict={reviewPosFilter:false,enableModelReview:true,retryInvalidDictionaryChoices:true,discardInvalidReviewResults:false};

test('prompts require pooled dictionary IDs instead of local c/n answers',()=>{
 const guidance=buildReviewInstructions();
 assert.ok(guidance.includes('options is an ARRAY'));
 assert.ok(guidance.includes('target.options array'));
 const prompt=buildManualPrompt('한국',[t('original','한국','韓國')],'batch-test',strict);
 assert.ok(prompt.includes('CURRENT target.options array'));
 assert.ok(prompt.includes('"c":"p0"'));
 const data=JSON.parse(prompt.slice(prompt.indexOf('{"format":"shared-pools-v5"')));
 assert.deepEqual(data.targets[0].options,['p0']);
 assert.equal(prompt.includes('"c1":"p0"'),false,'no local choice IDs in prompt');
});

test('p ID resolves only when mapped uniquely in the same target, and raw c/n is invalid',()=>{
 const choiceIndex={
  t99:{p412:['c1']},t486:{p1898:['c1']},
  duplicate:{p5:['c0','c1']},empty:{}
 };
 const input={results:[
  {t:'t99',c:'p412'},{t:'t486',c:'p1898'},
  {t:'t99',c:'c1'},{t:'t99',c:'n0'},
  {t:'t486',c:'p412'},{t:'duplicate',c:'p5'},
  {t:'empty',c:'p412'},{t:'empty',c:null},
  {t:'empty',c:'鄉鎭'}
 ]};
 const normalized=normalizePooledChoiceAnswers(input,choiceIndex).results.map(x=>x.c);
 assert.deepEqual(normalized,[
  'c1','c1','invalid_local_key:c1','invalid_local_key:n0',
  'p412','p5','p412',null,'鄉鎭'
 ]);
 assert.equal(input.results[0].c,'p412');
});

test('stream preview recognizes p and rejects local or alien IDs',()=>{
 const target=t('t99','한국','韓國');
 const choiceIndex={t99:{p412:['c1']}};
 for(const [answer,expected] of [['p412',1],['c1',0],['p1898',0]]){
  let result=[];
  const parse=choicePreviewParser([target],rows=>{result=rows;},()=>null,{choiceIndex});
  parse(JSON.stringify({results:[{t:'t99',c:answer}]}));
  assert.equal(result.length,expected,answer);
  if(expected)assert.equal(result[0].option.choice_id,'c1');
 }
});

test('API accepts p and returns existing internal dictionary selection',async()=>{
 const original=t('t99','한국','韓國');
 const result=await reviewTargets({...strict,model:'fake',provider:'custom',context:'한국',
  request:async(cfg,targets)=>{
   const payload=buildReviewPayload(cfg.context,targets,cfg).payload;
   return {results:[{t:'t99',c:payload.targets[0].options[0]}]};
  }},[original]);
 assert.deepEqual(result.accepted.map(x=>x.option.choice_id),['c1']);
 assert.equal(result.unresolved.length,0);
});

test('manual rejects legacy local key and accepts mapped pooled key',async()=>{
 const events=[],session=createManualReviewSession({operationId:'pooled-test',post:e=>events.push(e)});
 const waiting=session.request({...strict,context:'한국'},[t('original','한국','韓國')]);
 const request=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 assert.ok(request);
 const payload=JSON.parse(request.text.slice(request.text.indexOf('{"format":"shared-pools-v5"')));
 const p=payload.targets[0].options[0];
 assert.equal(session.submit({operationId:'pooled-test',requestId:request.requestId,
  text:JSON.stringify({batch_id:request.requestId,results:[{t:'t0',c:'c1'}]})}),false);
 assert.deepEqual(events.filter(e=>e.type==='MANUAL_REVIEW_ERROR').at(-1).invalidTargetIds,['t0']);
 assert.equal(session.submit({operationId:'pooled-test',requestId:request.requestId,
  text:JSON.stringify({batch_id:request.requestId,results:[{t:'t0',c:p}]})}),true);
 assert.deepEqual((await waiting).results,[{t:'original',c:'c1'}]);
});

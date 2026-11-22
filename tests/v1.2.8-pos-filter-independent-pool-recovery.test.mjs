import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewPayload,normalizePooledChoiceAnswers} from '../review-payload.js';
import {validateChoices,validateExperimentalChoices,modelTargets,reviewTargets} from '../choice-review.js';
import {createManualReviewSession} from '../manual-review.js';

const flags={reviewPosFilter:true,retryInvalidDictionaryChoices:true,discardInvalidReviewResults:false};
const keep=s=>({choice_id:null,type:'keep',replacement:s,entry_id:null,definitions:[]});
const h=(choice_id,replacement,entry_id=10,word='경제')=>({
 choice_id,type:'hanja',replacement,entry_id,definitions:['economic activity'],
 written_form:word,part_of_speech:'명사'
});
const l=(choice_id,replacement,entry_id=20,word='타운')=>({
 choice_id,type:'loanword',replacement,entry_id,definitions:['loanword origin'],
 written_form:word,part_of_speech:'명사'
});
const native=(surface)=>({choice_id:'n0',type:'nonconversion',replacement:surface,
 entry_id:100,definitions:['verb sense'],written_form:surface,part_of_speech:'동사'});
const item=(id,surface,options,tag='NNG')=>({target_id:id,context:surface,surface,
 start:0,end:surface.length,morphology:[{form:surface,start:0,end:surface.length,tag}],
 options:[keep(surface),...options]});

test('prompt remains POS-filtered but same-output foreign pooled p resolves to a hidden Hanja original option',()=>{
 const source=item('source','경제',[h('c0','經濟')]);
 const hidden=item('hidden','경제',[h('c9','經濟',11),native('경제')],'VV');
 const {payload,choiceIndex}=buildReviewPayload('',[source,hidden],flags);
 assert.deepEqual(payload.targets[0].options,['p0']);
 assert.equal(payload.targets[1].options.includes('p0'),false,'filtered Hanja is not shown to the model');
 assert.deepEqual(choiceIndex.hidden.p0,['c9'],'private same-output index preserves original option');
 const answer=normalizePooledChoiceAnswers({results:[{t:'hidden',c:'p0'}]},choiceIndex);
 assert.deepEqual(answer.results,[{t:'hidden',c:'c9'}]);
 for(const validate of [validateChoices,validateExperimentalChoices]){
  const res=validate([hidden],answer,flags);
  assert.equal(res.accepted.length,1,'filtered option should be accepted on recovered evidence');
  assert.equal(res.accepted[0].option.replacement,'經濟');
  assert.equal(res.unresolved.length,0);
 }
 assert.equal(validateChoices([hidden],answer,{...flags,reviewPosFilter:false}).accepted.length,1);
});

test('loanword and Hanja have the same private fallback but cross-type/different replacements do not pass',()=>{
 const source=item('loan-source','타운',[l('c0','town')]);
 const hidden=item('loan-hidden','타운',[l('c9','town',21),native('타운')],'VV');
 const built=buildReviewPayload('',[source,hidden],flags);
 assert.deepEqual(built.payload.targets[1].options,['p1']);
 assert.deepEqual(built.choiceIndex['loan-hidden'].p0,['c9']);
 const converted=normalizePooledChoiceAnswers({results:[{t:'loan-hidden',c:'p0'}]},built.choiceIndex);
 assert.equal(validateChoices([hidden],converted,flags).accepted[0].option.replacement,'town');
 const other=item('other','타운',[l('c4','township',25),native('타운')],'VV');
 const checked=buildReviewPayload('',[source,other],flags);
 assert.equal(checked.choiceIndex.other.p0,undefined,'a different Latin spelling is not equivalent');
 assert.equal(normalizePooledChoiceAnswers({results:[{t:'other',c:'p0'}]},checked.choiceIndex).results[0].c,'p0');
 assert.equal(validateChoices([other],{results:[{t:'other',c:'p0'}]},flags).accepted.length,0);
 const mixed=item('mixed','타운',[h('c9','town',22,'타운'),native('타운')],'VV');
 const diff=buildReviewPayload('',[source,mixed],flags);
 assert.equal(diff.choiceIndex.mixed.p0,undefined,'Hanja and loanword output classes differ');
});

test('an absent original conversion is never gained from a foreign pool, even with POS filter enabled',()=>{
 const source=item('src','경제',[h('c0','經濟')]);
 const empty=item('dst','경제',[native('경제')],'VV');
 const built=buildReviewPayload('',[source,empty],flags);
 assert.equal(built.choiceIndex.dst.p0,undefined);
 assert.equal(normalizePooledChoiceAnswers({results:[{t:'dst',c:'p0'}]},built.choiceIndex).results[0].c,'p0');
 assert.equal(validateChoices([empty],{results:[{t:'dst',c:'p0'}]},flags).accepted.length,0);
});

test('when POS filtering is off, the current target directly sees its candidates',()=>{
 const source=item('source','경제',[h('c0','經濟')]);
 const target=item('target','경제',[h('c9','經濟',99),native('경제')],'VV');
 const enabled=buildReviewPayload('',[source,target],flags);
 const disabled=buildReviewPayload('',[source,target],{...flags,reviewPosFilter:false});
 assert.equal(enabled.payload.targets[1].options.includes('p0'),false);
 assert.equal(disabled.payload.targets[1].options.includes('p0'),true);
 assert.deepEqual(disabled.choiceIndex.target.p0,['c9']);
});

test('API retains filtered wire and nevertheless accepts pooled answer using unfiltered private snapshot',async()=>{
 const source=item('orig0','경제',[h('c0','經濟')]);
 const hidden=item('orig1','경제',[h('c9','經濟',11),native('경제')],'VV');
 const calls=[];
 const result=await reviewTargets({
  ...flags,enableModelReview:true,context:'경제',model:'fake',provider:'custom',
  request:async(cfg,wire)=>{
   calls.push({cfg,wire});
   assert.equal(wire[1].options.some(o=>o.choice_id==='c9'),false);
   const payload=buildReviewPayload('',wire,cfg).payload;
   assert.equal(payload.targets[1].options.includes('p0'),false);
   return {results:[{t:'orig0',c:'p0'},{t:'orig1',c:'p0'}]};
  }
 },[source,hidden]);
 assert.equal(calls.length,1,'no unnecessary retry of a valid source-bound p');
 assert.equal(result.accepted.length,2);
 assert.equal(result.unresolved.length,0);
 assert.equal(result.accepted[1].option.replacement,'經濟');
});

test('manual review accepts a hidden local Hanja via a foreign valid p, without showing it in target options',async()=>{
 const source=item('orig0','경제',[h('c0','經濟')]);
 const hidden=item('orig1','경제',[h('c9','經濟',11),native('경제')],'VV');
 const events=[],session=createManualReviewSession({operationId:'pos-hidden-recovery',post:e=>events.push(e)});
 const done=session.request({...flags,context:'경제'},[source,hidden]);
 const req=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 const payload=JSON.parse(req.text.slice(req.text.indexOf('{"format":"shared-pools-v5"')));
 assert.equal(payload.targets[1].options.includes('p0'),false);
 assert.deepEqual(req.choiceIndex.t1.p0,['c9']);
 assert.equal(session.submit({operationId:'pos-hidden-recovery',requestId:req.requestId,
  text:JSON.stringify({batch_id:req.requestId,results:[{t:'t0',c:'p0'},{t:'t1',c:'p0'}]})}),true);
 assert.deepEqual((await done).results,[{t:'orig0',c:'c0'},{t:'orig1',c:'c9'}]);
});

test('raw model-written local IDs stay forbidden even when a matching original POS-filtered choice exists',()=>{
 const source=item('source','경제',[h('c0','經濟')]);
 const hidden=item('hidden','경제',[h('c9','經濟',11),native('경제')],'VV');
 const built=buildReviewPayload('',[source,hidden],flags);
 const converted=normalizePooledChoiceAnswers({results:[{t:'hidden',c:'c9'}]},built.choiceIndex);
 assert.match(converted.results[0].c,/^invalid_local_key/);
 assert.equal(validateChoices([hidden],converted,flags).accepted.length,0);
});

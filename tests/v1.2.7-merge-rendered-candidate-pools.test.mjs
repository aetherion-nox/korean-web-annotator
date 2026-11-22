import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewPayload,normalizePooledChoiceAnswers} from '../review-payload.js';
import {createManualReviewSession} from '../manual-review.js';
import {validateChoices} from '../choice-review.js';

const flags={reviewPosFilter:false,retryInvalidDictionaryChoices:true,discardInvalidReviewResults:false};
const keep=surface=>({choice_id:null,type:'keep',replacement:surface,entry_id:null,definitions:[]});
const h=(choice_id,replacement,entry_id,definitions=['词典释义'],extra={})=>({
 choice_id,type:'hanja',replacement,entry_id,definitions,written_form:'경제',part_of_speech:'명사',...extra
});
const native=(choice_id,replacement,entry_id,extra={})=>({
 choice_id,type:'nonconversion',replacement,entry_id,definitions:['native explanation'],
 written_form:'나',part_of_speech:'대명사',...extra
});
const word=(target_id,surface,options,extra={})=>({
 target_id,context:surface,start:0,end:surface.length,surface,
 options:[keep(surface),...options],...extra
});

test('four separate 經濟 dictionary senses form one p but preserve four meanings and provenance',()=>{
 const entries=[
  h('c0','經濟',4447,['production, distribution and consumption']),
  h('c1','經濟',33443,['economics as an academic subject']),
  h('c2','經濟',63795,['saving money, time or effort']),
  h('c3','經濟',86477,['ruling the world and helping people'])
 ];
 const built=buildReviewPayload('경제',[word('t0','경제',entries)],flags);
 assert.deepEqual(built.payload.targets[0].options,['p0']);
 assert.equal(built.payload.candidates.length,1);
 const candidate=built.payload.candidates[0];
 assert.equal(candidate.replacement,'經濟');
 assert.equal(candidate.type,'hanja');
 assert.equal(candidate.senses.length,4);
 assert.deepEqual(candidate.senses.map(x=>x.entry_id),[4447,33443,63795,86477]);
 assert.deepEqual(candidate.senses.map(x=>x.definitions[0]),entries.map(x=>x.definitions[0]));
 assert.deepEqual(built.choiceIndex.t0.p0,['c0']);
 assert.equal(built.stats.collapsedLocalOptions,3);
 assert.equal(normalizePooledChoiceAnswers({results:[{t:'t0',c:'p0'}]},built.choiceIndex).results[0].c,'c0');
});

test('nominative 내가/나 and 내: identical native lemma shares pool without losing distinct source forms',()=>{
 const a=word('t354','나',[
  native('n0','나',2736),native('n1','나',490411)
 ]);
 const b=word('t379','내',[
  native('n0','내',2736),native('n1','내',490411)
 ]);
 const built=buildReviewPayload('나 내가',[a,b],flags);
 assert.equal(built.payload.candidates.length,1);
 assert.deepEqual(built.payload.targets.map(t=>t.options),[['p0'],['p0']]);
 assert.deepEqual(built.payload.candidates[0].surface_forms,['나','내']);
 assert.deepEqual(built.payload.candidates[0].senses.map(s=>s.entry_id),[2736,490411]);
 assert.deepEqual(built.choiceIndex.t379.p0,['n0']);
 assert.equal(normalizePooledChoiceAnswers({results:[{t:'t379',c:'p0'}]},built.choiceIndex).results[0].c,'n0');
 assert.equal(validateChoices([b],{results:[{t:'t379',c:'n0'}]},flags).accepted[0].option.replacement,'내');
});

test('different native headwords never merge merely because both keep their surface',()=>{
 const na=word('na','나',[native('n1','나',490411)]);
 const nae=word('nae','내',[native('n2','내',777,{written_form:'내'})]);
 const built=buildReviewPayload('',[na,nae],flags);
 assert.deepEqual(built.payload.targets.map(t=>t.options),[['p0'],['p1']]);
 assert.equal(built.payload.candidates.length,2);
});

test('two different segment arrangements yielding the SAME projected Hanja run collapse',()=>{
 const unseg=h('c0','經濟가',4447);
 const seg={...h('c1','經濟가',33443),segments:[
  {start:0,end:2,surface:'경제',replacement:'經濟',type:'hanja'}
 ]};
 const built=buildReviewPayload('',[word('s','경제가',[unseg,seg])],flags);
 assert.deepEqual(built.payload.targets[0].options,['p0']);
 assert.equal(built.payload.candidates[0].senses.length,2);
 assert.deepEqual(built.choiceIndex.s.p0,['c0']);
});

test('same output elsewhere in the batch shares a pool but still maps to each target own local ID',()=>{
 const a=word('t1','경제',[h('c0','經濟',1)]);
 const b=word('t2','경제',[h('c9','經濟',2)]);
 const c=word('t3','경제',[h('c3','景帝',3)]);
 const built=buildReviewPayload('',[a,b,c],flags);
 assert.deepEqual(built.payload.targets.map(t=>t.options),[['p0'],['p0'],['p1']]);
 assert.deepEqual(built.choiceIndex.t2.p0,['c9']);
 assert.equal(built.choiceIndex.t3.p0,undefined,'different result cannot become valid merely because Hangul is the same');
});

test('POS-filtered options are not reintroduced by an equivalent pool owned by another occurrence',()=>{
 const noun=word('noun','경제',[h('c0','經濟',1)],{
  morphology:[{form:'경제',tag:'NNG',start:0,end:2}]
 });
 const verb=word('verb','경제',[h('c0','經濟',2),{
  choice_id:'n0',type:'nonconversion',replacement:'경제',entry_id:77,
  definitions:['native form'],written_form:'경제',part_of_speech:'동사'
 }],{
  morphology:[{form:'경제',tag:'VV',start:0,end:2}]
 });
 const built=buildReviewPayload('',[noun,verb],{reviewPosFilter:true});
 assert.deepEqual(built.payload.targets[0].options,['p0']);
 assert.deepEqual(built.payload.targets[1].options,['p1'],'verb must not offer filtered noun conversion');
 assert.equal(built.choiceIndex.verb.p0,undefined,'external same-output pool remains forbidden');
});

test('dictionary provenance strings remain visible when a session-inline entry was merged',()=>{
 const normal=h('c0','經濟',1,['formal dictionary']);
 const inline=h('c1','經濟','session-inline-hanja:context-1',['the article says 경제(經濟)']);
 const built=buildReviewPayload('',[word('t','경제',[normal,inline])],flags);
 assert.equal(built.payload.candidates.length,1);
 assert.deepEqual(built.payload.candidates[0].senses.map(s=>s.entry_id),
  [1,'session-inline-hanja:context-1']);
 assert.equal(built.payload.candidates[0].senses[1].definitions[0],
  'the article says 경제(經濟)');
});

test('manual uses merged pool and preserves valid result while retrying an unrelated invalid p',async()=>{
 const events=[],session=createManualReviewSession({operationId:'merge-pool-v7',post:e=>events.push(e)});
 const tasks=[
  word('orig0','경제',[h('c0','經濟',1),h('c1','經濟',2),h('c2','經濟',3)]),
  word('orig1','산업',[{...h('c6','産業',4),written_form:'산업'}])
 ];
 const done=session.request({...flags,context:'경제 산업'},tasks);
 const req=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 const body=JSON.parse(req.text.slice(req.text.indexOf('{"format":"shared-pools-v5"')));
 assert.deepEqual(body.targets.map(t=>t.options),[['p0'],['p1']]);
 assert.equal(body.candidates[0].senses.length,3);
 assert.equal(session.submit({operationId:'merge-pool-v7',requestId:req.requestId,
  text:JSON.stringify({batch_id:req.requestId,results:[{t:'t0',c:'p0'},{t:'t1',c:'p999'}]})}),false);
 const partial=events.filter(x=>x.type==='MANUAL_REVIEW_ERROR'&&x.invalidTargetIds).at(-1);
 assert.deepEqual(partial.invalidTargetIds,['t1']);
 assert.deepEqual(partial.acceptedRows,[{t:'t0',c:'c0'}]);
 assert.equal(session.submit({operationId:'merge-pool-v7',requestId:req.requestId,
  text:JSON.stringify({batch_id:req.requestId,results:[{t:'t1',c:'p1'}]})}),true);
 assert.deepEqual((await done).results,[{t:'orig0',c:'c0'},{t:'orig1',c:'c6'}]);
});

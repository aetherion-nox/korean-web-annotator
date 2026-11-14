import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewPayload,buildManualPrompt,buildReviewInstructions} from '../review-payload.js';
import {validateChoices,validateExperimentalChoices} from '../choice-review.js';
import {createManualReviewSession} from '../manual-review.js';

const surface='밤';
const target={target_id:'word',surface,start:0,end:1,context:'밤에 돌아왔다.',
 options:[
  {choice_id:'KEEP',type:'keep',replacement:surface,entry_id:null,definitions:[]},
  {choice_id:'n0',type:'nonconversion',replacement:surface,entry_id:1,definitions:['해가 진 뒤의 어두운 시간'],part_of_speech:'명사'},
  {choice_id:'n1',type:'nonconversion',replacement:surface,entry_id:2,definitions:['밤나무 열매'],part_of_speech:'명사'},
  {choice_id:'c0',type:'loanword',replacement:'balm',entry_id:3,definitions:['피부에 바르는 화장품'],part_of_speech:'명사'}
 ]};

test('only c options are selectable; native senses still aid semantic comparison',()=>{
 const before=JSON.stringify(target);
 const {payload}=buildReviewPayload(target.context,[target],{reviewPosFilter:false});
 const t=payload.targets[0];
 assert.deepEqual(Object.keys(t.options),['c0']);
 assert.equal(t.keep_senses.length,2);
 assert.equal(payload.candidates.length,3);
 assert.deepEqual(t.keep_senses.map(id=>payload.candidates.find(c=>c.candidate_id===id).definitions[0]),
  ['해가 진 뒤의 어두운 시간','밤나무 열매']);
 assert.equal(JSON.stringify(target),before,'do not mutate source dictionary choices');
 const prompt=buildManualPrompt(target.context,[target],'batch', {reviewPosFilter:false});
 assert.ok(prompt.includes('"keep_senses"'));
 assert.ok(!prompt.includes('"n0"')&&!prompt.includes('"n1"'));
 assert.match(buildReviewInstructions(),/NEVER answer with n-numbered keys/);
 assert.match(buildReviewInstructions(),/Use JSON null for ANY nonconversion meaning/);
});

test('n-numbered choice, including nonexistent n0, always means null/KEEP',()=>{
 const t={...target,options:target.options.filter(o=>o.type!=='nonconversion')};
 for(const choice of ['n0','n11']){
  assert.equal(validateChoices([t],{results:[{t:'word',c:choice}]}).accepted[0].option.type,'keep');
  const converted=validateExperimentalChoices([t],{results:[{t:'word',c:choice}]},{experimentalLoanword:true});
  assert.equal(converted.accepted[0].option.type,'keep');
  assert.equal(converted.experimentalAccepted,0);
 }
 assert.equal(validateChoices([target],{results:[{t:'word',c:'c0'}]}).accepted[0].option.type,'loanword');
 assert.equal(validateChoices([target],{results:[{t:'word',c:null}]}).accepted[0].option.type,'keep');
 assert.equal(validateChoices([target],{results:[{t:'word',c:'c90'}]}).accepted.length,0);
});

test('manual mode normalizes n0 to null and never saves an n key',async()=>{
 const events=[],session=createManualReviewSession({operationId:'word',post:e=>events.push(e)});
 const done=session.request({context:target.context,reviewPosFilter:false},[target]);
 const ask=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 assert.equal(session.submit({operationId:'word',requestId:ask.requestId,
  text:JSON.stringify({batch_id:ask.requestId,results:[{t:'t0',c:'n0'}]})}),true);
 assert.deepEqual((await done).results,[{t:'word',c:null}]);
});

test('manual retry keeps reference-only native senses in compact pooled candidate list',async()=>{
 const events=[],session=createManualReviewSession({operationId:'retry',post:e=>events.push(e)});
 const other={...target,target_id:'other',surface:'모',context:target.context,start:2,end:3,
  options:target.options.map(o=>({...o,replacement:o.type==='loanword'?'more':'모'}))};
 const done=session.request({context:target.context,reviewPosFilter:false},[target,other]);
 const ask=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 assert.equal(session.submit({operationId:'retry',requestId:ask.requestId,text:JSON.stringify({
  batch_id:ask.requestId,results:[{t:'t0',c:null},{t:'t1',c:'c404'}]
 })}),false);
 const retry=events.findLast(e=>e.type==='MANUAL_REVIEW_ERROR'&&e.repairPrompt);
 const compact=JSON.parse(retry.repairPrompt.slice(retry.repairPrompt.indexOf('{"format":"shared-pools-v4"')));
 assert.equal(compact.targets.length,1);
 assert.equal(compact.targets[0].keep_senses.length,2);
 for(const id of compact.targets[0].keep_senses)
  assert.ok(compact.candidates.some(c=>c.candidate_id===id));
 assert.equal(session.submit({operationId:'retry',requestId:ask.requestId,text:JSON.stringify({
  batch_id:ask.requestId,results:[{t:'t1',c:'n0'}]
 })}),true);
 assert.deepEqual((await done).results,[{t:'word',c:null},{t:'other',c:null}]);
});

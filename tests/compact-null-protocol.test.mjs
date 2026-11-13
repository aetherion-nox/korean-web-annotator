import test from 'node:test';
import assert from 'node:assert/strict';
import {validateChoices,validateExperimentalChoices} from '../choice-review.js';
import {buildReviewPayload,buildManualPrompt,buildReviewInstructions} from '../review-payload.js';
import {createManualReviewSession} from '../manual-review.js';

const target=(surface='킵')=>({target_id:'t0',start:0,end:surface.length,surface,context:surface,
 options:[{choice_id:'KEEP',type:'keep',replacement:surface,definitions:[],entry_id:null},
  {choice_id:'c0',type:'hanja',replacement:'韓國',definitions:['unrelated meaning'],entry_id:1}]});

test('the ONLY results wire protocol is {t,c}; a JSON null keeps the source',()=>{
 const t=target();
 assert.equal(validateChoices([t],{results:[{t:'t0',c:null}]}).accepted[0].option.type,'keep');
 assert.equal(validateChoices([t],{results:[{t:'t0',c:'c0'}]}).accepted[0].option.type,'hanja');
 for(const old of [
  {results:[{target_id:'t0',choice_id:'c0'}]},
  {results:[{tID:'t0',cID:'c0'}]},
  {results:[{t:'t0',c:'KEEP'}]},
  {results:[{t:'t0',c:'null'}]},
  {results:[{t:'t0',c:'c0',choice_id:'KEEP'}]},
  {results:[{t:'t0',c:null},{t:'t0',c:'c0'}]}
 ])assert.equal(validateChoices([t],old).accepted.length,0,JSON.stringify(old));
});

test('a literal Latin origin KEEP is not the old keep instruction',()=>{
 const t={...target('킵'),options:[target('킵').options[0]]};
 const origin=validateExperimentalChoices([t],{results:[{t:'t0',c:'KEEP'}]},{experimentalLoanword:true});
 assert.equal(origin.accepted.length,1);
 assert.equal(origin.accepted[0].option.type,'loanword');
 assert.equal(origin.accepted[0].option.replacement,'KEEP');
 const native=validateExperimentalChoices([t],{results:[{t:'t0',c:null}]},{experimentalLoanword:true});
 assert.equal(native.accepted[0].option.type,'keep');
});

test('the exported model prompt has no legacy result objects or fallback sentinel',()=>{
 const t=target(),cfg={experimentalLoanword:true};
 const payload=buildReviewPayload('킵',[t],cfg).payload;
 assert.equal(payload.format,'shared-pools-v4');
 assert.equal(Object.hasOwn(payload.targets[0].options,'KEEP'),false);
 const prompt=buildManualPrompt('킵',[t],'batch-id',cfg),instructions=buildReviewInstructions(cfg);
 assert.match(prompt,/{"t":"t0","c":"c0"}/);
 assert.match(instructions,/JSON null/);
 assert.doesNotMatch(prompt,/results\[\]\.choice_id|{"target_id":"t0","choice_id":"c0"}|Use KEEP only|return KEEP/i);
});

test('manual answers require exact batch and no legacy wire keys',async()=>{
 const events=[],session=createManualReviewSession({operationId:'compact',post:e=>events.push(e)});
 const pending=session.request({context:'킵',experimentalLoanword:true},[target('킵')]);
 const request=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST'),base={batch_id:request.requestId};
 const send=data=>session.submit({operationId:'compact',requestId:request.requestId,text:JSON.stringify(data)});
 assert.equal(send({results:[{t:'t0',c:null}]}),false);
 assert.equal(send({...base,results:[{target_id:'t0',choice_id:'c0'}]}),false);
 assert.equal(send({...base,results:[{t:'t0',c:null}]}),true);
 assert.deepEqual((await pending).results,[{t:'t0',c:null}]);
});

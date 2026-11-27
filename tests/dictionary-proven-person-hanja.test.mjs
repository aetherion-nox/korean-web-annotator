import test from 'node:test';
import assert from 'node:assert/strict';
import {validateChoices,validateExperimentalChoices,modelTargets} from '../choice-review.js';
import {buildReviewPayload,buildManualPrompt} from '../review-payload.js';
import {experimentalChoicePreviewParser} from '../model-stream.js';
import {createManualReviewSession} from '../manual-review.js';
import {literalOriginOption,canProposeExperimentalOption} from '../experimental-options.js';
import {projectAnnotation} from '../local-engine.js';

const actual='이승만';
const full='이승만 동상을 복원했다.';
const name={
  target_id:'person',start:0,end:3,surface:actual,context:full,
  proper_noun:true,dictionary_person_name:true,
  verified_person_hanja:['李承晩'],
  morphology:[{form:actual,tag:'NNP',start:0,end:3}],
  options:[
    {choice_id:null,type:'keep',replacement:actual,entry_id:null,definitions:[]},
    {choice_id:'c0',type:'hanja',replacement:'李承晩',entry_id:712,definitions:['역사 인물'],part_of_speech:'고유 명사',subject_category:'인명'}
  ]
};
const choice=(target,value,experimental=true,discard=false)=>(
  experimental?validateExperimentalChoices([target],{results:[{t:target.target_id,c:value}]},{experimentalHanja:true,discardInvalidReviewResults:discard})
              :validateChoices([target],{results:[{t:target.target_id,c:value}]},{discardInvalidReviewResults:discard})
);

test('person with EXACT local dictionary Hanja may be converted by c0 or raw spelling',()=>{
 for(const value of ['c0','李承晩']){
  const answer=choice(name,value);
  assert.equal(answer.accepted.length,1);
  assert.equal(answer.accepted[0].option.entry_id,712);
  assert.equal(answer.accepted[0].option.origin_source,undefined);
  assert.deepEqual(projectAnnotation(full,{...name,...answer.accepted[0].option})
    .map(a=>a.replacement),['李承晩']);
  assert.equal(answer.experimentalAccepted,0);
 }
 // This is a dictionary conversion, not free generation; the ordinary
 // c/n selection path must also allow an exact known spelling.
 assert.equal(choice(name,'李承晩',false).accepted[0].option.entry_id,712);
 assert.equal(canProposeExperimentalOption(name,'hanja'),true);
 assert.equal(literalOriginOption(name,'李承晩',{experimentalHanja:true}).origin_source,'model-unverified');
});

test('missing dictionary proof permits unverified origins only when enabled and geometry is valid',()=>{
 for(const t of [
   {...name,verified_person_hanja:undefined},
   {...name,verified_person_hanja:[]},
   {...name,options:[name.options[0]],verified_person_hanja:['李承晩']},
   {...name,suspected_person_name:true,dictionary_person_name:undefined}
 ]){
  assert.equal(choice(t,'李承晩',true,true).accepted[0].option.origin_source,'model-unverified');
 }
 for(const raw of ['李承','李承晩人','이승만']){
  const answer=choice(name,raw,true,true);
  assert.equal(answer.accepted[0].option.type,'keep',raw);
 }
});

test('verified-person evidence reaches both pooled and direct review payloads',()=>{
 const converted=modelTargets([name],{experimentalHanja:true});
 assert.deepEqual(converted[0].verified_person_hanja,['李承晩']);
 const payload=buildReviewPayload(full,converted,{experimentalHanja:true}).payload;
 assert.deepEqual(payload.targets[0].verified_person_hanja,['李承晩']);
 assert.equal(payload.targets[0].dictionary_person_name,true);
 assert.deepEqual(payload.targets[0].options,['p0']);
 const prompt=buildManualPrompt(full,converted,'batch',{experimentalHanja:true});
 assert.match(prompt,/exact person's identity/);
 assert.match(prompt,/verified_person_hanja/);
});

test('streamed literal Hanja for a verified name previews dictionary choice',()=>{
 const events=[];
 const parse=experimentalChoicePreviewParser([name],{experimentalHanja:true},rows=>
   events.push(rows.map(r=>r.option.entry_id)));
 parse('{"results":[{"t":"person","c":"李承晩"}]}');
 assert.deepEqual(events.at(-1),[712]);
});

test('manual chat accepts verified literal name and saves canonical c key',async()=>{
 const events=[];
 const session=createManualReviewSession({operationId:'known-person',post:e=>events.push(e)});
 const promise=session.request({context:full,experimentalHanja:true,reviewPosFilter:false},[name]);
 const prompt=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 assert.ok(prompt);
 const result=session.submit({operationId:'known-person',requestId:prompt.requestId,
   text:JSON.stringify({batch_id:prompt.requestId,results:[{t:'t0',c:'李承晩'}]})});
 assert.equal(result,true);
 assert.deepEqual((await promise).results,[{t:'person',c:'c0'}]);
 assert.equal(events.some(e=>e.type==='MANUAL_REVIEW_ERROR'),false);
});

test('only explicit partial-name boundary remains a Hanja veto',()=>{
 const t={...name,options:[name.options[0]],verified_person_hanja:undefined,
   suspected_person_name:true,protected_name_boundary:true};
 for(const raw of ['李承晩','韓東勳']){
  assert.equal(choice(t,raw,true,true).accepted[0].option.type,'keep');
 }
});

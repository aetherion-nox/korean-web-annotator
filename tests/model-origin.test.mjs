import test from 'node:test';
import assert from 'node:assert/strict';
import {generatedChoices} from '../model-origin.js';
import {validateChoices,modelTargets} from '../choice-review.js';
import {buildReviewPayload,buildManualPrompt} from '../review-payload.js';
import {choicePreviewParser} from '../model-stream.js';
import {projectAnnotation} from '../local-engine.js';
import {createManualReviewSession} from '../manual-review.js';
const hanja={allowModelHanja:true,allowModelLoanword:false},loan={allowModelHanja:false,allowModelLoanword:true};
const target=(surface='학교')=>({target_id:'t0',surface,start:0,end:surface.length,context:surface,morphology:[{form:surface,tag:'NNG',start:0,end:surface.length}],options:[{choice_id:'KEEP',type:'keep',replacement:surface,definitions:[]},{choice_id:'c0',type:'hanja',replacement:'學校',entry_id:2,definitions:['school'],part_of_speech:'명사'}]});
const row=(choice_id,replacement)=>({target_id:'t0',choice_id,replacement,confidence:'high',evidence:'Certain written origin supported by context'});
const selected=(t,r,config)=>validateChoices([t],{results:[r]},config).accepted;
test('separate opt-in choices, disabled by default',()=>{
 const t=target();assert.deepEqual(generatedChoices(t),[]);
 assert.deepEqual(generatedChoices(t,hanja),['GEN_HANJA']);
 assert.deepEqual(generatedChoices(t,loan),['GEN_LOANWORD']);
 assert.equal(selected(t,row('GEN_HANJA','學校'),{}).length,0);
 assert.equal(selected(t,row('GEN_HANJA','學校'),loan).length,0);
 assert.equal(selected(t,row('GEN_HANJA','學校'),hanja).length,1);
 assert.equal(selected(t,{target_id:'t0',choice_id:'c0'},hanja).length,1);
});
test('hanja must match every Hangul syllable, foreign must use safe foreign scripts',()=>{
 const t=target('도망치');
 assert.equal(selected(t,row('GEN_HANJA','逃亡致'),hanja).length,1);
 for(const value of ['逃亡','逃亡치','逃 亡 致','escape','逃亡致致','<逃亡>'])
  assert.equal(selected(t,row('GEN_HANJA',value),hanja).length,0);
 assert.equal(projectAnnotation(t.surface,{...t,...selected(t,row('GEN_HANJA','逃亡致'),hanja)[0].option})[0].replacement,'逃亡致');
 const w=target('컴퓨터');
 for(const value of ['computer','café','New York','компьютер'])assert.equal(selected(w,row('GEN_LOANWORD',value),loan).length,1);
 for(const value of ['電腦','컴퓨터','<script>',' com','com\nputer'])assert.equal(selected(w,row('GEN_LOANWORD',value),loan).length,0);
 assert.equal(selected(w,{...row('GEN_LOANWORD','computer'),confidence:'low'},loan).length,0);
 assert.equal(selected(w,{...row('GEN_LOANWORD','computer'),evidence:''},loan).length,0);
 assert.equal(selected(w,{...row('GEN_LOANWORD','computer'),unexpected:'anything'},loan).length,0);
});
test('names and partial words do not permit experimental generation',()=>{
 for(const flag of ['partial_word','proper_noun','dictionary_person_name','dictionary_name_homograph','suspected_person_name'])
  assert.deepEqual(generatedChoices({...target(),[flag]:true},hanja),[]);
});
test('model and manual payload expose generated choices only when enabled',()=>{
 const t=target();const normal=buildReviewPayload(t.context,[t]).payload;
 assert.equal(normal.targets[0].generated_choices,undefined);
 assert.deepEqual(buildReviewPayload(t.context,[t],hanja).payload.targets[0].generated_choices,['GEN_HANJA']);
 assert.deepEqual(modelTargets([t],hanja)[0].generated_choices,['GEN_HANJA']);
 assert.deepEqual(JSON.parse(buildManualPrompt(t.context,[t],'b',hanja).split('\n').at(-1)).targets[0].generated_choices,['GEN_HANJA']);
});
test('streaming previews validate dynamic results',()=>{
 const t=target(),seen=[],parser=choicePreviewParser([t],a=>seen.push(a),hanja);
 parser('{"results":['+JSON.stringify(row('GEN_HANJA','學校'))+']}');
 assert.equal(seen.at(-1)[0].option.generated,true);
});
test('manual review round-trips generated strings through validation',async()=>{
 const t=target(),events=[],session=createManualReviewSession({operationId:'op',post:e=>events.push(e)});
 const waiting=session.request({context:t.context,...hanja},[t]);
 const request=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 assert.equal(session.submit({operationId:'op',requestId:request.requestId,text:JSON.stringify({batch_id:request.requestId,results:[row('GEN_HANJA','學校')]})}),true);
 const result=await waiting;
 assert.equal(result.results[0].replacement,'學校');
 assert.equal(selected(t,result.results[0],hanja)[0].option.generated,true);
});

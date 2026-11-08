import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewPayload,buildManualPrompt} from '../review-payload.js';
import {modelTargets,validateChoices} from '../choice-review.js';
const target={target_id:'t0',start:0,end:2,surface:'이상',context:'이상은 시인이다.',morphology:[{form:'이상',tag:'NNG',start:0,end:2}],dictionary_person_name:true,dictionary_name_homograph:true,options:[{choice_id:'KEEP',type:'keep',replacement:'이상',entry_id:null,definitions:[]},{choice_id:'c0',type:'hanja',replacement:'李箱',entry_id:1,part_of_speech:'고유 명사',subject_category:'인명',definitions:['시인']},{choice_id:'c1',type:'hanja',replacement:'理想',entry_id:2,part_of_speech:'명사',definitions:['이상적인 상태']}]};
test('name homograph bypasses Kiwi POS and retains both candidate definitions',()=>{
 const payload=buildReviewPayload(target.context,[target]).payload;
 assert.deepEqual(Object.keys(payload.targets[0].options),['KEEP','c0','c1']);
 assert.equal(payload.targets[0].dictionary_name_homograph,true);
 assert.equal(payload.candidates.length,2);
 assert.equal(payload.targets[0].morphology[0].tag,'NNG');
 assert.equal(modelTargets([target])[0].options.length,3);
 assert.equal(validateChoices([target],{results:[{target_id:'t0',choice_id:'c0'}]}).accepted.length,1);
 assert.equal(validateChoices([target],{results:[{target_id:'t0',choice_id:'c1'}]}).accepted.length,1);
 const manual=JSON.parse(buildManualPrompt(target.context,[target],'batch').split('\n').at(-1));
 assert.deepEqual(manual.targets[0].options,payload.targets[0].options);
});
test('surname-suspect keeps NNP evidence and native meaning if no Hanja exists',()=>{
 const t={...target,dictionary_person_name:undefined,dictionary_name_homograph:undefined,suspected_person_name:true,options:[target.options[0],{choice_id:'n0',type:'nonconversion',replacement:'이상',entry_id:3,definitions:['native meaning'],part_of_speech:'명사'}]};
 const out=buildReviewPayload(t.context,[t]).payload;
 assert.deepEqual(Object.keys(out.targets[0].options),['KEEP','n0']);
 assert.equal(out.targets[0].suspected_person_name,true);
 assert.equal(out.targets[0].morphology[0].tag,'NNG');
});

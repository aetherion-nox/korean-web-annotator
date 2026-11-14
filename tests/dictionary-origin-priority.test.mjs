import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewInstructions,buildManualPrompt,buildReviewPayload,REVIEW_INSTRUCTIONS} from '../review-payload.js';
import {validateExperimentalChoices,validateChoices} from '../choice-review.js';

const target={
 target_id:'t0',start:0,end:2,surface:'원잠',context:'원잠 배치',
 options:[
  {choice_id:'KEEP',type:'keep',replacement:'원잠',entry_id:null,definitions:[]},
  {choice_id:'c0',type:'hanja',replacement:'元箴',entry_id:123,definitions:['unrelated sense']}
 ]
};
const response=c=>({results:[{t:'t0',c:c==='KEEP'?null:c}]});

test('dictionary plus Hanja experiment advertises open-origin without erasing dictionary choices',()=>{
 const cfg={experimentalHanja:true,reviewPosFilter:false};
 const {payload}=buildReviewPayload(target.context,[target],cfg);
 assert.equal(payload.origin_mode,'open-origin');
 assert.deepEqual(payload.allowed_origin_types,['hanja']);
 assert.equal(payload.dictionary_options_are_not_exhaustive,true);
 assert.equal(payload.null_is_fallback_only,undefined);
 assert.equal(payload.targets[0].options.KEEP,undefined);
 assert.equal(payload.targets[0].options.c0,'p0');
 assert.equal(payload.candidates[0].replacement,'元箴');
 assert.match(buildReviewInstructions(cfg),/OPEN-ENDED ORIGIN AUDIT/);
 const prompt=buildManualPrompt(target.context,[target],'abc123',cfg);
 assert.match(prompt,/FIRST infer its contextual meaning/);
 assert.match(prompt,/THEN compare every offered dictionary sense/);
 assert.match(prompt,/When no supplied dictionary sense matches/);
 assert.match(prompt,/not an exhaustive inventory/);
 assert.equal(JSON.parse(prompt.split('\n').at(-1)).batch_id,'abc123');
});
test('dictionary mode enables only the experimental source types actually selected',()=>{
 const onlyLoan=buildReviewPayload(target.context,[target],{experimentalLoanword:true}).payload;
 assert.deepEqual(onlyLoan.allowed_origin_types,['loanword']);
 const both=buildReviewPayload(target.context,[target],{experimentalHanja:true,experimentalLoanword:true}).payload;
 assert.deepEqual(both.allowed_origin_types,['hanja','loanword']);
 const ordinary=buildReviewPayload(target.context,[target],{}).payload;
 assert.equal(ordinary.origin_mode,undefined);
 assert.equal(ordinary.dictionary_options_are_not_exhaustive,undefined);
 assert.equal(buildReviewInstructions({}),REVIEW_INSTRUCTIONS);
 assert.doesNotMatch(buildManualPrompt(target.context,[target],'abc123',{}),/OPEN-ENDED origin audit/);
});
test('dictionary option ID, KEEP and direct verified origin coexist without forced model inventions',()=>{
 const cfg={experimentalHanja:true};
 const dictionary=validateExperimentalChoices([target],response('c0'),cfg);
 assert.equal(dictionary.accepted.length,1);
 assert.equal(dictionary.accepted[0].option.choice_id,'c0');
 assert.equal(dictionary.experimentalAccepted,0);
 const keep=validateExperimentalChoices([target],response('KEEP'),cfg);
 assert.equal(keep.accepted[0].option.type,'keep');
 const literal=validateExperimentalChoices([target],response('原潛'),cfg);
 assert.equal(literal.accepted.length,1);
 assert.equal(literal.accepted[0].option.choice_id,'原潛');
 assert.equal(literal.accepted[0].option.entry_id,'experimental:hanja');
 assert.equal(literal.experimentalAccepted,1);
 assert.equal(validateChoices([target],response('原潛')).accepted[0].option.type,'keep');
 assert.deepEqual(target.options.map(o=>o.choice_id),['KEEP','c0']);
});
test('segmentation experiment keeps optional repair instructions alongside open dictionary origin choices',()=>{
 const cfg={experimentalHanja:true,smartSegmentation:true};
 const prompt=buildManualPrompt(target.context,[target],'abc123',cfg);
 assert.match(prompt,/optional repairs/);
 assert.match(prompt,/FIRST infer its contextual meaning/);
 const payload=buildReviewPayload(target.context,[target],cfg).payload;
 assert.equal(payload.origin_mode,'open-origin');
 assert.equal(payload.dictionary_options_are_not_exhaustive,true);
 assert.ok(payload.sentences[0].kiwi_tokens);
});

test('script-specific proper noun permissions accept Latin personal names but not invented personal-name Hanja',async()=>{
 const {literalOriginOption,canProposeExperimentalOption,explainLiteralOriginRejection}=await import('../experimental-options.js');
 const cfg={experimentalLoanword:true,experimentalHanja:true};
 const proper=(surface,extra={})=>({
  target_id:'t0',start:0,end:surface.length,surface,context:surface,
  proper_noun:true,options:[{choice_id:'KEEP',type:'keep',replacement:surface,entry_id:null,definitions:[]}],...extra
 });
 const brand=proper('엔비디아');
 assert.equal(canProposeExperimentalOption(brand,'loanword'),true);
 assert.equal(canProposeExperimentalOption(brand,'hanja'),true);
 assert.equal(literalOriginOption(brand,'NVIDIA',cfg)?.replacement,'NVIDIA');
 const company=proper('삼성');
 assert.equal(literalOriginOption(company,'三星',cfg)?.replacement,'三星');
 const platform=proper('트위터');
 assert.equal(literalOriginOption(platform,'Twitter',cfg)?.replacement,'Twitter');
 const person=proper('트럼프',{dictionary_person_name:true});
 assert.equal(canProposeExperimentalOption(person,'loanword'),true);
 assert.equal(canProposeExperimentalOption(person,'hanja'),false);
 assert.equal(literalOriginOption(person,'Trump',cfg)?.replacement,'Trump');
 assert.equal(literalOriginOption(person,'特朗',cfg),null);
 assert.equal(explainLiteralOriginRejection(person,'特朗',cfg),'person_name_hanja_blocked');
 const suspected=proper('트럼프',{suspected_person_name:true});
 assert.equal(literalOriginOption(suspected,'Trump',cfg)?.type,'loanword');
 assert.equal(literalOriginOption(suspected,'特朗',cfg),null);
 const homograph=proper('트럼프',{dictionary_name_homograph:true});
 assert.equal(literalOriginOption(homograph,'Trump',cfg)?.type,'loanword');
 assert.equal(literalOriginOption(homograph,'特朗',cfg),null);
 for(const t of [
   {...proper('트럼프'),scan_only:true},
   proper('트 럼프')
 ]){
   assert.equal(literalOriginOption(t,'Trump',cfg),null);
   assert.equal(literalOriginOption(t,'三星',cfg),null);
 }
 assert.equal(validateExperimentalChoices([person],{results:[{t:'t0',c:null}]},cfg).accepted[0].option.type,'keep');
 const prompt=buildReviewInstructions(cfg);
 assert.match(prompt,/non-person proper nouns|non-person proper noun/i);
 assert.match(prompt,/foreign personal names/i);
 assert.doesNotMatch(prompt,/Twitter|NVIDIA|Trump|삼성/);
});

test('only explicitly flagged Latin audit KEEP-only targets survive engine validation',async()=>{
 const {validateAnalysis}=await import('../local-engine.js');
 const source='트럼프',t={target_id:'t0',start:0,end:source.length,surface:source,context:source,
   proper_noun:true,experimental_loanword_audit:true,
   options:[{choice_id:'KEEP',type:'keep',replacement:source,entry_id:null,definitions:[]}]};
 const data={engine_version:'fixture',dictionary_fingerprint:'fixture',annotations:[],
   targets:[t],stats:{local_determined:0,pending:1}};
 assert.equal(validateAnalysis(source,data).targets.length,1);
 const without={...data,targets:[{...t,experimental_loanword_audit:false}]};
 assert.equal(validateAnalysis(source,without).targets.length,0);
});

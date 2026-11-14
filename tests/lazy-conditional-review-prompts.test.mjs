import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewInstructions,buildManualPrompt,buildReviewPayload,REVIEW_INSTRUCTIONS} from '../review-payload.js';
import {validateChoices,validateExperimentalChoices} from '../choice-review.js';

const t={target_id:'t0',start:0,end:2,surface:'한국',context:'한국',options:[
 {choice_id:'KEEP',type:'keep',replacement:'한국',entry_id:null,definitions:[]},
 {choice_id:'c0',type:'hanja',replacement:'韓國',entry_id:42,definitions:['Korea']},
 {choice_id:'n0',type:'nonconversion',replacement:'한국',entry_id:43,definitions:['native meaning']}
]};
const parseManual=(config={})=>{
 const prompt=buildManualPrompt('한국',[t],'batch-123',config);
 const payload=JSON.parse(prompt.split('\n').at(-1));
 return {prompt,payload,preamble:prompt.slice(0,prompt.lastIndexOf('{"format":"shared-pools-v4"'))};
};

test('ordinary API and manual prompts contain ONLY dictionary c/n/null choices',()=>{
 const api=buildReviewInstructions();
 const {prompt,payload,preamble}=parseManual();
 assert.equal(api,REVIEW_INSTRUCTIONS);
 assert.deepEqual(Object.keys(payload.targets[0].options),['c0','n0']);
 assert.equal(payload.batch_id,'batch-123');
 assert.equal(payload.origin_mode,undefined);
 assert.equal(payload.allowed_origin_types,undefined);
 assert.equal(payload.dictionary_options_are_not_exhaustive,undefined);
 for(const content of [api,preamble]){
  assert.match(content,/matching local dictionary c\/n key/);
  assert.match(content,/actual JSON null/);
  assert.match(content,/dictionary c key/);
  assert.doesNotMatch(content,/OPEN-ENDED ORIGIN AUDIT|SMART SEGMENTATION|Audit every original sentence/i);
  assert.doesNotMatch(content,/literal origin|enabled Latin|enabled Hanja|enabled source|directly in c|a genuinely known Hanja\/Latin origin|genuinely known enabled|when enabled|verified_person_hanja/i);
  assert.doesNotMatch(content,/repairs|scan_only|old_target_ids/i);
 }
 assert.doesNotMatch(prompt,/"origin_mode"|"allowed_origin_types"/);
});

test('experimental Hanja, Latin and combined origin prompts are assembled only on demand',()=>{
 const cases=[
  [{experimentalHanja:true},['hanja']],
  [{experimentalLoanword:true},['loanword']],
  [{experimentalHanja:true,experimentalLoanword:true},['hanja','loanword']]
 ];
 for(const [config,types] of cases){
  const system=buildReviewInstructions(config);
  const {preamble,payload}=parseManual(config);
  assert.match(system,/OPEN-ENDED ORIGIN AUDIT/);
  assert.match(preamble,/enabled literal origin/);
  assert.match(preamble,/directly in c/);
  assert.equal(payload.origin_mode,'open-origin');
  assert.deepEqual(payload.allowed_origin_types,types);
  assert.equal(payload.dictionary_options_are_not_exhaustive,true);
  assert.doesNotMatch(system,/Kiwi boundaries and POS are hints/);
  if(!config.experimentalLoanword)assert.doesNotMatch(preamble,/A genuine enabled Latin source spelling/);
  if(!config.experimentalHanja)assert.doesNotMatch(preamble,/A genuine enabled Hanja source spelling/);
 }
});

test('smart segmentation and dictionary-free origin instructions are independent opt-in modules',()=>{
 const smart=buildReviewInstructions({smartSegmentation:true});
 assert.match(smart,/Kiwi boundaries and POS are hints/);
 assert.match(smart,/repairs/);
 assert.doesNotMatch(smart,/OPEN-ENDED ORIGIN AUDIT/);
 const {preamble,payload}=parseManual({smartSegmentation:true});
 assert.match(preamble,/optional repairs/);
 assert.equal(payload.origin_mode,undefined);
 assert.ok(payload.sentences[0].kiwi_tokens);
 const noDictionaryButNoOrigin=buildReviewInstructions({dictionaryFree:true});
 assert.equal(noDictionaryButNoOrigin,REVIEW_INSTRUCTIONS,'a disabled experiment must not leak dictionary-free origin instructions');
 const enabled=buildReviewInstructions({dictionaryFree:true,experimentalHanja:true});
 assert.match(enabled,/no external dictionary was loaded/);
 assert.match(enabled,/OPEN-ENDED ORIGIN AUDIT/);
});

test('prompt refactor never changes c/n/null and experimental validation rules',()=>{
 for(const [value,expected] of [['c0','hanja'],['n0','nonconversion'],[null,'keep'],['c999','keep']]){
  const plain=validateChoices([t],{results:[{t:'t0',c:value}]});
  assert.equal(plain.accepted[0].option.type,expected);
 }
 const ordinary=validateChoices([t],{results:[{t:'t0',c:'韓國'}]});
 assert.equal(ordinary.accepted[0].option.type,'keep');
 const origin=validateExperimentalChoices([t],{results:[{t:'t0',c:'韓國'}]},{experimentalHanja:true});
 assert.equal(origin.accepted.length,1);
});

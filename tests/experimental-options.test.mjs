import test from 'node:test';
import assert from 'node:assert/strict';
import {literalOriginOption,canProposeExperimentalOption} from '../experimental-options.js';
import {buildReviewPayload,buildManualPrompt,buildReviewInstructions,REVIEW_INSTRUCTIONS} from '../review-payload.js';
import {validateExperimentalChoices,validateChoices} from '../choice-review.js';
import {projectAnnotation} from '../local-engine.js';

const hanja={target_id:'t0',start:0,end:2,surface:'원잠',context:'원잠을 보유한다.',options:[
 {choice_id:'KEEP',type:'keep',replacement:'원잠',entry_id:null,definitions:[]},
 {choice_id:'c0',type:'hanja',replacement:'元箴',entry_id:10,definitions:['unrelated meaning']}]};
const loan={target_id:'t1',start:0,end:2,surface:'게임',context:'게임을 한다.',options:[
 {choice_id:'KEEP',type:'keep',replacement:'게임',entry_id:null,definitions:[]},
 {choice_id:'n0',type:'nonconversion',replacement:'게임',entry_id:12,definitions:['native meaning']}]};
const reply=(target_id,choice_id)=>({results:[{t:target_id,c:choice_id==='KEEP'?null:choice_id}]});
const choose=(target,choice_id,config)=>validateExperimentalChoices([target],reply(target.target_id,choice_id),config);

test('literal Hanja is read from results.choice_id; no proposal array or x0 required',()=>{
 const result=choose(hanja,'原潛',{experimentalHanja:true});
 assert.equal(result.accepted.length,1);assert.equal(result.unresolved.length,0);
 assert.equal(result.accepted[0].option.choice_id,'原潛');
 assert.equal(result.accepted[0].option.entry_id,'experimental:hanja');
 assert.deepEqual(projectAnnotation(hanja.context,{...result.accepted[0].target,...result.accepted[0].option}).map(a=>a.replacement),['原潛']);
 assert.equal(result.experimentalAccepted,1);
 assert.deepEqual(hanja.options.map(o=>o.choice_id),['KEEP','c0'],'dictionary target is not mutated');
});

test('original dictionary keys continue to work, including KEEP, c0 and n0',()=>{
 for(const id of ['c0','KEEP']){
  const result=choose(hanja,id,{experimentalHanja:true});
  assert.equal(result.accepted[0].option.choice_id,id);
  assert.equal(result.experimentalAccepted,0);
 }
 assert.equal(choose(loan,'n0',{experimentalLoanword:true}).accepted[0].option.type,'nonconversion');
 assert.equal(validateChoices([hanja],reply('t0','原潛')).accepted[0].option.type,'keep',
  'ordinary mode must not convert unsupported raw origins');
 assert.equal(choose(hanja,'元箴',{experimentalHanja:true}).accepted.length,1,'matching dictionary spelling can be proposed independently');
});

test('identical literal origin and dictionary spelling remain separate evidence for Musk, Yugo and Hanja',()=>{
 const musk={target_id:'t560',start:2,end:5,surface:'머스크',context:'멜론머스크',
  suspected_person_name:true,proper_noun:true,options:[
   {choice_id:'KEEP',type:'keep',replacement:'머스크',entry_id:null,definitions:[]},
   ...['c0','c1','c2'].map((id,i)=>({choice_id:id,type:'loanword',
    replacement:'musk',entry_id:100+i,definitions:['unrelated dictionary meaning']}))
  ]};
 const yugo={target_id:'t577',start:1,end:3,surface:'유고',context:'‘유고의 그림자’',
  suspected_person_name:true,options:[
   {choice_id:'KEEP',type:'keep',replacement:'유고',entry_id:null,definitions:[]},
   {choice_id:'c9',type:'loanword',replacement:'Yugo',entry_id:209,definitions:['former country']}
  ]};
 for(const [target,raw,existingKey] of [[musk,'musk','c0'],[yugo,'Yugo','c9']]){
  const independent=choose(target,raw,{experimentalLoanword:true});
  assert.equal(independent.accepted.length,1,raw);
  assert.equal(independent.experimentalAccepted,1);
  assert.equal(independent.accepted[0].option.origin_source,'model-unverified');
  assert.equal(independent.accepted[0].option.entry_id,'experimental:loanword');
  assert.deepEqual(projectAnnotation(target.context,{...target,...independent.accepted[0].option})
   .map(a=>[a.start,a.end,a.replacement]),[[target.start,target.end,raw]]);
  const dictionary=choose(target,existingKey,{experimentalLoanword:true});
  assert.equal(dictionary.experimentalAccepted,0);
  assert.equal(dictionary.accepted[0].option.entry_id,target.options.find(o=>o.choice_id===existingKey).entry_id);
  assert.equal(choose(target,raw,{}).accepted[0].option.type,'keep',
   'open-origin still requires enabling loanword mode');
 }
 const oldHanja={...hanja,options:[
  hanja.options[0],{...hanja.options[1],replacement:'原潛'}
 ]};
 const literal=choose(oldHanja,'原潛',{experimentalHanja:true});
 assert.equal(literal.accepted.length,1);
 assert.equal(literal.experimentalAccepted,1);
 assert.equal(literal.accepted[0].option.entry_id,'experimental:hanja');
 assert.equal(choose(oldHanja,'c0',{experimentalHanja:true}).accepted[0].option.entry_id,10);
 assert.equal(choose({...oldHanja,dictionary_person_name:true},'原潛',{experimentalHanja:true}).accepted[0].option.type,'keep',
  'personal-name Hanja protection still rejects the proposed conversion');
});

test('Latin spelling is validated as loanword without trusting an invented pool key',()=>{
 const result=choose(loan,'game',{experimentalLoanword:true});
 assert.equal(result.accepted.length,1);assert.equal(result.accepted[0].option.type,'loanword');
 assert.deepEqual(projectAnnotation(loan.context,{...result.accepted[0].target,...result.accepted[0].option}).map(a=>a.replacement),['game']);
 for(const id of ['x0','p0','KEEP '])
  assert.equal(choose(loan,id,{experimentalLoanword:true}).accepted[0].option.type,'keep',id);
 for(const id of ['c99','n999']){
  const accepted=choose(loan,id,{experimentalLoanword:true});
  assert.equal(accepted.accepted[0].option.type,'keep',id);
  assert.equal(accepted.experimentalAccepted,0,id);
 }
});

test('script, alignment and enabled-mode guards reject invented or malformed values',()=>{
 for(const [target,raw,config] of [
  [hanja,'原潛',{}],[hanja,'原子潛水艇',{experimentalHanja:true}],
  [hanja,'元箴',{experimentalHanja:false}],[hanja,'원잠',{experimentalHanja:true}],
  [loan,'game',{experimentalHanja:true}],[loan,'遊戲',{experimentalLoanword:true}],
  [loan,'https://url.test',{experimentalLoanword:true}],
  [loan,' game',{experimentalLoanword:true}],
  [hanja,'原潛\nKEEP',{experimentalHanja:true}]
 ]){
  assert.equal(choose(target,raw,config).accepted[0].option.type,'keep',JSON.stringify(raw));
 }
});

test('Hanja proper nouns are eligible except flagged personal names',()=>{
 const proper={...hanja,proper_noun:true};
 assert.equal(canProposeExperimentalOption(proper,'hanja'),true);
 assert.equal(choose(proper,'原潛',{experimentalHanja:true}).accepted.length,1);
 for(const flag of ['suspected_person_name','dictionary_person_name','dictionary_name_homograph']){
  const t={...hanja,[flag]:true};
  assert.equal(canProposeExperimentalOption(t,'hanja'),false,flag);
  assert.equal(choose(t,'原潛',{experimentalHanja:true}).accepted[0].option.type,'keep',flag);
  assert.equal(choose(t,'c0',{experimentalHanja:true}).accepted.length,1,'dictionary keys remain available');
 }
});

test('compound components accept aligned Latin and Hanja origins without a boundary flag',()=>{
 const companyContext='L3해리스가 운영한다';
 const company={target_id:'t383',start:2,end:5,surface:'해리스',context:companyContext,
  proper_noun:true,dictionary_person_name:true,experimental_loanword_audit:true,
  options:[{choice_id:'KEEP',type:'keep',replacement:'해리스',entry_id:null,definitions:[]}]};
 const companyResult=choose(company,'Harris',{experimentalLoanword:true});
 assert.equal(canProposeExperimentalOption(company,'loanword'),true);
 assert.equal(companyResult.accepted.length,1);
 assert.deepEqual(projectAnnotation(companyContext,{...company,...companyResult.accepted[0].option})
  .map(a=>[a.start,a.end,a.replacement]),[[2,5,'Harris']]);
 assert.equal(companyContext.slice(0,company.start)+'Harris'+companyContext.slice(company.end),'L3Harris가 운영한다');

 const compound={target_id:'t384',start:2,end:4,surface:'정책',context:'경제정책',
  options:[{choice_id:'KEEP',type:'keep',replacement:'정책',entry_id:null,definitions:[]}]};
 const hanjaResult=choose(compound,'政策',{experimentalHanja:true});
 assert.equal(canProposeExperimentalOption(compound,'hanja'),true);
 assert.equal(hanjaResult.accepted.length,1);
 assert.deepEqual(projectAnnotation(compound.context,{...compound,...hanjaResult.accepted[0].option})
  .map(a=>[a.start,a.end,a.replacement]),[[2,4,'政策']]);
 assert.equal(choose(compound,'經濟政策',{experimentalHanja:true}).accepted[0].option.type,'keep',
  'extra Hanja characters must not overwrite a partial source span');

 const partialDictionary={...hanja};
 assert.equal(choose(partialDictionary,'c0',{experimentalHanja:true}).accepted.length,1,
  'pre-existing dictionary choices remain valid');
});

test('cross-batch, duplicate, extra fields and obsolete experimental arrays are rejected',()=>{
 for(const payload of [
  {results:[{t:'foreign',c:'原潛'}]},
  {results:[{t:'t0',c:'原潛'},{t:'t0',c:null}]},
  {results:[{target_id:'t0',choice_id:'原潛',replacement:'evil'}]},
  {results:[{t:'t0',c:'x0'}],experimental_options:[]},
  {results:[{t:'t0',c:12}]}
 ]){
  assert.equal(validateExperimentalChoices([hanja],payload,{experimentalHanja:true}).accepted.length,0,JSON.stringify(payload));
 }
});

test('cross-space lexical targets cannot be created from dictionary alias spellings',()=>{
 const t={target_id:'t2',start:0,end:6,surface:'이산화 탄소',context:'이산화 탄소',options:[
  {choice_id:'KEEP',type:'keep',replacement:'이산화 탄소',entry_id:null,definitions:[]}]};
 assert.equal(choose(t,'二酸化炭素',{experimentalHanja:true}).accepted[0].option.type,'keep');
 assert.equal(literalOriginOption(t,'二酸化',{experimentalHanja:true}),null);
 assert.equal(choose(t,'KEEP',{experimentalHanja:true}).accepted[0].option.type,'keep');
});

test('only the enabled experimental origin rule is included in each manual/API prompt',()=>{
 const common=buildReviewInstructions({});
 const hanjaOnly=buildReviewInstructions({experimentalHanja:true});
 const loanOnly=buildReviewInstructions({experimentalLoanword:true});
 const both=buildReviewInstructions({experimentalHanja:true,experimentalLoanword:true});
 const hanjaRule='genuine Hanja spelling',loanRule='original Latin-script spelling';
 assert.equal(common,REVIEW_INSTRUCTIONS);
 assert.ok(!common.includes(hanjaRule)&&!common.includes(loanRule));
 assert.ok(hanjaOnly.includes(hanjaRule)&&!hanjaOnly.includes(loanRule));
 assert.ok(loanOnly.includes(loanRule)&&!loanOnly.includes(hanjaRule));
 assert.ok(both.includes(hanjaRule)&&both.includes(loanRule));
 for(const instructions of [common,hanjaOnly,loanOnly,both]){
  assert.ok(instructions.includes('Nonconversion dictionary senses'));
  assert.ok(instructions.includes('JSON null'));
  assert.ok(instructions.includes('dictionary_name_homograph'));
  assert.ok(!instructions.includes('partial_word'));
  assert.ok(instructions.includes('sentence_id'));
  assert.ok(!/experimental_options|experimental_modes|x0|开启的实验类型|only if.*enabled/i.test(instructions));
 }
 for(const config of [{},{experimentalHanja:true},{experimentalLoanword:true},{experimentalHanja:true,experimentalLoanword:true}]){
  const prompt=buildManualPrompt(hanja.context,[hanja],'BATCH',config);
  const payload=JSON.parse(prompt.split('\n').at(-1));
  assert.equal(payload.batch_id,'BATCH');
  assert.equal(payload.experimental_modes,undefined);
  assert.ok(prompt.startsWith(buildReviewInstructions(config)));
  assert.ok(prompt.includes('Copy the current batch_id exactly'));
  assert.ok(prompt.includes('"results"'));
  assert.ok(!prompt.includes('"experimental_options":['));
 }
 const packed=buildReviewPayload(hanja.context,[hanja],{experimentalHanja:true}).payload;
 assert.equal(packed.targets[0].options.c0,'p0');
 assert.equal(packed.format,'shared-pools-v4');
 assert.equal(packed.experimental_modes,undefined);
 assert.ok(both.length<common.length+2300,'experimental instructions should remain compact for large batches');
 assert.ok(common.includes('Decide meaning from the sentence and adjacent context'));
 assert.ok(common.includes('BEFORE selecting a dictionary sense'));
 for(const prompt of [hanjaOnly,loanOnly,both]){
  assert.ok(prompt.includes('OPEN-ENDED ORIGIN AUDIT'));
  assert.ok(prompt.includes('FIRST infer its contextual meaning'));
  assert.ok(prompt.includes('THEN compare every offered dictionary sense'));
  assert.ok(prompt.includes('When no supplied dictionary sense matches'));
  assert.ok(prompt.includes('directly in c'));
  assert.ok(prompt.includes('JSON null'));
  assert.ok(prompt.includes('never invent a dictionary key'));
  assert.ok(!prompt.includes('you may write'));
 }
 assert.equal((both.match(/FIRST infer/g)||[]).length,1,'the audit order must appear once');
});

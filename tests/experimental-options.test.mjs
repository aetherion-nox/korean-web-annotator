import test from 'node:test';
import assert from 'node:assert/strict';
import {appendExperimentalOptions} from '../experimental-options.js';
import {buildReviewPayload,buildManualPrompt} from '../review-payload.js';
import {validateExperimentalChoices} from '../choice-review.js';
import {projectAnnotation} from '../local-engine.js';
const hanja={target_id:'t0',start:0,end:2,surface:'원잠',context:'원잠을 보유한다.',options:[
 {choice_id:'KEEP',type:'keep',replacement:'원잠',entry_id:null,definitions:[]},
 {choice_id:'c0',type:'hanja',replacement:'元箴',entry_id:10,definitions:['unrelated meaning']}]};
const loan={target_id:'t1',start:0,end:2,surface:'게임',context:'게임을 한다.',options:[
 {choice_id:'KEEP',type:'keep',replacement:'게임',entry_id:null,definitions:[]},
 {choice_id:'n0',type:'nonconversion',replacement:'게임',entry_id:12,definitions:['unrelated sense']}]};
const proposal=(target_id,type,replacement,definition='specific etymological sense',choice_id='x0')=>({target_id,choice_id,type,replacement,definition});
const response=(proposals,results)=>({experimental_options:proposals,results});

test('one JSON answer adds Hanja candidate and selects x0',()=>{
 const answer=response([proposal('t0','hanja','原潛')],[{target_id:'t0',choice_id:'x0'}]);
 const expanded=appendExperimentalOptions([hanja],answer,{experimentalHanja:true});
 assert.equal(expanded.length,1);
 assert.deepEqual(expanded[0].options.map(o=>o.choice_id),['KEEP','c0','x0']);
 assert.deepEqual(projectAnnotation(hanja.context,{...expanded[0],...expanded[0].options.at(-1)}).map(x=>x.replacement),['原潛']);
 const checked=validateExperimentalChoices([hanja],answer,{experimentalHanja:true});
 assert.equal(checked.accepted.length,1);assert.equal(checked.accepted[0].option.replacement,'原潛');
 assert.equal(checked.experimentalAccepted,1);assert.equal(checked.unresolved.length,0);
});

test('ordinary existing c0/n0/KEEP remain selectable with experimental mode enabled',()=>{
 for(const choice_id of ['c0','KEEP']){
  const result=validateExperimentalChoices([hanja],response([],[{target_id:'t0',choice_id}]),{experimentalHanja:true});
  assert.equal(result.accepted[0].option.choice_id,choice_id);
 }
 const native=validateExperimentalChoices([loan],response([],[{target_id:'t1',choice_id:'n0'}]),{experimentalLoanword:true});
 assert.equal(native.accepted[0].option.type,'nonconversion');
});

test('loanword original works but arbitrary translations, disabled modes and malformed origins do not',()=>{
 const result=validateExperimentalChoices([loan],response([proposal('t1','loanword','game')],[{target_id:'t1',choice_id:'x0'}]),{experimentalLoanword:true});
 assert.equal(result.accepted[0].option.replacement,'game');
 const spans=projectAnnotation(loan.context,{...result.accepted[0].target,...result.accepted[0].option});
 assert.deepEqual([spans[0].start,spans[0].end,spans[0].replacement],[0,2,'game']);
 for(const [type,replacement,settings] of [
  ['hanja','原潛',{}],['hanja','原子潛水艇',{experimentalHanja:true}],
  ['hanja','元箴',{experimentalHanja:true}],['loanword','遊戲',{experimentalLoanword:true}],
  ['loanword','game',{experimentalHanja:true}]
 ]){
  const target=type==='hanja'?hanja:loan,answer=response([proposal(target.target_id,type,replacement)],[{target_id:target.target_id,choice_id:'x0'}]);
  assert.equal(validateExperimentalChoices([target],answer,settings).unresolved.length,1,type+' '+replacement);
 }
});

test('name, proper noun and partial-word targets never accept experimental proposal',()=>{
 const answer=response([proposal('t0','hanja','原潛')],[{target_id:'t0',choice_id:'x0'}]);
 for(const key of ['proper_noun','suspected_person_name','dictionary_person_name','dictionary_name_homograph','partial_word']){
  assert.equal(validateExperimentalChoices([{...hanja,[key]:true}],answer,{experimentalHanja:true}).unresolved.length,1,key);
 }
});

test('invalid experimental IDs, cross-batch proposals and duplicate slots cannot be used',()=>{
 for(const bad of [
  response([proposal('cross-batch','hanja','原潛')],[{target_id:'t0',choice_id:'x0'}]),
  response([proposal('t0','hanja','原潛'),proposal('t0','hanja','元潛')],[{target_id:'t0',choice_id:'x0'}]),
  response([proposal('t0','hanja','原潛','def','x1')],[{target_id:'t0',choice_id:'x1'}]),
  {results:[{target_id:'t0',choice_id:'x0'}]},
  response([proposal('t0','hanja','原潛')],[{target_id:'t0',choice_id:'p0'}]),
  response([proposal('t0','hanja','原潛')],[{target_id:'other',choice_id:'x0'}])
 ]){
  assert.equal(validateExperimentalChoices([hanja],bad,{experimentalHanja:true}).accepted.length,0,JSON.stringify(bad));
 }
 const fallback=validateExperimentalChoices([hanja],response([proposal('t0','hanja','原子潛水艇')],[{target_id:'t0',choice_id:'c0'}]),{experimentalHanja:true});
 assert.equal(fallback.accepted[0].option.choice_id,'c0','Malformed optional proposal must not discard a valid dictionary choice');
});

test('multiple proposals per target use target-local x0/x1 keys',()=>{
 const answer=response([proposal('t0','hanja','原潛'),proposal('t0','hanja','元潛','a second sense','x1')],[{target_id:'t0',choice_id:'x1'}]);
 const result=validateExperimentalChoices([hanja],answer,{experimentalHanja:true});
 assert.equal(result.experimentalProposed,2);assert.equal(result.accepted[0].option.replacement,'元潛');
});

test('manual and API prompts include experimental_modes and ordered single-reply schema',()=>{
 const prompt=buildManualPrompt(hanja.context,[hanja],'BATCH',{experimentalHanja:true});
 const payload=JSON.parse(prompt.split('\n').at(-1));
 assert.equal(payload.batch_id,'BATCH');assert.equal(payload.experimental_modes.hanja,true);
 assert.match(prompt,/"experimental_options":\[\]/);
 assert.ok(prompt.includes('experimental_options FIRST'));
 const ordinary=buildManualPrompt(hanja.context,[hanja],'BATCH2',{});
 assert.ok(!ordinary.includes('experimental_options FIRST'));
 assert.equal(JSON.parse(ordinary.split('\n').at(-1)).experimental_modes,undefined);
 const packed=buildReviewPayload(hanja.context,[hanja],{experimentalHanja:true}).payload;
 assert.equal(packed.format,'shared-pools-v3');assert.equal(packed.experimental_modes.hanja,true);
 assert.equal(packed.targets[0].options.c0,'p0');
});

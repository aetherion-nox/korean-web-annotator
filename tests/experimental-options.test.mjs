import test from 'node:test';
import assert from 'node:assert/strict';
import {appendExperimentalOptions} from '../experimental-options.js';
import {buildReviewPayload,buildManualPrompt} from '../review-payload.js';
import {validateChoices} from '../choice-review.js';
import {projectAnnotation} from '../local-engine.js';

const hanja={
 target_id:'t0',start:0,end:2,surface:'원잠',context:'원잠을 보유한다.',
 options:[
  {choice_id:'KEEP',type:'keep',replacement:'원잠',entry_id:null,definitions:[]},
  {choice_id:'c0',type:'hanja',replacement:'元箴',entry_id:10,definitions:['unrelated dictionary meaning']}
 ]
};
const loan={
 target_id:'t1',start:0,end:2,surface:'게임',context:'게임을 한다.',
 options:[
  {choice_id:'KEEP',type:'keep',replacement:'게임',entry_id:null,definitions:[]},
  {choice_id:'n0',type:'nonconversion',replacement:'게임',entry_id:12,definitions:['unrelated sense']}
 ]
};
const proposal=(target_id,type,replacement,definition='specific etymological sense')=>({target_id,proposal:{type,replacement,definition}});

test('validated Hanja proposal becomes an ordinary, target-local option',()=>{
 const result=appendExperimentalOptions([hanja],{results:[proposal('t0','hanja','原潛')]},{experimentalHanja:true});
 assert.equal(result.length,1);
 assert.deepEqual(result[0].options.map(o=>o.choice_id),['KEEP','c0','x0']);
 assert.deepEqual(projectAnnotation(hanja.context,{...result[0],...result[0].options.at(-1)}).map(x=>x.replacement),['原潛']);
 assert.equal(validateChoices(result,{results:[{target_id:'t0',choice_id:'x0'}]}).accepted[0].option.type,'hanja');
 assert.equal(validateChoices(result,{results:[{target_id:'t0',choice_id:'NOT_REAL'}]}).unresolved.length,1);
 const payload=buildReviewPayload(hanja.context,result).payload;
 assert.equal(payload.format,'shared-pools-v3');
 assert.equal(payload.targets[0].options.x0,'p1');
});

test('valid loanword original is selectable without expanding target boundaries',()=>{
 const result=appendExperimentalOptions([loan],{results:[proposal('t1','loanword','game')]},{experimentalLoanword:true});
 assert.equal(result.length,1);
 const spans=projectAnnotation(loan.context,{...result[0],...result[0].options.at(-1)});
 assert.equal(spans.length,1);
 assert.deepEqual([spans[0].start,spans[0].end,spans[0].replacement],[0,2,'game']);
});

test('disabled modes, malformed Hanja and duplicate dictionary options are rejected',()=>{
 assert.equal(appendExperimentalOptions([hanja],{results:[proposal('t0','hanja','原潛')]}).length,0);
 assert.equal(appendExperimentalOptions([hanja],{results:[proposal('t0','hanja','原子潛水艇')]},{experimentalHanja:true}).length,0);
 assert.equal(appendExperimentalOptions([hanja],{results:[proposal('t0','hanja','元箴')]},{experimentalHanja:true}).length,0);
 assert.equal(appendExperimentalOptions([loan],{results:[proposal('t1','loanword','to play a game')]},{experimentalHanja:true}).length,0);
 assert.equal(appendExperimentalOptions([loan],{results:[proposal('t1','loanword','遊戲')]},{experimentalLoanword:true}).length,0);
});

test('names, partial words, cross-batch and duplicate target IDs never get new options',()=>{
 const input={results:[proposal('t0','hanja','原潛')]};
 for(const key of ['proper_noun','suspected_person_name','dictionary_person_name','dictionary_name_homograph','partial_word'])
  assert.equal(appendExperimentalOptions([{...hanja,[key]:true}],input,{experimentalHanja:true}).length,0,key);
 assert.equal(appendExperimentalOptions([hanja],{results:[proposal('unlisted','hanja','原潛')]},{experimentalHanja:true}).length,0);
 assert.equal(appendExperimentalOptions([hanja],{results:[...input.results,...input.results]},{experimentalHanja:true}).length,0);
});

test('proposal prompt uses its own internal schema; final selection keeps the baseline JSON shape',()=>{
 const experimental=buildManualPrompt(hanja.context,[hanja],'BATCH',{experimentalPhase:'propose',experimentalHanja:true});
 const payload=JSON.parse(experimental.split('\n').at(-1));
 assert.equal(payload.batch_id,'BATCH');
 assert.equal(payload.experimental_modes.hanja,true);
 assert.match(experimental,/"proposal":null/);
 const updated=appendExperimentalOptions([hanja],{results:[proposal('t0','hanja','原潛')]},{experimentalHanja:true});
 const choicePrompt=buildManualPrompt(hanja.context,updated,'BATCH2',{experimentalPhase:'choose'});
 assert.match(choicePrompt,/"choice_id":"KEEP"/);
 assert.equal(JSON.parse(choicePrompt.split('\n').at(-1)).targets[0].proposal,undefined);
});

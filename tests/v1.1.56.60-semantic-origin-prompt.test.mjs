import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewInstructions,buildReviewPayload,buildManualPrompt,REVIEW_INSTRUCTIONS} from '../review-payload.js';
import {literalOriginOption} from '../experimental-options.js';

const keep=(surface)=>({choice_id:'KEEP',type:'keep',replacement:surface,entry_id:null,definitions:[]});
const t={
 target_id:'t0',surface:'원잠',start:0,end:2,context:'원잠을 도입한다.',
 options:[keep('원잠'),{choice_id:'c0',type:'hanja',replacement:'元箴',entry_id:1,definitions:['unrelated sense']}]
};

test('ordinary dictionary prompt rejects the sole wrong dictionary option without allowing literal origins',()=>{
 const p=buildReviewInstructions({});
 assert.equal(p,REVIEW_INSTRUCTIONS);
 assert.match(p,/Dictionary options are proposals, not proof/);
 assert.match(p,/wrong even when it is the only candidate/);
 assert.match(p,/matching local dictionary c\/n key or actual JSON null/);
 assert.match(p,/all provided local candidates are semantically wrong/);
 assert.match(p,/No directly written Hanja|Directly written Hanja or Latin-script spellings are NOT allowed/);
 assert.match(p,/NOT a Chinese translation/);
 assert.doesNotMatch(p,/OPEN-ENDED ORIGIN AUDIT/);
 assert.doesNotMatch(p,/EXPERIMENTAL HANJA ON|EXPERIMENTAL LOANWORD ON/);
 const manual=buildManualPrompt(t.context,[t],'id1',{});
 assert.match(manual,/DICTIONARY-ONLY ANSWERS/);
 assert.doesNotMatch(manual,/EXPERIMENTAL HANJA ON/);
 const payload=JSON.parse(manual.split('\n').at(-1));
 assert.equal(payload.origin_mode,undefined);
 assert.deepEqual(Object.keys(payload.targets[0].options),['c0']);
});

test('Hanja-only origin mode encourages authentic directly written Hanja rather than a wrong dictionary key',()=>{
 const cfg={experimentalHanja:true,experimentalLoanword:false};
 const p=buildReviewInstructions(cfg);
 assert.match(p,/EXPERIMENTAL HANJA ON/);
 assert.match(p,/EXPERIMENTAL LOANWORD OFF/);
 assert.match(p,/if none matches but an authentic origin of an enabled type/);
 assert.match(p,/rather than select a wrong key/);
 assert.match(p,/NOT a meaning-equivalent Chinese translation/);
 assert.match(p,/write it directly in c rather than select a wrong key/);
 assert.match(p,/Do not replace native Korean morphemes with semantic Hanja/);
 assert.doesNotMatch(p,/EXPERIMENTAL LOANWORD ON/);
 const payload=buildReviewPayload(t.context,[t],cfg).payload;
 assert.deepEqual(payload.allowed_origin_types,['hanja']);
 const manual=buildManualPrompt(t.context,[t],'id1',cfg);
 assert.match(manual,/EXPERIMENTAL HANJA ON/);
 assert.match(manual,/EXPERIMENTAL LOANWORD OFF/);
 assert.deepEqual(JSON.parse(manual.split('\n').at(-1)).allowed_origin_types,['hanja']);
});

test('Latin-only origin mode does not accidentally authorize unlisted Hanja spellings',()=>{
 const cfg={experimentalHanja:false,experimentalLoanword:true};
 const p=buildReviewInstructions(cfg);
 assert.match(p,/EXPERIMENTAL HANJA OFF/);
 assert.match(p,/no raw Hanja in results\[\]\.c/);
 assert.match(p,/EXPERIMENTAL LOANWORD ON/);
 assert.match(p,/NEVER choose the nearest available key/);
 assert.doesNotMatch(p,/EXPERIMENTAL HANJA ON/);
 assert.deepEqual(buildReviewPayload(t.context,[t],cfg).payload.allowed_origin_types,['loanword']);
 const manual=buildManualPrompt(t.context,[t],'id1',cfg);
 assert.match(manual,/EXPERIMENTAL HANJA OFF/);
 assert.match(manual,/EXPERIMENTAL LOANWORD ON/);
});

test('combined mode allows reliably known origins of both types and still rejects semantic mistranslations',()=>{
 const cfg={experimentalHanja:true,experimentalLoanword:true,smartSegmentation:true};
 const p=buildReviewInstructions(cfg);
 assert.match(p,/EXPERIMENTAL HANJA ON/);
 assert.match(p,/EXPERIMENTAL LOANWORD ON/);
 assert.match(p,/NOT a meaning-equivalent Chinese translation/);
 assert.match(p,/For EACH occurrence, FIRST infer its contextual meaning/);
 assert.match(p,/THEN compare every offered dictionary sense and spelling/);
 assert.match(p,/SAME response/);
 assert.deepEqual(buildReviewPayload(t.context,[t],cfg).payload.allowed_origin_types,['hanja','loanword']);
 assert.doesNotMatch(p,/EXPERIMENTAL HANJA OFF|EXPERIMENTAL LOANWORD OFF/);
});

test('dictionary-only correction stays strict when experimental modes are disabled',()=>{
 const p=buildReviewInstructions({dictionaryCorrectionOnly:true});
 assert.match(p,/DICTIONARY-ONLY CORRECTION/);
 assert.match(p,/DICTIONARY-ONLY ANSWERS/);
 assert.match(p,/actual JSON null/);
 assert.doesNotMatch(p,/OPEN-ENDED ORIGIN AUDIT|EXPERIMENTAL HANJA ON|EXPERIMENTAL LOANWORD ON/);
});

test('dictionary correction keeps precisely the experimental types originally enabled',()=>{
 for(const [cfg,hanja,latin] of [
  [{experimentalHanja:true},true,false],
  [{experimentalLoanword:true},false,true],
  [{experimentalHanja:true,experimentalLoanword:true,smartSegmentation:true},true,true]
 ]){
  const p=buildReviewInstructions({...cfg,dictionaryCorrectionOnly:true});
  assert.match(p,/ORIGIN-AUDIT CORRECTION/);
  assert.match(p,/OPEN-ENDED ORIGIN AUDIT/);
  assert.match(p,/if none matches but an authentic origin of an enabled type/);
  assert.match(p,/do not submit repairs/);
  assert.equal(p.includes('EXPERIMENTAL HANJA ON'),hanja);
  assert.equal(p.includes('EXPERIMENTAL LOANWORD ON'),latin);
  assert.doesNotMatch(p,/Return results for targets not superseded|SAME response/);
 }
});

test('a translation with the correct meaning but wrong Hanja pronunciation is rejected unchanged',()=>{
 const mk=(surface,context)=>({surface,context,start:0,end:surface.length,options:[keep(surface)]});
 assert.equal(literalOriginOption(mk('두급','두급'),'兩級',{experimentalHanja:true,hanjaReadingCheck:true}),null);
 assert.equal(literalOriginOption(mk('향진','향진'),'鄉鎭',{experimentalHanja:true,hanjaReadingCheck:true})?.type,'hanja');
});

test('prompt guidance remains generalized rather than hard-coding the reported examples',()=>{
 for(const cfg of [{},{experimentalHanja:true},{experimentalLoanword:true},{experimentalHanja:true,experimentalLoanword:true}]){
  const prompt=buildReviewInstructions(cfg);
  assert.doesNotMatch(prompt,/향진|두급|鄉鎭|兩級|元箴/);
 }
});

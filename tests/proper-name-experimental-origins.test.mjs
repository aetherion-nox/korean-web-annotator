import test from 'node:test';
import assert from 'node:assert/strict';
import {validateExperimentalChoices,validateChoices} from '../choice-review.js';
import {validateSegmentationRepairs} from '../segmentation-repairs.js';
import {buildReviewPayload,buildReviewInstructions} from '../review-payload.js';

const target=(surface,flags={})=>({
 target_id:'t0',start:0,end:surface.length,surface,context:surface+'라고 말했다.',
 options:[{choice_id:'KEEP',type:'keep',replacement:surface,definitions:[],entry_id:null}],
 ...flags
});
const decide=(t,c,config)=>validateExperimentalChoices([t],{results:[{t:'t0',c}]},config);

test('Latin experimental origins may identify a brand, organization or person regardless of NNP/person hints',()=>{
 for(const [surface,origin,flags] of [
  ['트위터','Twitter',{proper_noun:true}],
  ['엔비디아','NVIDIA',{proper_noun:true}],
  ['트럼프','Trump',{proper_noun:true,suspected_person_name:true}],
  ['스콧','Scott',{proper_noun:true,dictionary_person_name:true,dictionary_name_homograph:true}]
 ]){
  const t=target(surface,flags);
  const accepted=decide(t,origin,{experimentalLoanword:true});
  assert.equal(accepted.accepted.length,1,surface);
  assert.equal(accepted.accepted[0].option.type,'loanword');
  assert.equal(accepted.accepted[0].option.replacement,origin);
  assert.equal(validateChoices([t],{results:[{t:'t0',c:origin}]}).accepted.length,0);
 }
});

test('Hanja is permitted for non-person proper nouns but not suspected personal names or partial spans',()=>{
 const proper=target('삼성',{proper_noun:true});
 assert.equal(decide(proper,'三星',{experimentalHanja:true}).accepted.length,1);
 for(const flags of [
  {proper_noun:true,dictionary_person_name:true},
  {proper_noun:true,suspected_person_name:true},
  {proper_noun:true,dictionary_name_homograph:true},
  {proper_noun:true,partial_word:true}
 ]){
  const t=target('김은중',flags);
  assert.equal(decide(t,'金銀中',{experimentalHanja:true}).accepted.length,0,JSON.stringify(flags));
 }
 assert.equal(decide(target('트럼프',{proper_noun:true,partial_word:true}),'Trump',
  {experimentalLoanword:true}).accepted.length,0);
});

test('model instructions are origin-type specific and general, never a list of hardcoded names',()=>{
 const h=buildReviewInstructions({experimentalHanja:true});
 const l=buildReviewInstructions({experimentalLoanword:true});
 assert.match(h,/non-person proper noun/);
 assert.match(h,/personal names/);
 assert.match(l,/people, organizations, brands and places/);
 assert.match(l,/authentic original spelling/);
 for(const source of [h,l])assert.doesNotMatch(source,/Twitter|NVIDIA|Trump|三星|Samsung/);
 assert.doesNotMatch(h,/Latin-script origins:/);
 assert.doesNotMatch(l,/For Hanja:/);
});

function repairFixture(surface,{person=false}={}){
 const t={...target(surface),context:surface,scan_only:true,repair_sentence_key:'s',options:[
  {choice_id:'KEEP',type:'keep',replacement:surface,definitions:[],entry_id:null}]};
 const config={context:surface,smartSegmentation:true,experimentalHanja:true,
  experimentalLoanword:true,hanjaReadingCheck:false,
  repairModes:{hanja:true,loanword:true},
  repairScopes:new Map([['t0',{
   text:surface,allTargets:[],localAnnotations:[],protected_ranges:[[0,surface.length]],
   person_ranges:person?[[0,surface.length]]:[],selected:null,existingRepairs:[]
  }]])};
 const payload=buildReviewPayload(surface,[t],config).payload;
 const row=c=>({sentence_id:payload.sentences[0].sentence_id,op:'add',old_target_ids:[],
  start:0,end:surface.length,surface,choice_id:c});
 return {t,config,row};
}
test('segmentation repairs permit Latin real names in protected NNP ranges',()=>{
 const f=repairFixture('트럼프',{person:true});
 const res=validateSegmentationRepairs([f.t],{repairs:[f.row('Trump')]},f.config);
 assert.equal(res.rejected.length,0,JSON.stringify(res.rejected));
 assert.equal(res.accepted[0].annotations[0].replacement,'Trump');
 const off={...f.config,experimentalLoanword:false};
 assert.equal(validateSegmentationRepairs([f.t],{repairs:[f.row('Trump')]},off).accepted.length,0);
});
test('segmentation repairs allow Hanja proper names only without personal-name evidence',()=>{
 const company=repairFixture('삼성');
 assert.equal(validateSegmentationRepairs([company.t],{repairs:[company.row('三星')]},
  company.config).accepted.length,1);
 const person=repairFixture('삼성',{person:true});
 assert.equal(validateSegmentationRepairs([person.t],{repairs:[person.row('三星')]},
  person.config).accepted.length,0);
});

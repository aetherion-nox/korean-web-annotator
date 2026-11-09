import './review-validation-core.js';
const core=globalThis.KRA_REVIEW_VALIDATION_CORE;
// Experimental model-supplied origins, opt-in and locally validated.
const HANGUL=/^[가-힣]{1,24}$/u;
const CJK=/^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{323af}]+$/u;
const FOREIGN=/^[\p{L}\p{M}\p{N} .,'’+\-/&]{1,100}$/u;
const FORBIDDEN=/[\p{Script=Hangul}\p{Script=Han}]/u;
export const GENERATED_HANJA='GEN_HANJA';
export const GENERATED_LOANWORD='GEN_LOANWORD';
export const GENERATED_SEGMENTS='GEN_SEGMENTS';
export function generatedChoices(target,config={}){
 if(target?.segmentation_review===true){
  if(target.protected_name===true||(target.dictionary_person_name===true&&target.dictionary_name_homograph!==true))return [];
  return config.allowModelSegmentation===true&&(config.allowModelHanja===true||config.allowModelLoanword===true)&&HANGUL.test(target.surface)?[GENERATED_SEGMENTS]:[];
 }
 if(!target||!HANGUL.test(target.surface)||target.partial_word===true||target.proper_noun===true||
   target.dictionary_person_name===true||target.dictionary_name_homograph===true||target.suspected_person_name===true)return [];
 const choices=[];
 if(config.allowModelHanja===true)choices.push(GENERATED_HANJA);
 if(config.allowModelLoanword===true)choices.push(GENERATED_LOANWORD);
 return choices;
}
// Core primitives are identical in extension pages, service workers and
// content-script offline recovery. Authorization stays bound to each target.
export function canonicalizeGeneratedSegments(target,row){
 return core.canonicalizeGeneratedSegments(target,row);
}
export function validateGeneratedRow(target,row,config={}){
 if(!row||!generatedChoices(target,config).includes(row.choice_id))return null;
 return core.validateGeneratedRow(target,row,config).value||null;
}
export function validateGeneratedSegmentsRow(target,row,config={}){
 if(!row||!generatedChoices(target,config).includes(GENERATED_SEGMENTS))return null;
 return core.validateGeneratedSegmentsRow(target,row,config).value||null;
}
export function diagnoseGeneratedRow(target,row,config={}){
 if(!row)return {ok:false,code:'EMPTY_ROW',message:'缺少审核结果'};
 if(!generatedChoices(target,config).includes(row.choice_id))
  return {ok:false,code:'UNAUTHORIZED_CHOICE',message:'该目标未启用此类生成词源'};
 return row.choice_id===GENERATED_SEGMENTS?
  core.validateGeneratedSegmentsRow(target,row,config):core.validateGeneratedRow(target,row,config);
}

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
 // The fallback for a safely bounded original dictionary target may only
 // accept dictionary choices. Free generation belongs to whole-word review.
 if(target?.fallback_dictionary_only===true)return [];
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

/**
 * Feedback for a rejected generated origin. Never manufactures a missing
 * character or infers whether an unconverted suffix is lexical/native.
 * The reviewer must resolve the complete lexical boundary from context.
 */
export function generatedRepairFeedback(target,row,config={}){
 const diagnosis=diagnoseGeneratedRow(target,row,config);
 if(diagnosis.ok)return '';
 const prefix='['+diagnosis.code+'] '+diagnosis.message;
 if(diagnosis.code==='ISOLATED_SYLLABLE'){
  return prefix+'。重新判断完整目标「'+target.surface+'」的词义与词界：先区分词干和助词/词尾；若整个词干确为汉字词，返回覆盖完整词干的一条 GEN_SEGMENTS 汉字段，并使汉字数与音节数逐一对应；若是真实混种词，才拆成有依据的多个段。禁止为了通过检查随意把固有词汉字化；不确定时返回 KEEP。';
 }
 if(diagnosis.code==='HANJA_ALIGNMENT'||diagnosis.code==='SEGMENT_OFFSETS'){
  return prefix+'。以完整目标「'+target.surface+'」重新计算 UTF-16 start/end、surface 和 replacement。优先返回整个汉字词干的单一完整片段；保留非汉字词干与助词/词尾，不能猜测缺失字形。';
 }
 if(diagnosis.code==='EVIDENCE_CONTRADICTION'){
  return prefix+'。对整个词重新确定词源，并让转换的所有片段与实际原文一致；不能根据说明文字补造汉字。';
 }
 return prefix;
}

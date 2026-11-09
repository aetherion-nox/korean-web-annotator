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
  return config.allowModelSegmentation===true&&(config.allowModelHanja===true||config.allowModelLoanword===true)&&HANGUL.test(target.surface)?[GENERATED_SEGMENTS]:[];
 }
 if(!target||!HANGUL.test(target.surface)||target.partial_word===true||target.proper_noun===true||
   target.dictionary_person_name===true||target.dictionary_name_homograph===true||target.suspected_person_name===true)return [];
 const choices=[];
 if(config.allowModelHanja===true)choices.push(GENERATED_HANJA);
 if(config.allowModelLoanword===true)choices.push(GENERATED_LOANWORD);
 return choices;
}
export function validateGeneratedRow(target,row,config={}){
 if(!row||typeof row!=='object'||!generatedChoices(target,config).includes(row.choice_id))return null;
 if(Object.keys(row).some(key=>!['target_id','choice_id','replacement','confidence','evidence'].includes(key))||
    row.confidence!=='high'||typeof row.evidence!=='string'||!row.evidence.trim()||row.evidence.length>240)return null;
 const replacement=row.replacement;
 if(typeof replacement!=='string'||replacement!==replacement.trim()||replacement!==replacement.normalize('NFC'))return null;
 const type=row.choice_id===GENERATED_HANJA?'hanja':'loanword';
 if(type==='hanja'){
  if(!CJK.test(replacement)||Array.from(replacement).length!==Array.from(target.surface).length)return null;
 }else{
  if(!FOREIGN.test(replacement)||FORBIDDEN.test(replacement)||!/[\p{L}]/u.test(replacement)||replacement===target.surface)return null;
 }
 return {choice_id:row.choice_id,type,replacement,entry_id:null,definitions:[],generated:true,confidence:'high',evidence:row.evidence.trim()};
}


// The LLM may segment the *original* Hangul source span independently of Kiwi.
// This is never a replacement instruction: every proposed offset is checked.
export function validateGeneratedSegmentsRow(target,row,config={}){
 if(!target?.segmentation_review||!generatedChoices(target,config).includes(GENERATED_SEGMENTS)||
    !row||row.choice_id!==GENERATED_SEGMENTS||typeof row.target_id!=='string'||!Array.isArray(row.segments)||
    row.segments.length<1||row.segments.length>8||row.confidence!=='high'||
    typeof row.evidence!=='string'||!row.evidence.trim()||row.evidence.length>240||
    Object.keys(row).some(k=>!['target_id','choice_id','segments','confidence','evidence'].includes(k)))return null;
 let last=0;
 const segments=[];
 for(const part of row.segments){
  if(!part||typeof part!=='object'||Object.keys(part).some(k=>!['start','end','surface','type','replacement'].includes(k))||
    !Number.isInteger(part.start)||!Number.isInteger(part.end)||part.start<last||
    part.end>target.surface.length||part.end<=part.start||part.end-part.start<2||
    typeof part.surface!=='string'||target.surface.slice(part.start,part.end)!==part.surface||
    !['hanja','loanword'].includes(part.type))return null;
  const choice_id=part.type==='hanja'?GENERATED_HANJA:GENERATED_LOANWORD;
  const provisional=validateGeneratedRow({surface:part.surface},{
    target_id:row.target_id,choice_id,replacement:part.replacement,confidence:'high',evidence:row.evidence
  },config);
  if(!provisional)return null;
  segments.push({start:part.start,end:part.end,surface:part.surface,type:part.type,replacement:part.replacement});
  last=part.end;
 }
 let replacement=target.surface;
 for(const part of [...segments].reverse())replacement=replacement.slice(0,part.start)+part.replacement+replacement.slice(part.end);
 if(replacement===target.surface)return null;
 return {choice_id:GENERATED_SEGMENTS,type:'mixed',replacement,segments,entry_id:null,definitions:[],generated:true,segmentationGenerated:true,confidence:'high',evidence:row.evidence.trim()};
}

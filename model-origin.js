// Experimental model-supplied origins, opt-in and locally validated.
const HANGUL=/^[가-힣]{1,24}$/u;
const CJK=/^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{323af}]+$/u;
const FOREIGN=/^[\p{L}\p{M}\p{N} .,'’+\-/&]{1,100}$/u;
const FORBIDDEN=/[\p{Script=Hangul}\p{Script=Han}]/u;
export const GENERATED_HANJA='GEN_HANJA';
export const GENERATED_LOANWORD='GEN_LOANWORD';
export function generatedChoices(target,config={}){
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

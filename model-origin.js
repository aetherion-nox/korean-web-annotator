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



// Repair mistaken offsets only when the literal subword has one possible
// location in the target. Repeated unmatched substrings are ambiguous.
export function canonicalizeGeneratedSegments(target,raw){
 if(typeof target?.surface!=='string'||!Array.isArray(raw))return null;
 const text=target.surface,out=[];let previous=0;
 for(const part of raw){
  if(!part||typeof part!=='object'||
     Object.keys(part).some(k=>!['start','end','surface','type','replacement'].includes(k))||
     !Number.isInteger(part.start)||!Number.isInteger(part.end)||part.end<=part.start||
     typeof part.surface!=='string'||!/^[가-힣]+$/u.test(part.surface))return null;
  let start=part.start,end=part.end;
  if(start<0||end>text.length||text.slice(start,end)!==part.surface){
   start=text.indexOf(part.surface);
   if(start<0||text.indexOf(part.surface,start+1)!==-1)return null;
   end=start+part.surface.length;
  }
  if(start<previous||end>text.length||start<0)return null;
  out.push({...part,start,end});previous=end;
 }
 return out;
}
function groundedIsolatedSyllable(target,part){
 const documented=(target.component_candidates||[]).some(c=>
   c.start===part.start&&c.end===part.end&&c.surface===part.surface&&
   (c.options||[]).some(o=>o.entry_id!=null&&
    o.type===part.type&&o.replacement===part.replacement&&
    (!o.written_form||o.written_form.replace(/[-^ ]/gu,'')===part.surface)));
 if(!documented)return false;
 const tokens=Array.isArray(target.morphology)?target.morphology:[];
 const nominal=tokens.some(t=>t.start===part.start&&t.end===part.end&&
  ['NNG','NNB','NR'].includes(String(t.tag||'').split('-')[0]));
 const grammaticalSuffix=tokens.some(t=>t.start===part.end&&
  (/^J/u.test(String(t.tag||''))||['EP','EF','EC','ETM','ETN'].includes(String(t.tag||'').split('-')[0])));
 if(!nominal||!grammaticalSuffix)return false;
 return part.start===0||tokens.some(t=>t.end===part.start&&
  ['MM','NR','ETM'].includes(String(t.tag||'').split('-')[0]));
}

// The LLM may segment the *original* Hangul source span independently of Kiwi.
// This is never a replacement instruction: every proposed offset is checked.
export function validateGeneratedSegmentsRow(target,row,config={}){
 if(!target?.segmentation_review||!generatedChoices(target,config).includes(GENERATED_SEGMENTS)||
    !row||row.choice_id!==GENERATED_SEGMENTS||typeof row.target_id!=='string'||!Array.isArray(row.segments)||
    row.segments.length<1||row.segments.length>8||row.confidence!=='high'||
    typeof row.evidence!=='string'||!row.evidence.trim()||row.evidence.length>240||
    Object.keys(row).some(k=>!['target_id','choice_id','segments','confidence','evidence'].includes(k)))return null;
 const canonical=canonicalizeGeneratedSegments(target,row.segments);
 if(!canonical)return null;
 // A standalone, unlisted NNP in foreign spelling may be a person's name.
 // Phonetic similarity alone is not enough evidence of that name's origin.
 if(target.name_risk===true&&canonical.some(p=>p.type==='loanword')&&
    !canonical.every(p=>(target.component_candidates||[]).some(c=>
      c.start===p.start&&c.end===p.end&&c.surface===p.surface&&
      (c.options||[]).some(o=>o.entry_id!=null&&o.type===p.type&&o.replacement===p.replacement))))return null;
 let last=0;
 const segments=[];
 for(const part of canonical){
  if(!part||typeof part!=='object'||Object.keys(part).some(k=>!['start','end','surface','type','replacement'].includes(k))||
    !Number.isInteger(part.start)||!Number.isInteger(part.end)||part.start<last||
    part.end>target.surface.length||part.end<=part.start||
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
 // One-syllable Hanja morphemes are legal inside a contiguous compound
 // (e.g. 檢察 + 院), but not as isolated proposals inside unrelated Korean text.
 for(let i=0;i<segments.length;i++){
  const part=segments[i];
  if(part.end-part.start!==1)continue;
  const previous=segments[i-1],next=segments[i+1];
  const attached=(
   (previous&&previous.end===part.start)||
   (next&&part.end===next.start));
  // One-syllable components may be part of an independently reviewed
  // continuous multi-origin compound (팀장 → team長), never a lone guess.
  if(!attached&&!groundedIsolatedSyllable(target,part))return null;
 }
 let replacement=target.surface;
 for(const part of [...segments].reverse())replacement=replacement.slice(0,part.start)+part.replacement+replacement.slice(part.end);
 if(replacement===target.surface)return null;
 return {choice_id:GENERATED_SEGMENTS,type:'mixed',replacement,segments,entry_id:null,definitions:[],generated:true,segmentationGenerated:true,confidence:'high',evidence:row.evidence.trim()};
}

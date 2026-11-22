import {projectAnnotation} from './local-engine.js';
import {validateModelHanjaReadings} from './hanja-reading-check.js';
import {alignMixedLiteralOrigin} from './mixed-origin-alignment.js';

// Only generate direct-origin rules for types explicitly enabled by the user.
// Keep the decision order short enough for large shared-pool batches.
export function buildExperimentalOriginInstructions(config={}){
 const hanja=config.experimentalHanja===true,loanword=config.experimentalLoanword===true;
 if(!hanja&&!loanword)return '';
 const origin=hanja&&loanword
  ?"genuine Hanja spelling of a Sino-Korean word or original Latin-script spelling of a borrowed word"
  :hanja?"genuine Hanja spelling of a Sino-Korean word"
         :"original Latin-script spelling of a borrowed word";
 return [
  "OPEN-ENDED ORIGIN AUDIT: dictionary keys are candidate meanings, not an exhaustive inventory of authentic origins. A genuine enabled source spelling may be placed directly in c.",
  "For EACH occurrence, FIRST infer its contextual meaning and word boundaries; THEN compare every offered dictionary sense and spelling. Use a pooled p ID ONLY if both its meaning and origin match, not because it is the only, closest or most convenient candidate.",
  "DECISION ORDER: choose a genuinely matching pooled p ID from this target's options; if none matches but an authentic origin of an enabled type is reliably known, write it directly in c rather than select a wrong key; otherwise use actual JSON null.",
  "Experimental origin-audit targets may have empty options: no dictionary entry does not prove foreign or Sino-Korean origin. Propose only reliable source spellings; never invent a pooled p ID.",
  "When no supplied dictionary sense matches and the authentic "+origin+" is reliably known, put that spelling directly in c. This is independent, unverified model evidence, NOT proof that an unrelated dictionary meaning is correct.",
  "Use actual JSON null for native words, uncertain origins, unverified identities or unclear word boundaries. A proper-noun tag alone is not grounds to return null.",
  hanja?"EXPERIMENTAL HANJA ON: direct Hanja must be genuine Sino-Korean characters aligned to Hangul readings, NOT a meaning-equivalent Chinese translation pronounced differently. Do not replace native Korean morphemes with semantic Hanja; preserve source boundaries and explicit native suffixes. Hanja must align with the Korean source.":"EXPERIMENTAL HANJA OFF: no raw Hanja in results[].c; use only a matching pooled p ID or actual JSON null for Hanja words.",
  loanword?"EXPERIMENTAL LOANWORD ON: borrowed words may use established Latin originals, including identifiable foreign personal names. Do not invent translations or romanizations of native Korean names.":"EXPERIMENTAL LOANWORD OFF: no raw Latin origin in results[].c; use only a matching pooled p ID or actual JSON null for borrowed words.",
   ...(hanja||loanword?["MIXED ORIGINS: c may combine an enabled Hanja/Latin original with unchanged Hangul anywhere (not only suffixes): 터부도→taboo도, 금기도→禁忌도, 재확인도→재確認도. Preserve Hangul exactly; Hanja aligns syllable-by-syllable; Latin lengths may differ. Ambiguous boundaries: null."]:[]),
  ...(hanja?["Non-person proper nouns may use authentic Hanja spellings. A personal name may use ONLY a matching pooled p ID or verified_person_hanja; never guess personal Hanja."]:[]),
  "Output exactly one {t,c} row per target unless superseded by a validated segmentation repair. c is a matching pooled p ID, an authentic enabled source spelling or JSON null. Results and repair objects follow separate rules."
 ].join('\n');
}

const CJK=/^[\p{Script=Han}]+$/u;
const LOANWORD=/^[\p{Script=Latin}0-9][\p{Script=Latin}\p{M}0-9 .·'’()\/&+\-]*$/u;
const RESERVED=/^[cnxp]\d+$/i;
// Script-specific permissions: NNP is not itself a veto; personal-name Hanja is.
export function canProposeExperimentalOption(target,type){
 const surface=target?.surface||'';
 // A compound component can have its own valid origin even when adjacent to other word tokens.
 // Source-span projection, Hanja character count/readings, and whitespace checks
 // remain the authoritative local guards for literal origins.
 if(!/[가-힣]/u.test(surface)||/\s/u.test(surface)||target.scan_only===true)return false;
 if(type==='loanword')return true;
 if(type==='hanja')return !(target.dictionary_person_name===true||
   target.dictionary_name_homograph===true||target.suspected_person_name===true);
 return false;
}

// An unchanged native/derivational suffix may follow a Sino-Korean stem.
// Only trust Kiwi's *explicit* suffix boundary, never truncate an arbitrary
// portion of the source to make a shorter model answer fit.
export function alignedHanjaStemSuffix(target,origin){
 if(!/^[\p{Script=Han}]+$/u.test(origin)||!/^[가-힣]+$/u.test(target?.surface||''))return null;
 const chars=[...origin],source=[...target.surface];
 if(!chars.length||chars.length>=source.length)return null;
 const stem=source.slice(0,chars.length).join(''),suffix=source.slice(chars.length).join('');
 const start=target.start+stem.length,end=target.end;
 const trailing=(target.morphology||[]).filter(m=>m.start>=start)
  .sort((a,b)=>a.start-b.start);
 if(!trailing.length||trailing[0].start!==start)return null;
 let pos=start;
 for(const m of trailing){
  if(m.start!==pos||!/^(?:XSN|XSM)(?:[-+].*)?$/u.test(m.tag||''))return null;
  pos=m.end;
 }
 if(pos!==end)return null;
 return {stem,suffix,replacement:origin+suffix,segments:[{
  start:0,end:stem.length,surface:stem,type:'hanja',replacement:origin
 }]};
}

// Return null instead of silently changing / accepting an unknown choice.
// A raw model origin is *not* a dictionary-backed etymology.
export function literalOriginOption(target,choiceId,config={}){
 // Models occasionally quote the JSON null sentinel. Do not turn that
 // mistake into a Latin-script annotation (especially in manual recovery).
 if(typeof choiceId==='string'&&choiceId.toLowerCase()==='null')return null;
 if(typeof choiceId!=='string'||!choiceId||choiceId.length>160||choiceId!==choiceId.trim()||
    /[<>\x00-\x1f\x7f]/u.test(choiceId)||RESERVED.test(choiceId))return null;
 // Internal nonconversion/keep options are not model-visible sentinels.
 // A Latin original equal to a former keep marker remains valid.
 if(target.options?.some(o=>o.type!=='keep'&&o.choice_id===choiceId))return null;
 // Mixed literals can leave any original Hangul span unchanged: beginning,
 // middle or end. The alignment must be unique and source-bound.
 const embedded=/[가-힣]/u.test(choiceId);
 const mixed=embedded?alignMixedLiteralOrigin(target.surface,choiceId,config):null;
 let type;
 if(mixed)type=mixed.type;
 else if(embedded)return null;
 else if(CJK.test(choiceId)&&config.experimentalHanja===true)type='hanja';
 else if(LOANWORD.test(choiceId)&&/\p{Script=Latin}/u.test(choiceId)&&config.experimentalLoanword===true)type='loanword';
 else return null;
 if(type==='mixed'){
  if(!canProposeExperimentalOption(target,'hanja')||
     !canProposeExperimentalOption(target,'loanword'))return null;
 }else if(!canProposeExperimentalOption(target,type))return null;
 const aligned=mixed||(type==='hanja'?alignedHanjaStemSuffix(target,choiceId):null);
 // Identical spellings can denote different senses or identities. Accept a
 // verified literal independently of dictionary choices, without borrowing
 // any dictionary entry ID or presenting it as a dictionary-backed sense.
 const option={choice_id:choiceId,type,
  replacement:aligned?.replacement||choiceId,entry_id:'experimental:'+type,
  definitions:['实验性模型词源：未经词典核实'],written_form:target.surface,origin_source:'model-unverified',
  ...(aligned?{segments:aligned.segments}:{})};
 try{
  const projected=projectAnnotation(target.context,{...target,...option});
  if(!projected.length||projected.some(a=>a.start<target.start||a.end>target.end))return null;
  if((type==='hanja'||type==='mixed')&&config.hanjaReadingCheck===true&&
     validateModelHanjaReadings(target.context,projected.filter(a=>a.type==='hanja')).status==='mismatch')return null;
 }catch{return null;}
 return option;
}


// Validation diagnostics only; never changes which model origins are accepted.
export function explainLiteralOriginRejection(target,choiceId,config={}){
 if(typeof choiceId!=='string'||!choiceId||choiceId.length>160||choiceId!==choiceId.trim()||RESERVED.test(choiceId))
  return 'invalid_choice_id';
 if(choiceId.toLowerCase()==='null')return 'quoted_json_null';
 if(target.options?.some(o=>o.type!=='keep'&&o.choice_id===choiceId))return 'known_choice_key';
 if(/[가-힣]/u.test(choiceId)&&/[\p{Script=Han}\p{Script=Latin}]/u.test(choiceId)){
  if(/\p{Script=Han}/u.test(choiceId)&&config.experimentalHanja!==true)return 'hanja_mode_disabled';
  if(/\p{Script=Latin}/u.test(choiceId)&&config.experimentalLoanword!==true)return 'loanword_mode_disabled';
  if(config.hanjaReadingCheck===true&&literalOriginOption(target,choiceId,{...config,hanjaReadingCheck:false}))
   return 'hanja_reading_conflict';
  return 'embedded_hangul_alignment_or_boundary';
 }
 if(/\p{Script=Han}/u.test(choiceId)&&/\p{Script=Latin}/u.test(choiceId))
  return 'mixed_script_requires_segments';
 const kind=CJK.test(choiceId)?'hanja':
  (LOANWORD.test(choiceId)&&/\p{Script=Latin}/u.test(choiceId))?'loanword':null;
 if(!kind)return /\p{Script=Latin}/u.test(choiceId)?(config.experimentalLoanword===true?'loanword_script_or_boundary':'loanword_mode_disabled'):'unsupported_choice_id';
 if(kind==='hanja'&&config.experimentalHanja!==true)return 'hanja_mode_disabled';
 if(kind==='loanword'&&config.experimentalLoanword!==true)return 'loanword_mode_disabled';
 if(!canProposeExperimentalOption(target,kind)){
  if(!/[가-힣]/u.test(target?.surface||'')||/\s/u.test(target?.surface||'')||target.scan_only===true)
   return 'partial_or_cross_word_boundary';
  return kind==='hanja'?'person_name_hanja_blocked':'source_boundary_or_name_blocked';
 }
 if(kind==='hanja'){
  if(config.hanjaReadingCheck===true&&literalOriginOption(target,choiceId,{...config,hanjaReadingCheck:false}))
   return 'hanja_reading_conflict';
  return 'hanja_alignment_or_boundary';
 }
 return 'loanword_script_or_boundary';
}

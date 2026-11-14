import {projectAnnotation} from './local-engine.js';
import {validateModelHanjaReadings} from './hanja-reading-check.js';

// Only describe origins the user actually enabled. This rule states the
// decision priority rather than suggesting a rarely-used optional feature.
export function buildExperimentalOriginInstructions(config={}){
 const hanja=config.experimentalHanja===true,loanword=config.experimentalLoanword===true;
 if(!hanja&&!loanword)return '';
 const origin=hanja&&loanword
  ?'genuine Hanja spelling of a Sino-Korean word or original Latin-script spelling of a borrowed word'
  :hanja?'genuine Hanja spelling of a Sino-Korean word'
         :'original Latin-script spelling of a borrowed word';
 const caution=hanja&&loanword
  ?'For Latin-script origins, proper nouns including foreign personal names may use an established original spelling, never a guessed romanization of a native Korean name. For Hanja, non-person proper nouns may use authentic spellings; personal-name Hanja may use ONLY a dictionary c key or a spelling in verified_person_hanja; do not generate unverified personal Hanja. Keep original source word boundaries and Hanja-to-syllable alignment.'
  :hanja?'Non-person proper nouns may use established Hanja origins. A personal name may use ONLY a matching dictionary c key or an exact verified_person_hanja spelling supplied by the local dictionary; otherwise return null. Preserve source word boundaries and syllable alignment.'
         :'Proper nouns, including identifiable foreign personal names, may use their established Latin-script original. Do not romanize native Korean names or guess identity. Preserve source word boundaries.';
 return [
  'OPEN-ENDED ORIGIN AUDIT: dictionary keys are only candidate meanings, not an exhaustive inventory of authentic origins. With an enabled origin type, an authentic Hanja/Latin spelling may be placed directly into results[].c.',
  'For EACH occurrence, FIRST infer its contextual meaning and actual etymological word boundaries; THEN compare every offered dictionary sense and origin, favoring a matching local c/n option key.',
  'Experimental origin-audit targets may have empty options because the local dictionary has no entry. These are NOT proof of a Sino-Korean or borrowed origin: propose only a genuine, contextually verified source spelling of an enabled script, otherwise JSON null. Never force Hanja for a native word or invent personal-name characters; for a dictionary-proven person, ONLY its supplied c option or verified_person_hanja spelling is valid.',
  'When no supplied dictionary sense matches and the authentic '+origin+' is reliably known, put that spelling directly in c, even when an offered dictionary sense has the same origin spelling. A raw origin is independent, unverified model evidence, NOT validation of that dictionary meaning; never invent a dictionary key or choose an unrelated meaning.',
  'Use actual JSON null for native words, unverified identity, unclear boundaries, or genuinely uncertain origins. A proper-noun tag alone is not grounds to return null; follow the enabled script and personal-name rules.',
  'Hanja must align with the Korean source; explicitly tagged native suffixes can be preserved. '+caution,
  'Output exactly one {t,c} row per target unless superseded by a validated segmentation repair; t matches target_id, c is an option key, genuine enabled source spelling, or JSON null.'
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
 if(typeof choiceId!=='string'||!choiceId||choiceId.length>160||choiceId!==choiceId.trim()||
    /[<>\x00-\x1f\x7f]/u.test(choiceId)||RESERVED.test(choiceId))return null;
 // Internal nonconversion/keep options are not model-visible sentinels.
 // A Latin original equal to a former keep marker remains valid.
 if(target.options?.some(o=>o.type!=='keep'&&o.choice_id===choiceId))return null;
 let type;
 if(CJK.test(choiceId)&&config.experimentalHanja===true)type='hanja';
 else if(LOANWORD.test(choiceId)&&/\p{Script=Latin}/u.test(choiceId)&&config.experimentalLoanword===true)type='loanword';
 else return null;
 if(!canProposeExperimentalOption(target,type))return null;
 const aligned=type==='hanja'?alignedHanjaStemSuffix(target,choiceId):null;
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
  if(type==='hanja'&&config.hanjaReadingCheck!==false&&validateModelHanjaReadings(target.context,projected).status==='mismatch')return null;
 }catch{return null;}
 return option;
}


// Validation diagnostics only; never changes which model origins are accepted.
export function explainLiteralOriginRejection(target,choiceId,config={}){
 if(typeof choiceId!=='string'||!choiceId||choiceId.length>160||choiceId!==choiceId.trim()||RESERVED.test(choiceId))
  return 'invalid_choice_id';
 if(target.options?.some(o=>o.type!=='keep'&&o.choice_id===choiceId))return 'known_choice_key';
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
  if(config.hanjaReadingCheck!==false&&literalOriginOption(target,choiceId,{...config,hanjaReadingCheck:false}))
   return 'hanja_reading_conflict';
  return 'hanja_alignment_or_boundary';
 }
 return 'loanword_script_or_boundary';
}

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
 const cautions=[
  ...(hanja?['For Hanja: a non-person proper noun may be given its reliably established Hanja origin, even when tagged NNP. Do not generate Hanja for actual or suspected personal names or personal-name homographs; use a verified dictionary choice when available, otherwise JSON null. Hanja syllables must align with the source.']:[]),
  ...(loanword?['For Latin-script origins: proper nouns, including people, organizations, brands and places, may use their authentic original spelling when the exact referent is established. A proper-noun or personal-name hint does not by itself forbid Latin origins. Never invent a spelling by romanizing Korean or guessing an identity.']:[])
 ];
 return [
  'OPEN-ENDED ORIGIN AUDIT: dictionary keys are only candidate meanings, not an exhaustive inventory of authentic origins. With an enabled origin type, an authentic Hanja/Latin spelling may be placed directly into results[].c.',
  'For EACH occurrence, FIRST infer its contextual meaning and actual etymological word boundaries; THEN compare every offered dictionary sense and origin, favoring a matching local c/n option key.',
  'When no supplied dictionary sense matches and the authentic '+origin+' is reliably known, put that spelling directly in c; never invent a dictionary key or choose an unrelated meaning.',
  'Use actual JSON null for native words, ambiguous identity, unclear boundaries, or genuinely uncertain origins. Do not default to null merely because the dictionary is incomplete.',
  ...cautions,
  'Preserve source word boundaries; explicit native suffixes may remain unchanged, but never merge unrelated words or infer arbitrary missing syllables.',
  'Output exactly one {t,c} row per target unless superseded by a validated segmentation repair; t matches target_id, c is an option key, genuine enabled source spelling, or JSON null.'
 ].join('\n');
}

const CJK=/^[\p{Script=Han}]+$/u;
const LOANWORD=/^[\p{Script=Latin}0-9][\p{Script=Latin}\p{M}0-9 .·'’()\/&+\-]*$/u;
const RESERVED=/^[cnxp]\d+$/i;
// A Kiwi proper-noun tag is not a personal-name identity. Latin spellings can
// identify people and other named entities; Hanja inventions must not assign
// arbitrary characters to a human name or a name/ordinary-word homograph.
export const canProposeExperimentalOption=(t,type='hanja')=>{
 if(!/[가-힣]/u.test(t?.surface||'')||t.scan_only===true||t.partial_word===true)return false;
 if(type==='loanword')return true;
 if(type==='hanja')return !(t.dictionary_person_name===true||
   t.dictionary_name_homograph===true||t.suspected_person_name===true);
 return false;
};

function splitAlignedHanja(surface,origin){
 // Pure Hanzi spelling of a multiword Korean phrase: retain *source* spaces.
 // No arbitrary guess of where a foreign loanword should be split.
 if(!/^[가-힣]+(?: [가-힣]+){1,3}$/u.test(surface))return null;
 const words=surface.split(' ');
 if([...origin].length!==words.join('').length)return null;
 const characters=[...origin],segments=[];let start=0,index=0;
 for(const word of words){
  const replacement=characters.slice(index,index+word.length).join('');
  segments.push({start,end:start+word.length,surface:word,type:'hanja',replacement});
  start+=word.length+1;index+=word.length;
 }
 return {replacement:segments.map(p=>p.replacement).join(' '),segments};
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
 const aligned=type==='hanja'?(splitAlignedHanja(target.surface,choiceId)||
   alignedHanjaStemSuffix(target,choiceId)):null;
 // Existing dictionary spellings must be selected by their supplied c/n key.
 // A literal spelling must not bypass sense/POS competition or make an
 // already-known etymology look like independent model evidence.
 if(target.options?.some(o=>o.type===type&&o.replacement===(aligned?.replacement||choiceId)))return null;
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
 if(CJK.test(choiceId)){
  if(config.experimentalHanja!==true)return 'hanja_mode_disabled';
  if(!canProposeExperimentalOption(target,'hanja'))return 'personal_name_hanja_or_partial_word';
  // A structurally valid choice that fails solely because of the reading
  // table must be distinguishable from impossible character/word alignment.
  if(config.hanjaReadingCheck!==false&&literalOriginOption(target,choiceId,{...config,hanjaReadingCheck:false}))
   return 'hanja_reading_conflict';
  return 'hanja_alignment_or_boundary';
 }
 if(/\p{Script=Latin}/u.test(choiceId)){
  if(config.experimentalLoanword!==true)return 'loanword_mode_disabled';
  if(!canProposeExperimentalOption(target,'loanword'))return 'partial_word_or_scan_only';
  return 'loanword_script_or_boundary';
 }
 return 'unsupported_choice_id';
}

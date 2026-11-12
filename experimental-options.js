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
  ?'Preserve source word boundaries and Hanja-to-syllable alignment; do not translate, romanize, or guess personal names or uncertain origins.'
  :hanja?'Preserve source word boundaries and Hanja-to-syllable alignment; never guess personal-name Hanja or uncertain origins.'
         :'Use the actual borrowed spelling, not a translation or Korean romanization; preserve source word boundaries and never guess names or uncertain origins.';
 return [
  'OPEN-ENDED ORIGIN AUDIT WITH DICTIONARY OPTIONS: the listed dictionary keys are candidates, NOT an exhaustive list of possible etymologies. Direct Hanja/Latin spellings are valid choice_id values when their experimental origin type is enabled.',
  'For EACH occurrence, FIRST infer its meaning, lexical word boundaries and whether it is native Korean, Sino-Korean or borrowed FROM THE ORIGINAL SENTENCE AND MORPHOLOGY, independently of the candidate list. If the authentic origin is reliably known, keep it in mind before reading the dictionary options.',
  'SECOND compare EACH offered dictionary definition, POS and origin with that independent interpretation. Choose the target-specific c/n dictionary KEY when a supplied sense and origin really match; this is preferred over rewriting the same correct etymology. A plausible-looking homograph, near meaning or wrong word sense is NOT a match.',
  'THIRD, if NO supplied dictionary option correctly represents this occurrence AND you confidently know the authentic '+origin+', write its ORIGINAL Hanja characters or borrowed Latin-script spelling DIRECTLY into results[].choice_id. Do not default to KEEP and do not choose a mismatching dictionary key merely because options contains keys. This is still valid when options includes c0/c1/n0 as well as KEEP.',
  'Use KEEP only for a native word without a suitable dictionary nonconversion sense, a protected name or unclear word boundary, or when neither a matching dictionary sense nor a reliable origin is available. Do not invent an origin to increase the proportion of direct answers.',
  'Hanja origin must follow Korean character/word alignment; for explicitly tagged derivational suffixes (Kiwi XSN/XSM), give the genuine Hanja stem only and preserve the native Korean suffix. Never truncate an unrecognized component. '+caution,
  'Output exactly one result per target, with the original target_id and a choice_id that is either a matching dictionary option KEY, an enabled authentic Hanja/Latin origin string, or KEEP. Never return the shared p ID or invent a candidate ID.'
 ].join('\n');
}

const CJK=/^[\p{Script=Han}]+$/u;
const LOANWORD=/^[\p{Script=Latin}0-9][\p{Script=Latin}\p{M}0-9 .·'’()\/&+\-]*$/u;
const RESERVED=/^(?:KEEP|[cnxp]\d+)$/i;
export const canProposeExperimentalOption=t=>/[가-힣]/u.test(t?.surface||'')&&
 !(t.scan_only===true||t.proper_noun===true||t.dictionary_person_name===true||t.dictionary_name_homograph===true||
   t.suspected_person_name===true||t.partial_word===true);

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
    /[<>\x00-\x1f\x7f]/u.test(choiceId)||RESERVED.test(choiceId)||!canProposeExperimentalOption(target))return null;
 // A known dictionary key (including KEEP) MUST be resolved by dictionary
 // selection, never interpreted as an invented etymology.
 if(target.options?.some(o=>o.choice_id===choiceId))return null;
 let type;
 if(CJK.test(choiceId)&&config.experimentalHanja===true)type='hanja';
 else if(LOANWORD.test(choiceId)&&/\p{Script=Latin}/u.test(choiceId)&&config.experimentalLoanword===true)type='loanword';
 else return null;
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
 if(!canProposeExperimentalOption(target))return 'protected_name_or_partial_word';
 if(typeof choiceId!=='string'||!choiceId||choiceId.length>160||choiceId!==choiceId.trim()||RESERVED.test(choiceId))
  return 'invalid_choice_id';
 if(target.options?.some(o=>o.choice_id===choiceId))return 'known_choice_key';
 if(/\p{Script=Han}/u.test(choiceId)&&/\p{Script=Latin}/u.test(choiceId))
  return 'mixed_script_requires_segments';
 if(CJK.test(choiceId)){
  if(config.experimentalHanja!==true)return 'hanja_mode_disabled';
  // A structurally valid choice that fails solely because of the reading
  // table must be distinguishable from impossible character/word alignment.
  if(config.hanjaReadingCheck!==false&&literalOriginOption(target,choiceId,{...config,hanjaReadingCheck:false}))
   return 'hanja_reading_conflict';
  return 'hanja_alignment_or_boundary';
 }
 if(/\p{Script=Latin}/u.test(choiceId))
  return config.experimentalLoanword===true?'loanword_script_or_boundary':'loanword_mode_disabled';
 return 'unsupported_choice_id';
}

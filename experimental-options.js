import {projectAnnotation} from './local-engine.js';

// A normal dictionary choice_id (KEEP, c0, n0...) or a literal origin spelling
// shares the SAME results[] field. There is no second experimental_options list.
export const EXPERIMENTAL_REVIEW_INSTRUCTIONS = "When experimental_modes enables Hanja and/or loanwords, return exactly ONE JSON object with results only: {\"results\":[{\"target_id\":\"t0\",\"choice_id\":\"原潛\"},{\"target_id\":\"t1\",\"choice_id\":\"game\"},{\"target_id\":\"t2\",\"choice_id\":\"c0\"},{\"target_id\":\"t3\",\"choice_id\":\"KEEP\"}]}. Choose an existing target-local dictionary choice_id (KEEP, n0, c0, etc.) when its definition AND etymology match. Only if NO existing option fits and you reliably know the actual origin spelling of THIS SAME Korean word, put that origin DIRECTLY as choice_id: bare Chinese characters for Hanja or the actual Latin-script original spelling for loanwords. Never return p0/p1 candidate pool IDs, invented c/n/x IDs, translations, romanizations, explanatory prose, proposals, or an experimental_options array. Do not add any properties to a result item. Do not generate origin spellings for proper_noun, suspected_person_name, dictionary_person_name, dictionary_name_homograph, or partial_word targets. Do not generate names from pronunciation; no guessing. Do not change or infer target IDs, word boundaries or offsets. Only write a literal origin if the corresponding experimental mode is enabled and the source surface is genuinely that lexical word; otherwise choose KEEP. For Hanja write the genuine Chinese characters with one-to-one Korean syllable alignment; for loanwords write the original foreign orthography, NOT an English translation. When uncertain, KEEP. Return one result for every target and no other keys than results (and the unchanged batch_id in manual requests).";

const CJK=/^[\p{Script=Han}]+$/u;
const LOANWORD=/^[\p{Script=Latin}0-9][\p{Script=Latin}\p{M}0-9 .·'’()\/&+\-]*$/u;
const RESERVED=/^(?:KEEP|[cnxp]\d+)$/i;
export const canProposeExperimentalOption=t=>/[가-힣]/u.test(t?.surface||'')&&
 !(t.proper_noun===true||t.dictionary_person_name===true||t.dictionary_name_homograph===true||
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
 const aligned=type==='hanja'?splitAlignedHanja(target.surface,choiceId):null;
 // Existing dictionary spellings must be selected by their supplied c/n key.
 // A literal spelling must not bypass sense/POS competition or make an
 // already-known etymology look like independent model evidence.
 if(target.options.some(o=>o.type===type&&o.replacement===(aligned?.replacement||choiceId)))return null;
 const option={choice_id:choiceId,type,
  replacement:aligned?.replacement||choiceId,entry_id:'experimental:'+type,
  definitions:['实验性模型词源：未经词典核实'],written_form:target.surface,
  ...(aligned?{segments:aligned.segments}:{})};
 try{
  const projected=projectAnnotation(target.context,{...target,...option});
  if(!projected.length||projected.some(a=>a.start<target.start||a.end>target.end))return null;
 }catch{return null;}
 return option;
}

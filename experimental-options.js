import {projectAnnotation} from './local-engine.js';

// A model may optionally write a literal origin in the existing choice_id.
// Include each rule only if its own feature switch is enabled.
export const HANJA_ORIGIN_INSTRUCTIONS =
 "If no supplied dictionary sense fits and you know the genuine Sino-Korean origin, you may write its Hanja characters directly as choice_id instead of a dictionary key. Preserve the Korean word boundaries and align Hanja to its syllables; never guess a personal name.";

export const LOANWORD_ORIGIN_INSTRUCTIONS =
 "If no supplied dictionary sense fits and you know the genuine borrowed spelling, you may write its Latin-script original directly as choice_id instead of a dictionary key. Use the original word, not an English translation or romanization.";

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

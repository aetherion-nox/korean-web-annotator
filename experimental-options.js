import {projectAnnotation} from './local-engine.js';

// This is a separate, optional proposal round. The ordinary selection response
// remains {results:[{target_id,choice_id}]} and never carries replacement text.
export const EXPERIMENTAL_PROPOSAL_INSTRUCTIONS = "You are verifying whether the supplied Korean dictionary senses are incomplete. This is NOT a translation or text rewriting task. The targets are fixed by the local tokenizer: NEVER split, merge, extend, move, or invent a target or offset. The main sense selector has already returned KEEP for these targets. KEEP can mean either missing senses or uncertainty; uncertainty ALONE is not a reason to propose an origin. Read EVERY supplied dictionary definition before proposing anything. If any supplied sense genuinely fits, or the evidence is weak, return proposal:null. Only propose an independently plausible, specific etymological spelling for the SAME word and meaning in context. For hanja, give actual Sino-Korean characters corresponding to the Korean syllables, preserving any unchanged Korean material, and do not invent Hanja for names. For loanword, give the original foreign-language orthography of the borrowed word, NOT an English translation or English equivalent. Do not propose person names, speculative organizations or named entities, or mere topic-related terms. If the target is a proper noun, suspected name, a name homograph or partial_word, return null. Proposals must include a concise definition of this EXACT sense. Use only the enabled modes specified in experimental_modes, and never return a proposal outside those modes. Return only JSON {\"results\":[{\"target_id\":\"...\",\"proposal\":null},{\"target_id\":\"...\",\"proposal\":{\"type\":\"hanja\",\"replacement\":\"...\",\"definition\":\"...\"}}]} with exactly one row for every supplied target. No replacement may alter target boundaries. No extra text.";
export const EXPERIMENTAL_CHOICE_INSTRUCTIONS = "Some options may now have entry_id beginning with experimental:. Such options are model-proposed, NOT dictionary-attested and NOT inherently trustworthy. Prefer an existing dictionary option when its exact definition and origin fit. Select an experimental option only when none of the dictionary senses fit AND its spelling genuinely represents the target's etymology in context; otherwise choose KEEP. Never infer a proposed spelling merely from its gloss. Return only the original choice_id JSON format.";

const CJK=/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{323af}]/u;
const LOANWORD=/^[\p{Script=Latin}0-9][\p{Script=Latin}\p{M}0-9 .·'’()\/&+\-]*$/u;
const unsafe=t=>t.proper_noun===true||t.dictionary_person_name===true||t.dictionary_name_homograph===true||t.suspected_person_name===true||t.partial_word===true;

export function appendExperimentalOptions(targets,response,{experimentalHanja=false,experimentalLoanword=false}={}){
 const rows=Array.isArray(response?.results)?response.results:[];
 const ids=new Set(targets.map(t=>t.target_id));
 if(rows.length!==targets.length||rows.some(r=>!r||typeof r.target_id!=='string'||!ids.has(r.target_id))||new Set(rows.map(r=>r.target_id)).size!==rows.length)return [];
 const byId=new Map(rows.map(r=>[r.target_id,r]));
 const expanded=[];
 for(const target of targets){
  if(unsafe(target)||!/[가-힣]/u.test(target.surface))continue;
  const row=byId.get(target.target_id);
  if(!row||!Object.hasOwn(row,'proposal'))continue;
  const proposal=row.proposal;
  if(!proposal||typeof proposal!=='object'||Array.isArray(proposal))continue;
  if(Object.keys(proposal).sort().join(',')!=='definition,replacement,type')continue;
  const {type,replacement,definition}=proposal;
  if(type!=='hanja'&&type!=='loanword')continue;
  if(type==='hanja'&&!experimentalHanja||type==='loanword'&&!experimentalLoanword)continue;
  if(typeof replacement!=='string'||replacement.length>160||!replacement.trim()||typeof definition!=='string'||!definition.trim()||definition.length>240)continue;
  if(replacement!==replacement.trim()||/[<>\x00-\x1f\x7f]/u.test(replacement))continue;
  if(type==='hanja'&&!CJK.test(replacement))continue;
  if(type==='loanword'&&(!LOANWORD.test(replacement)||!/\p{Script=Latin}/u.test(replacement)))continue;
  if(target.options.some(o=>o.type===type&&o.replacement===replacement))continue;
  const existing=new Set(target.options.map(o=>o.choice_id));let n=0;
  while(existing.has('x'+n))n++;
  const option={choice_id:'x'+n,type,replacement,entry_id:'experimental:'+type,definitions:[definition.trim()],written_form:target.surface};
  // Reuse the exact original offset and alignment checks. No segmentation or
  // arbitrary single-syllable Hanja changes outside the existing source span.
  try{
   const annotations=projectAnnotation(target.context,{...target,...option});
   if(!annotations.length||annotations.some(a=>a.start<target.start||a.end>target.end))continue;
  }catch{continue;}
  expanded.push({...target,options:[...target.options,option]});
 }
 return expanded;
}

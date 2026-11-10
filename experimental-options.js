import {projectAnnotation} from './local-engine.js';

// The experimental option list and the final choice list travel in ONE answer.
// x0/x1/x2 are local to each target, just like ordinary c0/n0 keys.
export const EXPERIMENTAL_REVIEW_INSTRUCTIONS = "When experimental_modes enables Hanja or loanwords, return one JSON object with experimental_options FIRST and results SECOND. The two arrays belong to the same review decision; do NOT wait to choose KEEP before considering missing origins. Read ALL provided dictionary senses and definitions before proposing a candidate. Propose only when none of the dictionary options fits this occurrence and you independently know the specific etymological spelling of this SAME Korean word. No guessing, translation equivalents, topical associations, or reconstructed name spellings. For Hanja use the actual Sino-Korean characters in the same Korean word boundaries (leave Korean suffixes unchanged); for loanwords use the actual foreign original orthography, not an English translation. Never invent, split, merge, extend or shift target IDs or source offsets. Do not propose for proper_noun, suspected_person_name, dictionary_person_name, dictionary_name_homograph, or partial_word targets. Each experimental_options item MUST have exactly target_id, choice_id (x0, then x1/x2 for that SAME target), type (hanja or loanword), replacement and definition. Supply at most three well-supported proposals per target; omit targets that need no new option. Options may only use enabled experimental_modes. Use an empty experimental_options array when none are warranted. Then produce EXACTLY one results item for EVERY target, choosing only its original KEEP/n0/c0 keys or its own proposed x0/x1/x2 key. Prefer an applicable dictionary sense over a proposal; an unverified proposed origin is NOT established dictionary evidence. If no matching spelling/meaning is reliable, choose KEEP. JSON structure: {\"experimental_options\":[{\"target_id\":\"t0\",\"choice_id\":\"x0\",\"type\":\"hanja\",\"replacement\":\"漢字\",\"definition\":\"precise meaning\"}],\"results\":[{\"target_id\":\"t0\",\"choice_id\":\"x0\"}]}. Return only the complete JSON with experimental_options BEFORE results; never include replacement strings in results.";

const CJK=/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{323af}]/u;
const LOANWORD=/^[\p{Script=Latin}0-9][\p{Script=Latin}\p{M}0-9 .·'’()\/&+\-]*$/u;
const unsafe=t=>t.proper_noun===true||t.dictionary_person_name===true||t.dictionary_name_homograph===true||t.suspected_person_name===true||t.partial_word===true;

export function expandExperimentalOptions(targets,response,{experimentalHanja=false,experimentalLoanword=false}={}){
 const rows=response?.experimental_options;
 if(!Array.isArray(rows))return {targets,added:0,rejected:0,fatal:true};
 const ids=new Map(targets.map(t=>[t.target_id,t]));
 if(rows.length>targets.length*3)return {targets,added:0,rejected:rows.length,fatal:true};
 const seen=new Set(),additions=new Map();
 let rejected=0;
 for(const row of rows){
  if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.target_id!=='string'||!ids.has(row.target_id))
   return {targets,added:0,rejected:rows.length,fatal:true};
  // Duplicate target-local choice IDs are not resolvable. Reject the response.
  const slot=row.target_id+'\0'+String(row.choice_id);
  if(seen.has(slot))return {targets,added:0,rejected:rows.length,fatal:true};
  seen.add(slot);
  if(Object.keys(row).sort().join(',')!=='choice_id,definition,replacement,target_id,type'){rejected++;continue;}
  const {choice_id,type,replacement,definition}=row;
  if(!/^x[012]$/.test(choice_id)||type!=='hanja'&&type!=='loanword'
   ||type==='hanja'&&!experimentalHanja||type==='loanword'&&!experimentalLoanword){rejected++;continue;}
  const target=ids.get(row.target_id);
  if(unsafe(target)||!/[가-힣]/u.test(target.surface)){rejected++;continue;}
  if(typeof replacement!=='string'||!replacement.trim()||replacement.length>160||replacement!==replacement.trim()
    ||typeof definition!=='string'||!definition.trim()||definition.length>240||/[<>\x00-\x1f\x7f]/u.test(replacement)){rejected++;continue;}
  if(type==='hanja'&&!CJK.test(replacement)||type==='loanword'&&(!LOANWORD.test(replacement)||!/\p{Script=Latin}/u.test(replacement))){rejected++;continue;}
  const existing=additions.get(row.target_id)||[];
  if(choice_id!=='x'+existing.length||target.options.some(o=>o.choice_id===choice_id||o.type===type&&o.replacement===replacement)
   ||existing.some(o=>o.type===type&&o.replacement===replacement)){rejected++;continue;}
  const option={choice_id,type,replacement,entry_id:'experimental:'+type,definitions:[definition.trim()],written_form:target.surface};
  // Reuse the exact local source-span and Hanja alignment checks.
  try{
   const annotations=projectAnnotation(target.context,{...target,...option});
   if(!annotations.length||annotations.some(a=>a.start<target.start||a.end>target.end)){rejected++;continue;}
  }catch{rejected++;continue;}
  additions.set(row.target_id,[...existing,option]);
 }
 let added=0;
 const expanded=targets.map(t=>{
  const extras=additions.get(t.target_id);
  if(!extras)return t;
  added+=extras.length;
  return {...t,options:[...t.options,...extras]};
 });
 return {targets:expanded,added,rejected,fatal:false};
}

// Convenience: changed targets only, for diagnostics and isolated tests.
export function appendExperimentalOptions(targets,response,config={}){
 const parsed=expandExperimentalOptions(targets,response,config);
 return parsed.fatal?[]:parsed.targets.filter((t,i)=>t!==targets[i]);
}

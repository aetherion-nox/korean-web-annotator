import {filterReviewTargets,canTrimReviewMorphology} from './review-pos.js';
import {HANJA_ORIGIN_INSTRUCTIONS,LOANWORD_ORIGIN_INSTRUCTIONS} from './experimental-options.js';

// Concise common rules. The optional origin clauses are separate and conditional.
export const REVIEW_INSTRUCTIONS = [
 "Review Korean word occurrences for dictionary-origin annotation; do not translate or rewrite freely.",
 "For each target, read its sentence and candidate definitions. Select a dictionary sense only when its meaning, grammatical use and origin fit this exact occurrence. Topic similarity, a familiar spelling, or the number of candidates is not evidence. Do not force a mismatching origin.",
 "Dictionary nonconversion senses (n0, etc.) keep Korean and must be chosen when their meaning fits; missing etymology alone does not make a sense native. KEEP means uncertain or no supported sense; do not use KEEP to avoid a confirmed conversion or a confirmed nonconversion sense.",
 "Input is pooled: targets[].sentence_id identifies sentences[].text; each target's options maps its own choice_id keys to candidates[].candidate_id. KEEP maps to null. For dictionary choices return the target's option KEY, not its pooled candidate_id. Use context and adjacent_context only to interpret the occurrence; start/end refer to the target sentence in UTF-16 offsets, not neighboring text.",
 "Names need exact identity evidence. A proper_noun flag is only a tokenizer hint. For dictionary_person_name, dictionary_name_homograph or suspected_person_name, distinguish names from same-spelling common words; never assign an unrelated person's or ordinary word's Hanja to an unlisted name. Treat historical namesakes, places and organizations cautiously.",
 "Morphology and POS hints can be wrong. For pos_conflict recheck actual usage; for partial_word require the sense to apply to that precise component of the full word. Similar dictionary spellings, grammatical forms, and neighboring words are not interchangeable. Equivalent visible evidence should yield consistent decisions.",
 'Return only JSON {"results":[{"target_id":"...","choice_id":"..."}]} with exactly one result for every target. Keep target_id unchanged; no explanations or extra fields.'
].join("\n");

export function buildReviewInstructions(config={}){
 return [
  REVIEW_INSTRUCTIONS,
  ...(config.experimentalHanja===true?[HANJA_ORIGIN_INSTRUCTIONS]:[]),
  ...(config.experimentalLoanword===true?[LOANWORD_ORIGIN_INSTRUCTIONS]:[])
 ].join("\n");
}

export function buildManualPrompt(context,targets,batchId,config={}){
 const {payload}=buildReviewPayload(context||'',targets,config);
 if(batchId!==undefined)payload.batch_id=batchId;
 const batchInstruction=batchId===undefined?'':'Copy batch_id from the input unchanged into the top level of the answer.\n';
 return buildReviewInstructions(config)+'\n'+batchInstruction+JSON.stringify(payload);
}
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
export function buildReviewPayload(context,targets,config={}){
 const originalOptionCount=targets.reduce((n,t)=>n+t.options.length,0);
 targets=filterReviewTargets(targets,config);
 const sentences=[],candidates=[],sentenceIds=new Map(),candidateIds=new Map();
 const packedTargets=targets.map(target=>{
  const text=target.context;
  const adjacent_context=target.adjacent_context;
  const sentenceKey=JSON.stringify([text,adjacent_context?.before||'',adjacent_context?.after||'']);
  if(!sentenceIds.has(sentenceKey)){const sentence_id=`s${sentences.length}`;sentenceIds.set(sentenceKey,sentence_id);sentences.push({sentence_id,text,...(adjacent_context?{adjacent_context}:{})});}
  const options=Object.fromEntries(target.options.map(option=>{
   if(option.type==='keep')return ['KEEP',null];
   const {choice_id,...meaning}=option;
   const key=JSON.stringify(canonical(meaning));
   if(!candidateIds.has(key)){const candidate_id=`p${candidates.length}`;candidateIds.set(key,candidate_id);candidates.push({candidate_id,...meaning});}
   return [choice_id,candidateIds.get(key)];
  }));
  const {context:unused,adjacent_context:unusedAdjacent,options:oldOptions,...occurrence}=target;
  // The local POS filter has already checked these tags. Preserve unknown/conflicting evidence.
  if(canTrimReviewMorphology(target,config)){
   if(target.morphology.length===1&&target.morphology[0].form===target.surface&&target.morphology[0].start===target.start&&target.morphology[0].end===target.end){
    delete occurrence.morphology;
   }else{
    occurrence.morphology=target.morphology.map(({tag,...part})=>part);
   }
  }
  return {...occurrence,sentence_id:sentenceIds.get(sentenceKey),options};
 });
 const payload={format:'shared-pools-v3',context,sentences,candidates,targets:packedTargets};
 const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
 const userBytes=bytes(payload),legacyUserBytes=bytes({context,targets});
 const stats={posFilteredOptions:originalOptionCount-targets.reduce((n,t)=>n+t.options.length,0),posConflictTargets:targets.filter(t=>t.pos_conflict).length,format:payload.format,targets:targets.length,sentences:sentences.length,candidates:candidates.length,userBytes,legacyUserBytes,savedPercent:Math.round((1-userBytes/legacyUserBytes)*1000)/10};
 return {payload,stats};
}

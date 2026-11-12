import {filterReviewTargets,canTrimReviewMorphology} from './review-pos.js';
import {buildExperimentalOriginInstructions} from './experimental-options.js';
import {SMART_SEGMENTATION_INSTRUCTIONS} from './smart-segmentation-prompt.js';

// Concise common rules. The optional origin clauses are separate and conditional.
export const REVIEW_INSTRUCTIONS = [
 "Review Korean word occurrences for dictionary-origin annotation; do not translate or rewrite freely.",
 "For each target, first determine its meaning from the sentence and context; then check the supplied dictionary definitions, grammatical use and origins against that meaning. Select a dictionary sense only when it actually fits. Never choose a semantically mismatching candidate merely because it has the same Korean spelling or appears closest.",
 "Dictionary nonconversion senses (n0, etc.) keep Korean and must be chosen when their meaning fits; missing etymology alone does not make a sense native. KEEP is the fallback when no reliable match or origin is available. Do not use KEEP to avoid a confirmed conversion or nonconversion sense.",
 "Input is pooled: targets[].sentence_id identifies sentences[].text; each target's options maps its own choice_id keys to candidates[].candidate_id. KEEP maps to null. For dictionary choices return the target's option KEY, not its pooled candidate_id. Use context and adjacent_context only to interpret the occurrence; start/end refer to the target sentence in UTF-16 offsets, not neighboring text.",
 "Names need exact identity evidence. A proper_noun flag is only a tokenizer hint. For dictionary_person_name, dictionary_name_homograph or suspected_person_name, distinguish names from same-spelling common words; never assign an unrelated person's or ordinary word's Hanja to an unlisted name. Treat historical namesakes, places and organizations cautiously.",
 "Morphology and POS hints can be wrong. For pos_conflict recheck actual usage; for partial_word require the sense to apply to that precise component of the full word. Similar dictionary spellings, grammatical forms, and neighboring words are not interchangeable. Equivalent visible evidence should yield consistent decisions.",
 'Return only JSON {"results":[{"target_id":"...","choice_id":"..."}]} with exactly one result for every target. Keep target_id unchanged; no explanations or extra fields.'
].join("\n");

export function buildReviewInstructions(config={}){
 const experimental=buildExperimentalOriginInstructions(config);
 // The ordinary results-only schema must not contradict optional repairs.
 const dictionaryFree=config.dictionaryFree===true;
 const allowedOrigins=[
   ...(config.experimentalHanja===true?['genuine Hanja spelling of Sino-Korean vocabulary']:[]),
   ...(config.experimentalLoanword===true?['actual Latin-script original of a borrowed word']:[])
 ];
 const dictionaryFreeInstructions=[
   'OPEN-ENDED KOREAN WORD ORIGIN ANNOTATION. No external dictionary has been imported, so the input lists only KEEP. This does NOT mean KEEP is the only valid choice_id.',
   'For EACH target, actively determine whether its occurrence is a Sino-Korean word or a borrowed word from the actual sentence, then infer the authentic source spelling. When the origin is reliably known, write the source spelling DIRECTLY as results[].choice_id; do not default to KEEP because the spelling is missing from options.',
   'Permitted generated source types in THIS batch: '+(allowedOrigins.join(' OR ')||'none')+'. Do not output source types that are not enabled.',
   'For Hanja, use the genuine etymological Chinese characters whose Korean readings align with the original syllables. If a target contains an explicitly tagged Korean derivational suffix (Kiwi XSN/XSM), write the Hanja for the stem only; retain the native Korean suffix. Never truncate arbitrary syllables to force a match. For Latin-script loans, use the genuine borrowed spelling, NOT a free translation, invented English expression, or Korean romanization.',
   'KEEP is a fallback for genuinely native Korean, prohibited names, uncertain/misidentified word boundaries, or origins you cannot reliably identify. Do not mark an identifiable Hanja/loanword as KEEP merely because options contains no c0 or other dictionary keys.',
   'Kiwi segmentation and POS are hints, not evidence of etymology. Preserve the exact original target_id and source boundaries. Do not guess personal names, invent character readings or force an origin on ordinary native vocabulary.',
   'The options object contains KEEP as a safe fallback only. This is NOT a closed multiple-choice task: valid choice_id values are KEEP or a directly written original spelling of an ENABLED source type. Use the context, sentences, morphology and adjacent context to interpret each occurrence.',
   'Return one JSON object with exactly one {target_id,choice_id} per target, and no commentary. Do not copy the input format/candidates/targets fields.'
 ].join('\n');
 const base=dictionaryFree?dictionaryFreeInstructions:config.smartSegmentation===true
  ?REVIEW_INSTRUCTIONS.replace(
    'Return only JSON {"results":[{"target_id":"...","choice_id":"..."}]} with exactly one result for every target. Keep target_id unchanged; no explanations or extra fields.',
    'Return one JSON object with results for each original target NOT superseded by a validated repair (omit scan_only placeholders), plus optional repairs. A valid repair replaces its old target choices atomically; invalid repairs leave those old choices required. Keep IDs unchanged. No explanations or unrelated fields.')
  :REVIEW_INSTRUCTIONS;
 // Lead with independent origin assessment only in the experimental
 // dictionary-backed mode. Ordinary dictionary review remains unchanged.
 return [...(experimental&&!dictionaryFree?[experimental]:[]),base,
 ...(config.smartSegmentation===true?[SMART_SEGMENTATION_INSTRUCTIONS]:[])].join("\n");
}

export function buildManualPrompt(context,targets,batchId,config={}){
 const {payload}=buildReviewPayload(context||'',targets,config);
 if(batchId!==undefined)payload.batch_id=batchId;
 const experimental=config.experimentalHanja===true||config.experimentalLoanword===true;
 const batchInstruction=batchId===undefined?'':[
  'Output JSON only: top-level batch_id and results'+(config.smartSegmentation===true?' (plus optional repairs).':'.'),
  'The input format marker shared-pools-v3 is NOT a response field; do not copy format, sentences, candidates, targets, or context into the output.',
  config.smartSegmentation===true?
   'Return exactly one {target_id,choice_id} for each original target you have NOT replaced or deleted via a valid repair; omit results for retired targets and scan_only placeholders. If unsure the repair is valid, retain the original choice as fallback. Never duplicate, invent or renumber IDs.':
   'Return EXACTLY ONE {target_id,choice_id} for EACH target_id in the current request. Copy IDs character-for-character, never renumber, invent or repeat IDs.',
  config.dictionaryFree===true?'OPEN-ENDED answer: options.KEEP is only a fallback, NOT the complete list. For each reliably identified word you SHOULD write the actual Hanja or Latin origin directly as choice_id (only enabled origin types). Choose KEEP for native or genuinely uncertain origins. Never invent c0/n0/p0.':
   experimental?'OPEN-ENDED origin audit: FIRST judge meaning and authentic origin independently, THEN compare dictionary senses. For a matching dictionary sense use its target-specific c/n key. If ALL senses mismatch and the authentic enabled Hanja/Latin origin is reliable, write that original spelling directly as choice_id; KEEP only when unresolved. Options is NOT the complete set; NEVER return shared candidate p IDs.':
   'For dictionary senses use the target-specific choice key (c/n etc.), never the shared candidate p ID. If uncertain choose KEEP.',
  'Copy batch_id from the input unchanged into the top level of the answer. Before finishing, internally verify no IDs are omitted or duplicated. Do not add commentary.',
  ''
 ].join('\n');
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
  const sentenceKey=JSON.stringify([text,adjacent_context?.before||'',adjacent_context?.after||'',...(config.smartSegmentation===true?[target.repair_sentence_key||'']:[])]);
  if(!sentenceIds.has(sentenceKey)){const sentence_id=`s${sentences.length}`;sentenceIds.set(sentenceKey,sentence_id);sentences.push({sentence_id,text,...(adjacent_context?{adjacent_context}:{}),...(config.smartSegmentation===true?{
   // Shared once per sentence, compact tuples rather than repeating field names.
   kiwi_tokens:(target.repair_context?.kiwi_tokens||[]).map(t=>[t.form,t.tag,t.start,t.end]),
   protected_ranges:target.repair_context?.protected_ranges||[]
  }: {})});}
  const options=Object.fromEntries(target.options.map(option=>{
   if(option.type==='keep')return ['KEEP',null];
   const {choice_id,...meaning}=option;
   const key=JSON.stringify(canonical(meaning));
   if(!candidateIds.has(key)){const candidate_id=`p${candidates.length}`;candidateIds.set(key,candidate_id);candidates.push({candidate_id,...meaning});}
   return [choice_id,candidateIds.get(key)];
  }));
  const {context:unused,adjacent_context:unusedAdjacent,options:oldOptions,repair_context:unusedRepair,repair_sentence_key:unusedKey,original_target_id:unusedOriginal,...occurrence}=target;
  if(config.smartSegmentation===true&&target.scan_only===true)delete occurrence.surface;
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
 const experimental=config.experimentalHanja===true||config.experimentalLoanword===true;
 const payload={format:'shared-pools-v3',...(experimental?{
  choice_id_mode:'open-origin',
  allowed_origin_types:[...(config.experimentalHanja===true?['hanja']:[]),...(config.experimentalLoanword===true?['loanword']:[])],
  ...(config.dictionaryFree===true?{keep_is_fallback_only:true}:{dictionary_options_are_not_exhaustive:true})
 }:{}),...(config.smartSegmentation===true?{}:{context}),sentences,candidates,targets:packedTargets};
 const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
 const userBytes=bytes(payload),legacyUserBytes=bytes({context,targets});
 const stats={posFilteredOptions:originalOptionCount-targets.reduce((n,t)=>n+t.options.length,0),posConflictTargets:targets.filter(t=>t.pos_conflict).length,format:payload.format,targets:targets.length,sentences:sentences.length,candidates:candidates.length,userBytes,legacyUserBytes,savedPercent:Math.round((1-userBytes/legacyUserBytes)*1000)/10};
 return {payload,stats};
}

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
 const dictionaryFreeInstructions=[
   'No external dictionary has been imported. Kiwi supplies tentative Korean word boundaries and POS hints only; they are NOT dictionary senses or etymological evidence.',
   'Each target has KEEP but no dictionary candidate. If you confidently recognize a genuine Korean Sino-word origin and Hanja is enabled, write its actual Hanja characters directly in choice_id. If you confidently recognize the original Latin-script loanword spelling and loanword mode is enabled, write that original spelling. Never fabricate dictionary option IDs.',
   'If the word is native Korean, is not a target language type, is a person/place name without identity evidence, or its origin is uncertain, choose KEEP. Do not translate or romanize Korean words into arbitrary English/Latin or convert a semantically related character word. Be conservative.',
   'Use the sentence and adjacent context to interpret each occurrence. Kiwi segmentation may be wrong; avoid arbitrary pieces, names and overlapping spans. Hanja must align with the actual Hangul syllables. Keep target_id exactly as given.',
   'Input uses pooled sentences and targets; options.KEEP=null. Return only JSON with results containing exactly one {target_id,choice_id} per target; do not return input metadata.'
 ].join('\n');
 const base=dictionaryFree?dictionaryFreeInstructions:config.smartSegmentation===true
  ?REVIEW_INSTRUCTIONS.replace(
    'Return only JSON {"results":[{"target_id":"...","choice_id":"..."}]} with exactly one result for every target. Keep target_id unchanged; no explanations or extra fields.',
    'Return one JSON object with results containing exactly one {target_id,choice_id} per original target, plus optional repairs for genuine segmentation errors. Keep target_id unchanged. No explanations or unrelated fields.')
  :REVIEW_INSTRUCTIONS;
 return [base,...(experimental&&!dictionaryFree?[experimental]:[]),
 ...(config.smartSegmentation===true?[SMART_SEGMENTATION_INSTRUCTIONS]:[])].join("\n");
}

export function buildManualPrompt(context,targets,batchId,config={}){
 const {payload}=buildReviewPayload(context||'',targets,config);
 if(batchId!==undefined)payload.batch_id=batchId;
 const batchInstruction=batchId===undefined?'':[
  'Output JSON only: top-level batch_id and results'+(config.smartSegmentation===true?' (plus optional repairs).':'.'),
  'The input format marker shared-pools-v3 is NOT a response field; do not copy format, sentences, candidates, targets, or context into the output.',
  'Return EXACTLY ONE {target_id,choice_id} for EACH target_id in the current request. Copy IDs character-for-character, never renumber, invent or repeat IDs.',
  config.dictionaryFree===true?'There are no dictionary senses in this batch: choice_id may be KEEP or a verified-by-model Hanja/Latin spelling permitted by the enabled experiment. If uncertain use KEEP.':'For dictionary senses use the target-specific choice key (c/n etc.), never the shared candidate p ID. If uncertain choose KEEP.',
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
 const payload={format:'shared-pools-v3',...(config.smartSegmentation===true?{}:{context}),sentences,candidates,targets:packedTargets};
 const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
 const userBytes=bytes(payload),legacyUserBytes=bytes({context,targets});
 const stats={posFilteredOptions:originalOptionCount-targets.reduce((n,t)=>n+t.options.length,0),posConflictTargets:targets.filter(t=>t.pos_conflict).length,format:payload.format,targets:targets.length,sentences:sentences.length,candidates:candidates.length,userBytes,legacyUserBytes,savedPercent:Math.round((1-userBytes/legacyUserBytes)*1000)/10};
 return {payload,stats};
}

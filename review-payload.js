import {filterReviewTargets,canTrimReviewMorphology} from './review-pos.js';
import {buildExperimentalOriginInstructions} from './experimental-options.js';
import {SMART_SEGMENTATION_INSTRUCTIONS} from './smart-segmentation-prompt.js';

// Positional-v1 is the only output protocol. Every output position answers
// the target at the same zero-based input position.
export const REVIEW_INSTRUCTIONS=[
 'Annotate Korean word occurrences using true etymological origins and occurrence-specific meanings.',
 'The source uses shared-pools-v4: sentences[] are source sentences, targets[] is ORDERED, options maps target-local c/n dictionary keys to pooled candidates p keys. n keys are confirmed nonconversion senses; JSON null is a fallback.',
 'Output results as an array of exactly targets.length values in the SAME order. Never omit, reorder, shift, or merge positions, even for a repaired or scan-only target.',
 'For each value return a matching dictionary c/n key, a reliably known enabled Hanja/Latin origin string, JSON null (keep unchanged when uncertain), or JSON false ONLY for an allowed segmentation-repair placeholder.',
 'Always return a JSON object with batch_id copied EXACTLY from the input FIRST and results SECOND. Example: {"batch_id":"current-batch","results":["c0",null,"n1"]}. The quoted string "null" is different from JSON null.',
 'First infer the meaning from the sentence and context. Then compare all candidate definitions and origins. Never choose a dictionary sense just because its spelling resembles the word.',
 'Treat Kiwi morphology as a hint. Names require exact evidence; never invent name Hanja. Use null for genuinely native, protected, or uncertain occurrences.'
].join('\n');

export function buildReviewInstructions(config={}){
 const experimental=buildExperimentalOriginInstructions(config);
 const dictionaryFree=config.dictionaryFree===true;
 const noDictionary=dictionaryFree?[
  'OPEN-ENDED ORIGIN AUDIT: no external dictionary has been loaded. The listed options may be empty and never restrict authentic generated spellings.',
  'For each occurrence infer the actual word meaning and origin independently. Enabled Hanja mode permits genuine Korean-reading-aligned Chinese characters; enabled loanword mode permits true borrowed Latin-script origins, never invented English translations or romanization.',
  'Leave native, protected, or uncertain items unchanged with JSON null. Never invent c/n/p keys.'
 ].join('\n'):'';
 return [REVIEW_INSTRUCTIONS,...(dictionaryFree?[noDictionary]:experimental?[experimental]:[]),
  ...(config.smartSegmentation===true?[SMART_SEGMENTATION_INSTRUCTIONS]:[])].join('\n');
}
export function buildManualPrompt(context,targets,batchId,config={}){
 const {payload}=buildReviewPayload(context||'',targets,{...config,batchId});
 const notes=[
  'MANUAL REVIEW: Return only one JSON object with batch_id and results'+(config.smartSegmentation===true?', plus optional repairs.':'.'),
  'Full answer: results is a fixed-length positional array matching the input targets order (0-based). Each entry is a string or actual JSON null.',
  config.smartSegmentation===true?
   'Use JSON false ONLY for scan_only or original targets replaced/deleted by a valid repair. Never remove their array positions.':
   'JSON false is forbidden when smart segmentation is disabled.',
  'Only a retry labeled partial=true uses explicit indexed entries [[originalIndex,value],...]. Preserve the ORIGINAL 0-based positions.',
  'batch_id is REQUIRED and must match byte-for-byte. Missing/mismatched batch_id rejects the answer. Do not copy the input fields.',
  ''
 ].join('\n');
 return buildReviewInstructions(config)+'\n'+notes+JSON.stringify(payload);
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
   if(option.type==='keep')return null;
   const {choice_id,...meaning}=option;
   const key=JSON.stringify(canonical(meaning));
   if(!candidateIds.has(key)){const candidate_id=`p${candidates.length}`;candidateIds.set(key,candidate_id);candidates.push({candidate_id,...meaning});}
   return [choice_id,candidateIds.get(key)];
  }).filter(Boolean));
  const {context:unused,adjacent_context:unusedAdjacent,options:oldOptions,repair_context:unusedRepair,repair_sentence_key:unusedKey,original_target_id:unusedOriginal,...occurrence}=target;
  if(config.smartSegmentation!==true)delete occurrence.target_id;
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
 const payload={format:'shared-pools-v4',response_protocol:'positional-v1',batch_id:config.batchId||null,...(experimental?{
  origin_mode:'open-origin',
  allowed_origin_types:[...(config.experimentalHanja===true?['hanja']:[]),...(config.experimentalLoanword===true?['loanword']:[])],
  ...(config.dictionaryFree===true?{keep_is_fallback_only:true}:{dictionary_options_are_not_exhaustive:true})
 }:{}),...(config.smartSegmentation===true?{}:{context}),sentences,candidates,targets:packedTargets};
 const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
 const userBytes=bytes(payload),legacyUserBytes=bytes({context,targets});
 const stats={posFilteredOptions:originalOptionCount-targets.reduce((n,t)=>n+t.options.length,0),posConflictTargets:targets.filter(t=>t.pos_conflict).length,format:payload.format,targets:targets.length,sentences:sentences.length,candidates:candidates.length,userBytes,legacyUserBytes,savedPercent:Math.round((1-userBytes/legacyUserBytes)*1000)/10};
 return {payload,stats};
}

import {filterReviewTargets,canTrimReviewMorphology} from './review-pos.js';
import {buildExperimentalOriginInstructions} from './experimental-options.js';
import {SMART_SEGMENTATION_INSTRUCTIONS} from './smart-segmentation-prompt.js';

// Compact-ID JSON protocol. No support for old result row field names.
export const REVIEW_INSTRUCTIONS=[
 'Annotate Korean occurrences by true origin and context-specific meaning, using the supplied dictionary senses.',
 'Input format shared-pools-v4: sentences[] contains source sentences; targets[].sentence_id references its sentence. targets[].options contains ONLY selectable conversion c keys mapped to pooled candidates p keys; keep_senses contains reference-only nonconversion candidate p keys. Neither p keys nor keep_senses are valid answers.',
 'For EACH target return exactly one JSON object with fields t and c in results[]. t must match its target_id precisely. c must be a genuine local conversion c key, actual JSON null to preserve Korean, or (when enabled) a genuinely known Hanja/Latin origin string. NEVER answer with n-numbered keys.',
 'For API replies, return {"results":[{"t":"t0","c":"c0"},{"t":"t1","c":null}]}. For manual replies, also include the original batch_id in the outer object. Do not use string "null" for actual null, and never put explanatory text or other fields into a result row.',
 'Decide meaning from the sentence and adjacent context BEFORE selecting a dictionary sense. keep_senses are reference-only dictionary meanings for leaving Korean unchanged, NOT selectable options. Use JSON null for ANY nonconversion meaning, native Korean, or uncertain origin; you do not need to decide which keep sense applies.',
 'Names require exact identity evidence; proper_noun and dictionary_name_homograph flags and Kiwi morphology are hints rather than proof. Check suspected names and homographs carefully; a compound component may be converted when its origin matches precisely that source span. Follow origin-specific proper-name rules only when a corresponding experimental origin mode is enabled; never invent personal-name spellings.',
 'An empty options object {} supplies NO local conversion keys. Never invent c0 or any other key; use a genuine enabled literal origin if reliably known, otherwise actual JSON null. No n key exists even if keep_senses is present.',
 'Do not invent or repeat t identifiers, and do not change source start/end positions. Preserve every source word boundary and native suffix.'
].join('\n');

export function buildReviewInstructions(config={}){
 const generated=buildExperimentalOriginInstructions(config);
 const noDictionary=config.dictionaryFree===true?[
  'OPEN-ENDED ORIGIN AUDIT: no external dictionary was loaded; empty options do not prohibit an authentic generated origin.',
  'Infer a reliably known etymological Hanja spelling or borrowed Latin original only for the enabled origin type; not an invented translation, transcription, or romanization.',
  'For genuine Korean native vocabulary and uncertain cases use actual JSON null. Never invent a dictionary option key.'
 ].join('\n'):'';
 return [REVIEW_INSTRUCTIONS,...(generated?[generated]:[]),...(noDictionary?[noDictionary]:[]),
  ...(config.smartSegmentation===true?[SMART_SEGMENTATION_INSTRUCTIONS]:[])].join('\n');
}
export function buildManualPrompt(context,targets,batchId,config={}){
 const {payload}=buildReviewPayload(context||'',targets,config);
 if(batchId!==undefined)payload.batch_id=batchId;
 const example=JSON.stringify({batch_id:batchId,results:[{t:'t0',c:'c0'},{t:'t1',c:null}]});
 const notes=[
  config.smartSegmentation===true?'MANUAL REVIEW: Preferred response is one JSON object containing batch_id, results and optional repairs.':'MANUAL REVIEW: Preferred response is one JSON object containing batch_id and results.',
  'Copy the current batch_id exactly. Example answer structure (use real target IDs and choices from this request): '+example+'. If the wrapper is omitted accidentally, the local validator also accepts a bare t/c array or an object with results, but only when every returned t belongs to the active batch.',
  'Result rows use ONLY the exact field names t and c: {"t":"t0","c":"c0"} or {"t":"t1","c":null}. The t value matches target_id in the request. c is a local conversion c key or an enabled literal origin, not a pooled candidate ID or a nonconversion key.',
  'Use real JSON null (without quotes) to leave text unchanged. Any genuine enabled Latin etymology is a normal origin string, never a keep instruction.',
  config.smartSegmentation===true?
   'Return results for targets not superseded by validated repairs; omit those retired by a valid repair and scan_only placeholders. A failed repair does NOT retire the original target. Repair objects use their separately specified field names.':
   'Return exactly one t/c result for each target; no duplicates or invented IDs.',
  'Do not copy source format, sentences, candidates, targets or context into the answer. Include batch_id whenever possible; a stated mismatching batch_id is always rejected.',
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
  const pooled=option=>{
   const {choice_id,...meaning}=option;
   const key=JSON.stringify(canonical(meaning));
   if(!candidateIds.has(key)){const candidate_id=`p${candidates.length}`;candidateIds.set(key,candidate_id);candidates.push({candidate_id,...meaning});}
   return candidateIds.get(key);
  };
  // Nonconversion meanings are context evidence only; the sole no-conversion
  // answer is null. Keep native senses pooled without a model-selectable n key.
  const options=Object.fromEntries(target.options.filter(o=>o.type!=='keep'&&o.type!=='nonconversion').map(o=>[o.choice_id,pooled(o)]));
  const keep_senses=target.options.filter(o=>o.type==='nonconversion').map(pooled);
  const {context:unused,adjacent_context:unusedAdjacent,options:oldOptions,repair_context:unusedRepair,repair_sentence_key:unusedKey,original_target_id:unusedOriginal,...occurrence}=target;
  if(config.smartSegmentation===true&&target.scan_only===true)delete occurrence.surface;
  // Smart segmentation already sends the full Kiwi tokens once per sentence.
  // Repeating occurrence-level morphology (including name/POS risk evidence)
  // is redundant in that mode; background validation still receives it intact.
  if(config.smartSegmentation===true){
   delete occurrence.morphology;
  }else if(canTrimReviewMorphology(target,config)){
   if(target.morphology.length===1&&target.morphology[0].form===target.surface&&target.morphology[0].start===target.start&&target.morphology[0].end===target.end){
    delete occurrence.morphology;
   }else{
    occurrence.morphology=target.morphology.map(({tag,...part})=>part);
   }
  }
  return {...occurrence,sentence_id:sentenceIds.get(sentenceKey),options,...(keep_senses.length?{keep_senses}: {})};
 });
 const experimental=config.experimentalHanja===true||config.experimentalLoanword===true;
 const payload={format:'shared-pools-v4',...(experimental?{
  origin_mode:'open-origin',
  allowed_origin_types:[...(config.experimentalHanja===true?['hanja']:[]),...(config.experimentalLoanword===true?['loanword']:[])],
  ...(config.dictionaryFree===true?{null_is_fallback_only:true}:{dictionary_options_are_not_exhaustive:true})
 }:{}),...(config.smartSegmentation===true?{}:{context}),sentences,candidates,targets:packedTargets};
 const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
 const userBytes=bytes(payload),legacyUserBytes=bytes({context,targets});
 const stats={posFilteredOptions:originalOptionCount-targets.reduce((n,t)=>n+t.options.length,0),posConflictTargets:targets.filter(t=>t.pos_conflict).length,format:payload.format,targets:targets.length,sentences:sentences.length,candidates:candidates.length,userBytes,legacyUserBytes,savedPercent:Math.round((1-userBytes/legacyUserBytes)*1000)/10};
 return {payload,stats};
}

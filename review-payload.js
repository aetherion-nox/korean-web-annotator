import {filterReviewTargets,canTrimReviewMorphology} from './review-pos.js';
import {projectAnnotation} from './local-engine.js';
import {buildExperimentalOriginInstructions} from './experimental-options.js';
import {SMART_SEGMENTATION_INSTRUCTIONS} from './smart-segmentation-prompt.js';

// Compact-ID JSON protocol. No support for old result row field names.
// Shared semantic gate: dictionary candidates must match the contextual sense;
// an etymological origin must match BOTH meaning and Korean pronunciation.
const CORE_REVIEW_INSTRUCTIONS=[
 "Annotate Korean occurrences by true origin and context-specific meaning, using the supplied dictionary senses.",
 "Input format shared-pools-v5: sentences[] contains source sentences; targets[].sentence_id references its sentence. targets[].options is an ARRAY of pooled p candidate IDs. For dictionary answers choose results[].c from that exact target's options array. The internal dictionary numbering is not sent to the model.",
 "For EACH target return exactly one JSON object with fields t and c in results[]. t must match its target_id precisely. c is a matching pooled p candidate ID, actual JSON null, or an authentic direct origin only when its experimental origin type is enabled.",
 "Field names are exactly t and c. For dictionary answers copy a p candidate ID from this target.options array, e.g. {\"t\":\"tX\",\"c\":\"p412\"}. Never derive a candidate ID from a numeric suffix or a different target.",
 "For API replies, return {\"results\":[{\"t\":\"t0\",\"c\":\"p0\"},{\"t\":\"t1\",\"c\":null}]}. For manual replies, also include the original batch_id. Use actual JSON null, not string \"null\". Do not include explanatory fields in result rows.",
 "Decide meaning from the sentence and adjacent context BEFORE selecting a dictionary sense: identify the actual Korean lexical item, morpheme boundaries, named entity, and context-specific meaning. Dictionary options are proposals, not proof. A pooled candidate may combine multiple original dictionary entries with the SAME projected annotation; inspect ALL its senses[] (or its single definitions field). A wrong pooled candidate is wrong even when it is the only candidate; NEVER choose the nearest available ID merely to complete the response. Nonconversion dictionary senses within a pooled candidate require a real native meaning match, or use JSON null.",
 "Candidates with phrase_origin are components projected from a complete dictionary phrase. The definitions describe that complete phrase, not necessarily the component alone. Verify the component’s actual origin and meaning in the current occurrence; do not assume the other components appear in the text. Use null when uncertain.",
 "Check the entire orthographic word and its grammatical suffixes before committing any shorter fragment. If a candidate cuts through a personal name, title or indivisible word, do not convert that fragment. A target marked protected_name_boundary cannot use direct Hanja. Preserve it with JSON null rather than inventing a partial meaning.",
 "Hanja annotations must represent authentic Hanja etymology aligned to Korean readings, NOT a Chinese translation or semantically similar expression pronounced differently in Korean. Never replace a native Korean morpheme with Hanja merely to express its meaning. Verify individual Hanja readings against the actual Hangul syllables and word boundaries, including valid initial-sound phenomena; matching semantics alone is insufficient.",
 "dictionary_name_overlap means the target overlaps a dictionary person-name span with different boundaries. Check the full name and neighboring morphemes in context. Use JSON null for a fragment that cuts through the actual name.",
 "Names require exact identity evidence; proper_noun, dictionary_name_homograph and Kiwi morphology are hints, not proof. For a personal name, prefer a matching dictionary pooled p ID only when it identifies the correct person. If none matches, direct origin is permitted only under the corresponding experimental mode and only for a reliably identified person with a known genuine spelling. Never guess name characters from pronunciation or confuse homonymous people; return JSON null if uncertain. Other proper nouns also require reliable contextual identity and origin evidence.",
 "Session-local senses whose entry_id (including within candidate.senses[]) starts with session-inline-hanja: come from an explicit Hangul(漢字) parenthesis already ENCOUNTERED earlier in the CURRENT article, or earlier in this very paragraph. Their definitions quote the source context, not an external dictionary. Treat them as strong article evidence but NOT proof that every identical-looking word or person name has the same meaning. Compete with existing dictionary choices and choose only when the current occurrence supports that sense; otherwise select the ordinary alternative or JSON null.",
 "An empty options array [] supplies NO dictionary candidates; never invent a p ID. Each non-null dictionary choice must be an exact element of the current target.options array. Invalid IDs are handled by the configured retry/discard strategy.",
 "Do not invent or repeat t identifiers, and do not change source start/end positions. Preserve every source word boundary and native suffix.",
].join('\n');
const STANDARD_REVIEW_RULES=[
 "DICTIONARY-ONLY ANSWERS: results[].c must be a pooled p candidate ID in the current target.options array or actual JSON null. Directly written Hanja or Latin spellings are NOT valid when experimental origins are disabled. If no candidate fits the contextual meaning, return actual JSON null.",
 "An empty options array [] provides no dictionary candidates. Use actual JSON null for that target. Never fabricate a p ID for an empty candidate list.",
].join('\n');
export const REVIEW_INSTRUCTIONS=[CORE_REVIEW_INSTRUCTIONS,STANDARD_REVIEW_RULES].join('\n');

export function buildReviewInstructions(config={}){
 if(config.dictionaryCorrectionOnly===true){
  // Targeted retries keep the original origin-audit toggles. Only segmentation
  // repairs are excluded: the model is correcting t/c decisions, not spans.
  const experimental=config.experimentalHanja===true||config.experimentalLoanword===true;
  return [
   experimental?
    'ORIGIN-AUDIT CORRECTION: Previous valid answers are saved. Reconsider only the supplied target IDs with the same enabled experimental origin types as the original request.':
    'DICTIONARY-ONLY CORRECTION: Previous valid answers are saved. Reconsider only the supplied target IDs.',
   buildReviewInstructions({...config,dictionaryCorrectionOnly:false,smartSegmentation:false}),
   "Do not repeat saved answers. Return exactly one t/c row for each supplied target, with actual JSON null if the context does not support an authorized origin. Use only matching pooled p IDs, authorized authentic direct origins under the original experimental settings, or JSON null; do not submit repairs or unrelated targets.",
   "WEB CORRECTION FEEDBACK: rejected_choices records earlier rejected model answers with their local validation reasons. Reconsider semantic meaning, pronunciation and word boundaries. Reject repeated invalid literal origins; when uncertain use JSON null. Pooled p IDs are PER-REQUEST and may change when rebatching: a previously invalid numeric p ID is NOT a global ban against the same p ID in the NEW current options.",
   "API response format: {\"results\":[{\"t\":\"t0\",\"c\":\"p0\"},{\"t\":\"t1\",\"c\":null}]}. Manual retries must also include their original batch_id."
  ].join('\n');
 }
 const experimental=config.experimentalHanja===true||config.experimentalLoanword===true;
 const generated=experimental?buildExperimentalOriginInstructions(config):'';
 const noDictionary=experimental&&config.dictionaryFree===true?[
  'OPEN-ENDED ORIGIN AUDIT: no external dictionary was loaded; empty options do not prohibit an authentic generated origin.',
  'Infer a reliably known etymological Hanja spelling or borrowed Latin original only for the enabled origin type; NEVER substitute a meaning translation, invented spelling, or unrelated word.',
  'For genuine Korean native vocabulary and uncertain cases use actual JSON null. Never invent a dictionary option key.'
 ].join('\n'):'';
 return [experimental?CORE_REVIEW_INSTRUCTIONS:REVIEW_INSTRUCTIONS,
  ...(generated?[generated]:[]),...(noDictionary?[noDictionary]:[]),
  ...(config.smartSegmentation===true?[SMART_SEGMENTATION_INSTRUCTIONS,'API output order: emit the root results array first, then repairs. Decide repairs before writing results; the field order affects only provisional streaming display.']:[])].join('\n');
}
export function buildManualPrompt(context,targets,batchId,config={}){
 const {payload}=buildReviewPayload(context||'',targets,config);
 const experimental=config.experimentalHanja===true||config.experimentalLoanword===true;
 if(batchId!==undefined)payload.batch_id=batchId;
 const example=JSON.stringify({batch_id:batchId,results:[{t:'t0',c:'p0'},{t:'t1',c:null}]});
 const notes=[
  config.smartSegmentation===true?'MANUAL REVIEW: Preferred response is one JSON object containing batch_id, results and optional repairs.':'MANUAL REVIEW: Preferred response is one JSON object containing batch_id and results.',
  'Copy the current batch_id exactly. Example answer structure (use real target IDs and choices from this request): '+example+'. If the wrapper is omitted accidentally, the local validator also accepts a bare t/c array or an object with results, but only when every returned t belongs to the active batch.',
  "For dictionary answers copy only a pooled p ID from the CURRENT target.options array. For example {\"t\":\"tX\",\"c\":\"p412\"} only if p412 appears in that target.options list.",
  'Result rows use ONLY the exact field names t and c: {"t":"t0","c":"p0"} or {"t":"t1","c":null}. The t value matches target_id; c is '+(experimental?'a pooled p ID from this target.options array or an enabled authentic literal origin':'a pooled p ID from this target.options array')+', or actual JSON null.',
  'Use real JSON null (without quotes) to leave text unchanged.',
  ...(experimental?[config.experimentalHanja===true&&config.experimentalLoanword===true?
   'A genuine enabled Hanja or Latin source spelling is an origin string, never a keep instruction.':
   config.experimentalHanja===true?
    'A genuine enabled Hanja source spelling is an origin string, never a keep instruction.':
    'A genuine enabled Latin source spelling is an origin string, never a keep instruction.']:[]),
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
// Only the final projected annotation matters for accepting an equivalent
// pooled ID. Never infer a source from its p-number or its dictionary gloss.
// Conversion equivalence requires an exact, uniquely alignable source span.
function projectedEffect(target,option){
 try{
  const rendered=projectAnnotation(target.context,{
   ...option,start:target.start,end:target.end,surface:target.surface
  });
  return rendered.map(a=>({
   start:a.start-target.start,end:a.end-target.start,
   surface:a.surface,replacement:a.replacement,type:a.type
  }));
 }catch{return null;}
}
const effectShape=effect=>JSON.stringify(effect.map(a=>[
 a.type,a.surface,a.replacement
]));
const sameEffect=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Pool only outputs with identical source-relative projected annotations.
// Inflected native forms can additionally share a no-op pool by dictionary
// headword (나/내), but distinct unconverted lexemes never merge blindly.
function poolEffectKey(target,meaning,effect){
 if(!effect)return 'legacy:'+JSON.stringify(canonical(meaning));
 if(meaning.type==='nonconversion'&&effect.length===0)
  return JSON.stringify(['native',meaning.written_form||target.surface]);
 if(!effect.length)return 'legacy:'+JSON.stringify(canonical(meaning));
 return JSON.stringify(['rendered',target.surface,meaning.type,effect]);
}
function compactSense(meaning){
 const {type,replacement,segments,...sense}=meaning;
 return sense;
}
function rebaseEffect(source,localSurface){
 const at=localSurface.indexOf(source.surface);
 if(at<0||localSurface.indexOf(source.surface,at+1)!==-1)return null;
 return source.effect.map(a=>({...a,start:a.start+at,end:a.end+at}));
}

export function buildReviewPayload(context,targets,config={}){
 const originalTargets=Array.isArray(config.unfilteredReviewTargets)?config.unfilteredReviewTargets:targets;
 const originalOptionCount=originalTargets.reduce((n,t)=>n+t.options.length,0);
 // POS filtering remains model-facing only. The hidden fallback resolver may
 // reuse an authentic, pre-filter option of THIS target if a foreign pooled p
 // has the exact same source-bound rendered annotation.
 targets=filterReviewTargets(targets,config);
 const originalById=new Map(originalTargets.map(t=>[t.target_id,t]));
 const sentences=[],candidates=[],sentenceIds=new Map(),candidateIds=new Map(),choiceIndex={},poolSources=new Map(),poolSenses=new Map(),poolForms=new Map();
 const packedTargets=targets.map(target=>{
  const text=target.context;
  const adjacent_context=target.adjacent_context;
  // Hash/map the paragraph string once instead of JSON.stringify()-ing
  // the whole paragraph again for every target in it.
  let subkeys=sentenceIds.get(text);
  if(!subkeys){subkeys=new Map();sentenceIds.set(text,subkeys);}
  const contextKey=JSON.stringify([adjacent_context?.before||'',adjacent_context?.after||'',
    ...(config.smartSegmentation===true?[target.repair_sentence_key||'']:[])]);
  let sentence_id=subkeys.get(contextKey);
  if(sentence_id===undefined){sentence_id=`s${sentences.length}`;subkeys.set(contextKey,sentence_id);sentences.push({sentence_id,text,...(adjacent_context?{adjacent_context}:{}),...(config.smartSegmentation===true?{
   // Shared once per sentence, compact tuples rather than repeating field names.
   kiwi_tokens:(target.repair_context?.kiwi_tokens||[]).map(t=>[t.form,t.tag,t.start,t.end]),
   protected_ranges:target.repair_context?.protected_ranges||[]
  }: {})});}
  // The model sees only pooled p IDs; local c/n options stay in the
  // private per-request index used by validation and recovery.
  const poolIds=[],byPool={};
  for(const option of target.options){
   if(option.type==='keep')continue;
   const {choice_id,...meaning}=option;
   if(meaning.type==='loanword'&&typeof meaning.replacement==='string')
     meaning.replacement=meaning.replacement.replace(/[←→]/g,'');
   const effect=projectedEffect(target,meaning);
   const key=poolEffectKey(target,meaning,effect);
   if(!candidateIds.has(key)){
    const candidate_id=`p${candidates.length}`;
    candidateIds.set(key,candidate_id);
    candidates.push({candidate_id,...meaning});
    poolSenses.set(candidate_id,new Map());
    poolForms.set(candidate_id,new Set());
   }
   const poolId=candidateIds.get(key);
   poolIds.push(poolId);
   // Same projected output means one deterministic local choice. Never
   // create ambiguous c/n mappings for semantically duplicate p groups.
   if(!Object.hasOwn(byPool,poolId))byPool[poolId]=[choice_id];
   const sense=compactSense(meaning),signature=JSON.stringify(canonical(sense));
   poolSenses.get(poolId).set(signature,sense);
   poolForms.get(poolId).add(target.surface);
   if(effect){
    if(!poolSources.has(poolId))poolSources.set(poolId,[]);
    const sources=poolSources.get(poolId);
    if(!sources.some(a=>a.surface===target.surface&&sameEffect(a.effect,effect)))
     sources.push({surface:target.surface,effect});
   }
  }
  choiceIndex[target.target_id]=byPool;
  const options=[...new Set(poolIds)];
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
  const rejected=config.retryHistoryFeedback===true?
   config.rejectedChoices?.[target.target_id]:null;
  return {...occurrence,sentence_id,options,
   ...(Array.isArray(rejected)&&rejected.length?{
    rejected_choices:rejected.slice(0,12).map(x=>({c:x.c,reason:x.reason,
     ...(/^[pcn]\d+$/u.test(x.c)?{scope:'previous_request_only'}:{})}))
   }:{})};
 });
 // Keep every original meaning available even after collapsing
 // dictionary entries that produce the same visible conversion. For a
 // single sense the legacy flat candidate shape remains unchanged.
 // For merged senses, the model reads senses[]; no dictionary provenance
 // or lexical definitions are silently dropped.
 for(const candidate of candidates){
  const senses=[...poolSenses.get(candidate.candidate_id).values()];
  const forms=[...poolForms.get(candidate.candidate_id)];
  if(senses.length>1){
   for(const key of ['entry_id','definitions','written_form','part_of_speech','subject_category','semantic_category','phrase_origin'])
    delete candidate[key];
   candidate.senses=senses;
  }
  if(forms.length>1)candidate.surface_forms=forms;
 }
 const experimental=config.experimentalHanja===true||config.experimentalLoanword===true;
 // Private safety index: a foreign p can reuse the same rendered annotation
 // in this target's ORIGINAL dictionary options even if optional POS filtering
 // hid the local sense from the MODEL. Never introduce an annotation absent
 // from this target's local dictionary choices, and never alter its wire options.
 // Neither entry ID nor gloss determines rendering equivalence.
 const poolByShape=new Map(),noOpPoolIds=[];
 for(const candidate of candidates){
  const poolId=candidate.candidate_id,sources=poolSources.get(poolId)||[];
  for(const source of sources){
   if(!source.effect.length)continue;
   const shape=effectShape(source.effect);
   if(!poolByShape.has(shape))poolByShape.set(shape,[]);
   poolByShape.get(shape).push({poolId,...source});
  }
  if(candidate.type==='nonconversion'&&sources.some(s=>s.effect.length===0))
   noOpPoolIds.push(poolId);
 }
 for(const target of targets){
  const mapping=choiceIndex[target.target_id]||{};
  const sourceTarget=originalById.get(target.target_id)||target;
  for(const option of sourceTarget.options){
   if(option.type==='keep')continue;
   const effect=projectedEffect(sourceTarget,option);
   if(!effect?.length)continue; // A no-op already has the explicit null choice.
   const shape=effectShape(effect);
   for(const source of poolByShape.get(shape)||[]){
    if(Object.hasOwn(mapping,source.poolId))continue;
    const projected=rebaseEffect(source,target.surface);
    if(projected&&sameEffect(projected,effect))
     mapping[source.poolId]=[option.choice_id];
   }
  }
 }
 // A pooled nonconversion is visual KEEP, regardless of which dictionary
 // definition produced it. Null is already a legal choice for every target.
 // Store this sparse fallback once instead of repeating it for all targets.
 if(noOpPoolIds.length)choiceIndex.__noOpPoolIds=noOpPoolIds;
 const payload={format:'shared-pools-v5',...(experimental?{
  origin_mode:'open-origin',
  allowed_origin_types:[...(config.experimentalHanja===true?['hanja']:[]),...(config.experimentalLoanword===true?['loanword']:[])],
  ...(config.dictionaryFree===true?{null_is_fallback_only:true}:{dictionary_options_are_not_exhaustive:true})
 }:{}),sentences,candidates,targets:packedTargets};
 const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
 const userBytes=bytes(payload);
 // The legacy-size diagnostic is an estimate. Serializing the old,
 // intentionally redundant target.context format just to measure it would
 // itself recreate the O(paragraphLength * targetCount) bottleneck.
 const encodedContextBytes=new Map(sentences.map(s=>[s.text,bytes(s.text)]));
 const repeatedContextBytes=targets.reduce((total,t)=>total+(encodedContextBytes.get(t.context)||0)+11,0);
 const legacyUserBytes=userBytes+repeatedContextBytes;
 const totalOffered=targets.reduce((n,t)=>n+t.options.filter(o=>o.type!=='keep').length,0);
 const totalPooledReferences=packedTargets.reduce((n,t)=>n+t.options.length,0);
 const stats={posFilteredOptions:originalOptionCount-targets.reduce((n,t)=>n+t.options.length,0),
  collapsedLocalOptions:totalOffered-totalPooledReferences,
  mergedPooledCandidates:candidates.filter(c=>Array.isArray(c.senses)).length,
  posConflictTargets:targets.filter(t=>t.pos_conflict).length,format:payload.format,targets:targets.length,sentences:sentences.length,candidates:candidates.length,userBytes,legacyUserBytes,savedPercent:Math.round((1-userBytes/legacyUserBytes)*1000)/10};
 return {payload,stats,choiceIndex};
}

/**
 * An exact target option, a visually identical safely rebased conversion,
 * or a no-op pooled nonconversion is allowed. Unalignable/alien conversion
 * results and ambiguous targets still follow strict retry/discard rules.
 */
export function normalizePooledChoiceAnswers(response,choiceIndex){
 if(!Array.isArray(response?.results))return response;
 return {...response,results:response.results.map(row=>{
  if(!row||typeof row!=='object'||typeof row.c!=='string')return row;
  if(/^[cn]\d+$/u.test(row.c))return {...row,c:'invalid_local_key:'+row.c};
  if(!/^p\d+$/u.test(row.c))return row;
  const keys=choiceIndex?.[row.t]?.[row.c];
  if(Array.isArray(keys)&&keys.length===1)return {...row,c:keys[0]};
  if(choiceIndex?.[row.t]&&choiceIndex.__noOpPoolIds?.includes(row.c))
   return {...row,c:null};
  return row;
 })};
}

// Extract only the authentic shared-pools payload embedded in a prompt
// generated by this extension. A malformed prompt provides no
// authority to reinterpret p IDs and will leave them invalid.
export function poolPayloadFromManualPrompt(prompt){
 if(typeof prompt!=='string')return null;
 const marker='{"format":"shared-pools-v5"';
 const start=prompt.indexOf(marker);
 if(start<0)return null;
 try{
  const payload=JSON.parse(prompt.slice(start));
  return payload?.format==='shared-pools-v5'?payload:null;
 }catch{return null;}
}

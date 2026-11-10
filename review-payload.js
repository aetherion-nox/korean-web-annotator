import {filterReviewTargets,canTrimReviewMorphology} from './review-pos.js';
import {EXPERIMENTAL_REVIEW_INSTRUCTIONS} from './experimental-options.js';
// Pool dictionary data, not decisions. A choice_id is still local to its target.
export const REVIEW_INSTRUCTIONS="This is a Korean dictionary-origin annotation and sense-selection task, not translation, proofreading, or a decision about whether Korean should be rewritten. Select a supplied dictionary sense only when its definition and origin fit this occurrence in context. Topic relevance is insufficient; the dictionary definition must match the word’s exact grammatical and semantic use. For loanword options, replacement is a dictionary-supplied original spelling, not an arbitrary English translation. Natural, familiar or fully understood Korean is not a reason to reject a matching supplied origin. Options with type nonconversion are independently selectable dictionary senses that preserve the original Korean. They include native Korean senses and other entries that do not convert in the active modes; missing origin metadata alone does not prove native etymology. Select the matching nonconversion option (such as n0) when its meaning is established. When definitions overlap, compare origin and usage evidence; missing origin metadata alone is not evidence against a matching supplied origin. Do not select a nonconversion sense solely to avoid annotation. KEEP is reserved for uncertainty: choose it when no supplied sense fits, the needed meaning or origin is missing, or evidence is insufficient. A definite nonconversion sense must be selected by its own choice_id, not KEEP. Never force the closest candidate or infer origin from a translation. context is page-level context when present. A sentences entry may include adjacent_context with before/after text from neighboring chunks, capped at 1000 UTF-16 units per side. This is supplemental evidence only: do not annotate it or use its offsets; target start/end still refer solely to that entry text. Each target references sentence_id in sentences; start/end are UTF-16 offsets in that sentence. Target options map allowed choice_id keys to candidate_id values in candidates. KEEP is always the fixed option {\"KEEP\":null}; it never references candidates or carries dictionary senses. All other options reference dictionary senses, including nonconversion senses. The dictionary may be incomplete, even when a target has only one non-KEEP option or many options sharing one spelling. A proper_noun:true target is a tokenizer hint for a possible proper noun, not proof of its origin and not a reason by itself to preserve Korean. A dictionary_person_name:true target has an explicit person-name dictionary entry. A dictionary_name_homograph:true target contains both a person-name and an ordinary entry for the same Korean spelling; local scoring and POS filtering were bypassed to include all original dictionary senses. Choose an ordinary sense when its definition matches; otherwise choose KEEP. A suspected_person_name:true target has an ordinary headword and structural surname/segmentation/particle evidence of a possible personal name; ignore the local scorer and choose an ordinary sense only when it fits context. If it is an unlisted name, choose KEEP rather than borrowing the ordinary-word Hanja spelling. A single historical person entry does not identify a modern namesake. Require contextual evidence of the same individual before selecting that entry; otherwise choose KEEP. Check personal names, place names, organizations and other proper names from context even without this hint. Select a conversion for a name only when its dictionary meaning and origin match that specific name; select an established nonconversion sense when it matches; otherwise choose KEEP. Never infer a name spelling from pronunciation or borrow an unrelated ordinary-word origin. Example options {\"KEEP\":null,\"n0\":\"p2\",\"c0\":\"p7\"}: return n0, c0 or KEEP, never p2 or p7. For every target choose ONLY a KEY from THAT target options, NEVER a candidate_id value. Sentence pooling merges equal text, not real occurrences: distinct targets may come from different subtitle cues. Use occurrence context when present; identical visible evidence gives no basis for contradictory decisions. pos_conflict:true means every dictionary option conflicted with tokenizer POS, so original options were restored; check segmentation and actual usage. morphology, when present, contains tokenizer lemmas and source offsets; POS tags are supplied only when local compatibility was inconclusive or the boundary needs review. Any supplied tokenizer evidence is fallible. written_form and part_of_speech identify each dictionary entry. A nominal homophone is not a sense of an inflected predicate. partial_word:true means the target is only a component of an attached lexical word; require evidence that this component and its origin apply inside that word. Nonconversion definitions require the same contextual and grammatical fit as conversion definitions. If the needed sense is absent, choose KEEP even when a nonconversion option would leave the text unchanged. Return JSON {\"results\":[{\"target_id\":\"...\",\"choice_id\":\"...\"}]} for every target. Never generate replacement text.";
export function buildManualPrompt(context,targets,batchId,config={}){
 const {payload}=buildReviewPayload(context||'',targets,config);
 if(batchId!==undefined)payload.batch_id=batchId;
 const experimental=config.experimentalHanja===true||config.experimentalLoanword===true;
 const example={...(batchId!==undefined?{batch_id:'照抄输入的 batch_id'}:{}),...(experimental?{experimental_options:[]}:{}),results:[{target_id:'t0',choice_id:'KEEP'}]};
 const batchInstruction=batchId===undefined?'':'\n本批结果必须包含外层 batch_id，原样复制输入中的 batch_id。返回格式：'+JSON.stringify(example)+'。每个目标都必须返回，不能省略。';
 const instructions=REVIEW_INSTRUCTIONS+(experimental?'\n'+EXPERIMENTAL_REVIEW_INSTRUCTIONS:'');
 const task=experimental?'请一次性返回完整 JSON：先列 experimental_options（无补充则 []），再列 results。每个 target 必须有一个最终 choice_id；x0/x1/x2 只能引用该 target 在前面实际提出的有效补充候选。不能更改目标或词界。':'请根据以下上下文与词典候选逐词选择。只返回完整 JSON，不要解释，不要生成替换文本；保留每个 target_id 原样，choice_id 只能选该词 options 的键（例如 KEEP、n0、c0）。';
 return instructions+batchInstruction+'\n\n'+task+'\n'+JSON.stringify(payload);
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
 if(config.experimentalHanja===true||config.experimentalLoanword===true)payload.experimental_modes={hanja:config.experimentalHanja===true,loanword:config.experimentalLoanword===true};
 const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
 const userBytes=bytes(payload),legacyUserBytes=bytes({context,targets});
 const stats={posFilteredOptions:originalOptionCount-targets.reduce((n,t)=>n+t.options.length,0),posConflictTargets:targets.filter(t=>t.pos_conflict).length,format:payload.format,targets:targets.length,sentences:sentences.length,candidates:candidates.length,userBytes,legacyUserBytes,savedPercent:Math.round((1-userBytes/legacyUserBytes)*1000)/10};
 return {payload,stats};
}

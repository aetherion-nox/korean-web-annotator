// Pool dictionary data, not decisions. A choice_id is still local to its target.
export const REVIEW_INSTRUCTIONS='This is a Korean dictionary-origin annotation task, not translation, proofreading, or a decision about whether Korean should be rewritten. For loanword options, replacement is a dictionary-supplied original spelling, not an arbitrary English translation. If a supplied origin and meaning match this occurrence, select its choice_id even when the Korean is already natural, familiar, or fully understood; those facts are not reasons for KEEP. Proper names may also receive verified dictionary-origin annotations. proper_noun:true alone is never a reason for KEEP. Example: when 아시아 refers to the Asian continent and a supplied Asia option means that continent, choose that option; reject an Asia option meaning the Roman province. Do not call 아시아 a Hanja word merely because Chinese translates it as 亚洲. KEEP definitions describe non-conversion records, which can include entries with missing origin metadata; they are not proof of native Korean etymology and do not override a matching supplied origin. Overlapping definitions alone do not justify KEEP. Select only supplied dictionary choice IDs using context and definitions. context is page-level context when present. Each target references sentence_id in sentences; start/end are UTF-16 offsets in that sentence. Target options map allowed choice_id keys to candidate_id values in candidates. A null value OR a candidate with type keep means preserve the original Korean. The dictionary may be incomplete: the correct meaning or origin can be absent even when many Hanja or loanword choices are supplied, or when all supplied choices share one spelling. KEEP means none of the supplied conversions is justified in this occurrence. KEEP does not require a native Korean dictionary meaning or nonempty definitions. Choose KEEP if no candidate meaning fits the context, the needed meaning or origin is missing, or evidence is insufficient; never force the closest candidate. Nonempty KEEP definitions provide additional competing meanings, not an exhaustive list of reasons to preserve Korean. A proper_noun:true target is a tokenizer hint for a possible proper noun, not proof of its origin. Check personal names, place names, organizations and other proper names from context even without this hint. Use a supplied conversion for a name only when its dictionary meaning and origin match that specific name; otherwise choose KEEP. Never infer a name spelling from pronunciation or borrow an unrelated ordinary-word origin. Example options {"KEEP":null,"c0":"p7"}: return c0 or KEEP, never p7. For every target choose ONLY a KEY from THAT target options, NEVER a candidate_id value. Shared sentences or candidates do not require the same decision for different targets. Return JSON {"results":[{"target_id":"...","choice_id":"..."}]} for every target. Never generate replacement text.';
export function buildManualPrompt(context,targets,batchId){
 const {payload}=buildReviewPayload(context||'',targets);
 if(batchId!==undefined)payload.batch_id=batchId;
 const batchInstruction=batchId===undefined?'':'\n本批结果必须包含外层 batch_id，原样复制输入中的 batch_id。返回格式：'+JSON.stringify({batch_id:'照抄输入的 batch_id',results:[{target_id:'t0',choice_id:'KEEP'}]})+'。每个目标都必须返回，不能省略。';
 return REVIEW_INSTRUCTIONS+batchInstruction+'\n\n请根据以下上下文与词典候选逐词选择。只返回完整 JSON，不要解释，不要生成替换文本；保留每个 target_id 原样，choice_id 只能选该词 options 的键（例如 KEEP、c0）。\n'+JSON.stringify(payload);
}
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
export function buildReviewPayload(context,targets){
 const sentences=[],candidates=[],sentenceIds=new Map(),candidateIds=new Map();
 const packedTargets=targets.map(target=>{
  const text=target.context;
  if(!sentenceIds.has(text)){const sentence_id=`s${sentences.length}`;sentenceIds.set(text,sentence_id);sentences.push({sentence_id,text});}
  const options=Object.fromEntries(target.options.map(option=>{
   if(option.type==='keep'&&!option.definitions?.length)return [option.choice_id,null];
   const {choice_id,...meaning}=option;
   const key=JSON.stringify(canonical(meaning));
   if(!candidateIds.has(key)){const candidate_id=`p${candidates.length}`;candidateIds.set(key,candidate_id);candidates.push({candidate_id,...meaning});}
   return [choice_id,candidateIds.get(key)];
  }));
  const {context:unused,options:oldOptions,...occurrence}=target;
  return {...occurrence,sentence_id:sentenceIds.get(text),options};
 });
 const payload={format:'shared-pools-v1',context,sentences,candidates,targets:packedTargets};
 const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
 const userBytes=bytes(payload),legacyUserBytes=bytes({context,targets});
 const stats={format:payload.format,targets:targets.length,sentences:sentences.length,candidates:candidates.length,userBytes,legacyUserBytes,savedPercent:Math.round((1-userBytes/legacyUserBytes)*1000)/10};
 return {payload,stats};
}

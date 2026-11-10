import {localBoundaryUnsafe} from './review-boundary.js';

// Merge a raw-word model rescue with subordinate dictionary review targets.
// No two model tasks may own intersecting source spans. Preserve the original
// sense definitions as evidence, but choose a single whole-word outcome.
const overlap=(a,b)=>a.start<b.end&&b.start<a.end;
// A Kiwi NNP or inferred-surname *hint* is not a confirmed personal name.
// The backend sends authoritative protected_name_spans separately.
const NAME=t=>t.dictionary_person_name===true&&t.dictionary_name_homograph!==true;
export function mergeResegmentationTargets(analysis,proposed){
 const targets=[...(analysis.targets||[])];
 const protectedSpans=Array.isArray(analysis.protected_name_spans)?analysis.protected_name_spans:null;
 const accepted=[];
 let removed=0;
 for(const raw of proposed){
  if(accepted.some(t=>overlap(t,raw)))continue;
  const collisions=targets.filter(t=>overlap(t,raw));
  if(collisions.some(NAME)||
     protectedSpans?.some(t=>overlap(t,raw))||
     collisions.some(t=>t.start<raw.start||t.end>raw.end))continue;
  const relevantRisks=(analysis.boundary_risks||[]).filter(t=>overlap(t,raw));
  const components=collisions.map(t=>({
   start:t.start-raw.start,end:t.end-raw.start,surface:t.surface,
   options:t.options.map(o=>({
    choice_id:o.choice_id,entry_id:o.entry_id,
    type:o.type,replacement:o.replacement,definitions:o.definitions,
    ...(o.written_form?{written_form:o.written_form}:{}),
    ...(o.part_of_speech?{part_of_speech:o.part_of_speech}:{})
   }))
  }));
  const review_reasons=[
   ...(relevantRisks.map(r=>r.reason)),
   ...(collisions.length?['merged_component_reviews']:[])
  ];
  const merged={...raw,
   ...(review_reasons.length?{review_reasons:[...new Set(review_reasons)]}:{}),
   ...(components.length?{component_candidates:components}:{}),
   // Retain the exact original dictionary review obligations, including the
   // independent-boundary and name hints. Never reapply them automatically.
   // Their repeated full context is omitted to avoid inflating the batch.
   ...(collisions.length?{fallback_targets:collisions.map(({context,adjacent_context,...t})=>t)}:{})
  };
  for(const prior of collisions)targets.splice(targets.indexOf(prior),1);
  removed+=collisions.length;
  accepted.push(merged);
 }
 return {targets:[...targets,...accepted].sort((a,b)=>a.start-b.start||a.end-b.end),
         added:accepted.length,removed,merged:accepted.length};
}

/**
 * Only retry original dictionary senses when every sub-target has an
 * independently verified lexical boundary. Otherwise retry the COMPLETE
 * merged word with its preserved component dictionary evidence. Neither
 * branch can silently reapply a local spelling that the model rejected.
 *
 * The callers submit these as a separate model/manual review batch, after
 * the primary whole-word result is known, and validate every decision again.
 */
export function planSegmentationFallback(text,analysis,accepted=[],unresolved=[]){
 const choices=new Map(accepted.map(a=>[a.target.target_id,a.option]));
 const unresolvedIds=new Set(unresolved.map(t=>t.target_id));
 const targets=[];let preserved=0,safeOriginals=0,wholeRechecks=0,unsafeComponents=0;
 const eligible=original=>{
  if(original.partial_word===true||original.boundary_unverified===true||
    original.dictionary_person_name===true||original.suspected_person_name===true||
    original.proper_noun===true)return false;
  if(!Number.isInteger(original.start)||!Number.isInteger(original.end)||
    original.start<0||original.end>text.length||original.start>=original.end||
    text.slice(original.start,original.end)!==original.surface)return false;
  return !localBoundaryUnsafe(text,original,analysis);
 };
 for(const whole of analysis.targets||[]){
  const previous=choices.get(whole.target_id);
  if(!whole.segmentation_review||!Array.isArray(whole.fallback_targets)||
     (!unresolvedIds.has(whole.target_id)&&previous?.type!=='keep'))continue;
  const originals=whole.fallback_targets.filter(t=>(t.options||[]).some(o=>
    ['hanja','loanword','mixed'].includes(o.type)&&o.entry_id!=null));
  if(!originals.length)continue;
  preserved+=originals.length;
  const safe=originals.filter(eligible);
  unsafeComponents+=originals.length-safe.length;
  if(safe.length===originals.length){
   for(const original of safe){
    targets.push({...original,context:whole.context||text,
     ...(whole.adjacent_context?{adjacent_context:whole.adjacent_context}:{}),
     fallback_dictionary_only:true,recovery_parent:whole.target_id,
     review_reasons:[...new Set([...(original.review_reasons||[]),'fallback_original_dictionary_sense'])],
     repair_feedback:'之前整词审核未得到有效转换。请在完整原文「'+whole.surface+
      '」的语境中验证此独立词的真实语义与词界；只选确实匹配的原始词典选项，不得根据读音强行套用汉字。若不符返回 KEEP。'});
    safeOriginals++;
   }
  }else{
   // Unknown word-internal boundaries cannot be validated by individual
   // dictionary senses; another whole-word answer is the only safe rescue.
   targets.push({...whole,
    recovery_parent:whole.target_id,
    review_reasons:[...new Set([...(whole.review_reasons||[]),'fallback_complete_lexeme'])],
    repair_feedback:'此前整词审核没有生成可用的完整词源。合并前保存了 '+originals.length+
     ' 个词典子项，其中 '+(originals.length-safe.length)+
     ' 个缺少可靠独立词界。请重新判断完整词干「'+whole.surface+
     '」的语义，并逐一核对 component_candidates 的词典释义是否实际适用于此处。'+
     '如果完整汉字词源确凿，优先返回一个覆盖完整词干的 GEN_SEGMENTS；真实混种词才分段。'+
     '不得仅因为子项同音就套用汉字，不确定时继续 KEEP。'});
   wholeRechecks++;
  }
 }
 return {targets,preserved,safeOriginals,wholeRechecks,unsafeComponents};
}

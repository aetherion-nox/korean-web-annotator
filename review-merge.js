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
   ...(components.length?{component_candidates:components}:{})
  };
  for(const prior of collisions)targets.splice(targets.indexOf(prior),1);
  removed+=collisions.length;
  accepted.push(merged);
 }
 return {targets:[...targets,...accepted].sort((a,b)=>a.start-b.start||a.end-b.end),
         added:accepted.length,removed,merged:accepted.length};
}

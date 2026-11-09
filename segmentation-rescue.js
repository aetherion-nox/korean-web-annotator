// Opt-in recovery for whole words Kiwi may have split incorrectly.
// Uses raw Hangul runs, not Kiwi spans. No LLM response can change source offsets.
const HANGUL_RUN=/(?<![가-힣])[가-힣]{2,24}(?![가-힣])/gu;
const overlaps=(a,b)=>a.start<b.end&&b.start<a.end;
export function segmentationTargets(text,analysis,selected=[]){
 // Protect only known names, not the entire paragraph in which a name occurs.
 // Older engines with count-only protection retain the conservative fallback.
 if(!Array.isArray(analysis?.protected_name_spans)&&Number(analysis?.stats?.protected_names||0)>0)return [];
 const existing=[...(analysis?.annotations||[]),...(analysis?.targets||[])].sort((a,b)=>a.start-b.start||a.end-b.end);
 let existingCursor=0;
 const grammatical=analysis?.suffix_spans||[];
 const suffixCovers=(start,end)=>{
  let cursor=start;
  for(const part of grammatical.filter(s=>s.end>cursor&&s.start<end).sort((a,b)=>a.start-b.start)){
   if(part.start!==cursor||part.end>end)return false;
   cursor=part.end;
  }
  return cursor===end;
 };
 // When source-specific name spans are available, they supersede noisy NNP
 // or surname hints. Do not suppress an entire institutional compound merely
 // because one subtoken was heuristically tagged as a proper noun.
 const authoritativeNames=Array.isArray(analysis?.protected_name_spans);
 const protectedTargets=authoritativeNames?[]:(analysis?.targets||[]).filter(t=>
   t.dictionary_person_name===true||t.dictionary_name_homograph===true||
   t.suspected_person_name===true);
 const allowed=Array.isArray(selected)?selected:[];
 const targets=[];
 for(const match of text.matchAll(HANGUL_RUN)){
  const start=match.index,end=start+match[0].length,span={start,end};
  if(allowed.length&&!allowed.some(r=>start>=r.start&&end<=r.end))continue;
  if(protectedTargets.some(t=>overlaps(span,t))||
    (analysis?.protected_name_spans||[]).some(t=>overlaps(span,t)))continue;
  while(existingCursor<existing.length&&existing[existingCursor].end<=start)existingCursor++;
  const overlapsExisting=[];
  for(let j=existingCursor;j<existing.length&&existing[j].start<end;j++){
   if(existing[j].end>start)overlapsExisting.push(existing[j]);
  }
  const risky=(analysis?.boundary_risks||[]).some(t=>overlaps(span,t))||
    (analysis?.targets||[]).some(t=>overlaps(span,t)&&(t.partial_word||t.boundary_unverified));
  // Avoid reviewing every menu item and every ordinary inflected word. A
  // concrete source-boundary warning must exist before raw resegmentation.
  if(!risky)continue;
  if(overlapsExisting.some(x=>x.start===start&&x.end===end))continue;
  const whole=(analysis?.confirmed_whole_spans||[]).some(w=>w.start===start&&
    (w.end===end||(w.end<end&&suffixCovers(w.end,end))));
  if(whole)continue;
  // A unique exact dictionary choice followed only by an attested grammatical
  // particle/ending is already one whole-word semantic task. Do not replace it
  // with an unrelated free-generation segmentation task.
  if(overlapsExisting.length===1&&overlapsExisting[0].options&&
    overlapsExisting[0].start===start&&overlapsExisting[0].end<end&&
    suffixCovers(overlapsExisting[0].end,end))continue;
  const covered=Array.from({length:end-start},(_,i)=>overlapsExisting.some(x=>x.start<=start+i&&x.end>start+i)).every(Boolean);
  if(covered&&overlapsExisting.length<=1&&!risky)continue;
  const options=[{choice_id:'KEEP',type:'keep',replacement:match[0],entry_id:null,definitions:[]}];
  targets.push({target_id:'seg'+start+'-'+end,start,end,surface:match[0],context:text,
    segmentation_review:true,options});
 }
 return targets;
}

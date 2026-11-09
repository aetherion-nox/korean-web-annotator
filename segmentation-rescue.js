// Optional, bounded recovery for whole words Kiwi may have split incorrectly.
// Uses raw Hangul runs, not Kiwi spans. No LLM response can change source offsets.
const HANGUL_RUN=/(?<![가-힣])[가-힣]{2,24}(?![가-힣])/gu;
export const MAX_SEGMENTATION_TARGETS=120;
const MAX_PER_SENTENCE=12;
const overlaps=(a,b)=>a.start<b.end&&b.start<a.end;
export function segmentationTargets(text,analysis,selected=[],{max=MAX_PER_SENTENCE}={}){
 if(!Number.isInteger(max)||max<=0)return [];
 // We cannot safely infer missing name coordinates from a count-only backend response.
 // Conservatively avoid entire sentences with protected names.
 if(Number(analysis?.stats?.protected_names||0)>0)return [];
 const existing=[...(analysis?.annotations||[]),...(analysis?.targets||[])];
 const protectedTargets=(analysis?.targets||[]).filter(t=>
   t.proper_noun===true||t.dictionary_person_name===true||
   t.dictionary_name_homograph===true||t.suspected_person_name===true);
 const allowed=Array.isArray(selected)?selected:[];
 const targets=[];
 for(const match of text.matchAll(HANGUL_RUN)){
  const start=match.index,end=start+match[0].length,span={start,end};
  if(allowed.length&&!allowed.some(r=>start>=r.start&&end<=r.end))continue;
  if(protectedTargets.some(t=>overlaps(span,t)))continue;
  const overlapsExisting=existing.filter(x=>overlaps(span,x));
  if(overlapsExisting.some(x=>x.start===start&&x.end===end))continue;
  const covered=Array.from({length:end-start},(_,i)=>overlapsExisting.some(x=>x.start<=start+i&&x.end>start+i)).every(Boolean);
  if(covered&&overlapsExisting.length<=1)continue;
  const options=[{choice_id:'KEEP',type:'keep',replacement:match[0],entry_id:null,definitions:[]}];
  targets.push({target_id:'seg'+start+'-'+end,start,end,surface:match[0],context:text,
    segmentation_review:true,options});
  if(targets.length>=max)break;
 }
 return targets;
}

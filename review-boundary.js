// Shared safety gate: a dictionary reading does not prove a partial word boundary.
const HANGUL=/^[가-힣]$/u;
export const overlaps=(a,b)=>a.start<b.end&&b.start<a.end;
export function hangulRun(text,start,end){let a=start,b=end;while(a>0&&HANGUL.test(text[a-1]))a--;while(b<text.length&&HANGUL.test(text[b]))b++;return {start:a,end:b};}
export function suffixCovers(spans,start,end){
 if(start===end)return true;let i=start;
 for(const s of [...spans].sort((a,b)=>a.start-b.start||a.end-b.end)){
  if(s.end<=i)continue;
  if(s.start!==i||s.end>end)return false;
  i=s.end;if(i===end)return true;
 }
 return false;
}
export function localBoundaryUnsafe(text,annotation,analysis={}){
 if(!/^[가-힣]+$/u.test(annotation.surface))return false;
 const run=hangulRun(text,annotation.start,annotation.end);
 if(run.start===annotation.start&&run.end===annotation.end)return false;
 const suffix=analysis.suffix_spans||[];
 if(run.start===annotation.start&&suffixCovers(suffix,annotation.end,run.end))return false;
 const whole=(analysis.confirmed_whole_spans||[]).some(w=>w.end-w.start>1&&w.start<=annotation.start&&annotation.end<=w.end&&run.start===w.start&&(run.end===w.end||suffixCovers(suffix,w.end,run.end)));
 return !whole;
}
export function safeReviewOption(target,option){
 if(!option)return null;
 if(option.type==='keep'||option.type==='nonconversion'||option.segmentationGenerated)return option;
 if(target.boundary_unverified===true||target.partial_word===true)return target.options.find(o=>o.choice_id==='KEEP')||null;
 return option;
}

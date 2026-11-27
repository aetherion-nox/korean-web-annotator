// Explicit inline Hangul (Hanja) pairs on the current page are direct
// source annotations: the author explicitly supplied the Hanja in parentheses.
// Parse original paragraph text only; never read altered DOM/ruby markup.
// The initial consecutive Hanja run is authoritative even if the parentheses
// continue with dates, explanations, or other metadata. The suffix is NEVER
// included in the replacement, and mismatched Hangul/Hanja lengths are rejected.
const PAREN=/([(\uFF08])(\p{Script=Han}{1,24})(?:[^\p{Script=Han}()（）\r\n][^()（）\r\n]{0,95})?([)\uFF09])/gu;
const PRECEDING=/([가-힣]{1,24})([ \t\u00a0\u3000’”'"「」『』〈〉《》>＞≫»›【】〔〕［］\[\]{}()（）,，、:：;；·⋅—–-]{0,12})$/u;
const EARLIER_WORD=/([가-힣]{1,24})[ \t\u00a0\u3000]{1,12}$/u;
const WORD_CHARACTER=/[가-힣A-Za-z0-9]/u;
const TITLE_OPENERS=new Map([['>','<'],['>>','<<'],['＞','＜'],['≫','≪'],['»','«'],['›','‹']]);
const MAX_EXCERPT=180;

function excerpt(text,start,end){
 const before=text.slice(0,start),after=text.slice(end);
 let left=0,right=text.length;
 const breaks=/[.!?。！？\n]/gu;
 for(const match of before.matchAll(breaks))left=match.index+match[0].length;
 const next=breaks.exec(after);
 if(next)right=end+next.index+next[0].length;
 if(right-left<=MAX_EXCERPT)return text.slice(left,right).trim();
 // Keep the entire actual pair and a useful amount of both neighbors.
 const pairSize=end-start,available=Math.max(0,MAX_EXCERPT-pairSize);
 const lead=Math.min(start-left,Math.floor(available*0.48));
 let from=start-lead,to=Math.min(right,from+MAX_EXCERPT);
 from=Math.max(left,to-MAX_EXCERPT);
 const value=text.slice(from,to).trim();
 return (from>left?'…':'')+value+(to<right?'…':'');
}
function lowerBound(ordered,value){
 let low=0,high=ordered.length;
 while(low<high){const mid=(low+high)>>1;if(ordered[mid][0]<value)low=mid+1;else high=mid;}
 return low;
}
function overlaps(ordered,start,end){
 const pos=lowerBound(ordered,end);
 return pos>0&&ordered[pos-1][1]>start;
}

function hasMatchingTitleDelimiter(text,start,gap){
 if(!/[>＞≫»›]/u.test(gap))return true;
 const close=/^[ \t\u00a0\u3000]*([>＞≫»›]+)[^>＞≫»›]*$/u.exec(gap)?.[1];
 const before=text.slice(Math.max(0,start-14),start);
 const open=/(<<|<|＜|≪|«|‹)[ \t\u00a0\u3000]{0,12}$/u.exec(before)?.[1];
 return open!==undefined&&TITLE_OPENERS.get(close)===open;
}

function alignWords(text,start,surface,hanja){
 const characters=Array.from(hanja);
 const words=[];
 let remaining=characters.length;
 while(true){
  if((start>0&&WORD_CHARACTER.test(text[start-1]))||surface.length>remaining)return [];
  const end=remaining;
  remaining-=surface.length;
  words.push({start,end:start+surface.length,surface,hanja:characters.slice(remaining,end).join('')});
  if(!remaining)return words.reverse();
  // Only whole words separated by short horizontal whitespace can extend a pair.
  const before=text.slice(Math.max(0,start-36),start);
  const previous=EARLIER_WORD.exec(before);
  if(!previous)return [];
  start-=previous[0].length;
  surface=previous[1];
 }
}

export function extractInlineHanjaPairs(text){
 if(typeof text!=='string'||!text)return [];
 const found=[];
 // matchAll creates independent regex state; the opener and closer must match.
 for(const match of text.matchAll(PAREN)){
  const [full,open,hanja,close]=match;
  if((open==='('&&close!==')')||(open==='（'&&close!=='）'))continue;
  const before=text.slice(Math.max(0,match.index-48),match.index);
  const preceding=PRECEDING.exec(before);
  if(!preceding)continue;
  // Only a short stretch of whitespace or punctuation may be between the
  // final Hangul word and the parentheses.
  if(/[.!?。！？\r\n]/u.test(preceding[2]))continue;
  const start=match.index-before.length+preceding.index;
  const words=alignWords(text,start,preceding[1],hanja);
  if(!words.length)continue;
  // Require a matching opening delimiter for angle symbols such as >,
  // which can also appear as comparison operators.
  const firstWordStart=words[0].start;
  if(!hasMatchingTitleDelimiter(text,firstWordStart,preceding[2]))continue;
  // Each word shares the full citation and becomes available after the same
  // closing parenthesis. Slicing by code point preserves original Hanja glyphs.
  const parenthesisEnd=match.index+full.length;
  let citation=excerpt(text,firstWordStart,parenthesisEnd);
  if(words.length>1) citation+='（'+words.map(word=>`${word.surface} → ${word.hanja}`).join('，')+'）';
  for(const word of words){
   if(found.some(pair=>pair.start===word.start&&pair.end===word.end))continue;
   found.push({...word,parenthesisEnd,citation});
  }
 }
 return found;
}

// Complete inline source pairs are authoritative local markup, not LLM
// candidates: do not send them for review or let a native homograph override
// the explicit author's annotation. Count the original Hangul as the target
// span, and leave the printed parenthesized Hanja in the page unchanged.
export function applyInlineHanjaAnnotations(text,analysis,{enabled=true,selected=null,pairs=null}={}){
 const empty={found:0,converted:0,reused:0,removedTargets:0,skipped:0};
 if(!enabled||!Array.isArray(analysis?.targets)||!Array.isArray(analysis?.annotations))
  return {analysis,stats:empty};
 pairs=pairs||extractInlineHanjaPairs(text);
 if(!pairs.length)return {analysis,stats:empty};
 let targets=[...analysis.targets],annotations=[...analysis.annotations];
 let converted=0,reused=0,removedTargets=0,skipped=0;
 const overlapping=(range,pair)=>range.start<pair.end&&range.end>pair.start;
 for(const pair of pairs){
  if(selected&&!selected.some(range=>pair.start>=range.start&&pair.end<=range.end)){
   skipped++;continue;
  }
  const targetsHere=targets.filter(t=>overlapping(t,pair));
  const annotationsHere=annotations.filter(a=>overlapping(a,pair));
  // A larger target/annotation may include adjacent unrelated language.
  // Never erase that non-overlapping material merely to convert the pair.
  if([...targetsHere,...annotationsHere].some(r=>r.start<pair.start||r.end>pair.end)){
   skipped++;continue;
  }
  // Do not insert a zero-length or unalignable substitute. Surrogate-pair
  // characters are counted as Unicode scalar values, not UTF-16 units.
  if(Array.from(pair.surface).length!==Array.from(pair.hanja).length){
   skipped++;continue;
  }
  const identical=annotationsHere.length===1&&annotationsHere[0].start===pair.start&&
   annotationsHere[0].end===pair.end&&annotationsHere[0].type==='hanja'&&
   annotationsHere[0].replacement===pair.hanja;
  if(identical){reused++;continue;}
  targets=targets.filter(t=>!overlapping(t,pair));
  annotations=annotations.filter(a=>!overlapping(a,pair));
  removedTargets+=targetsHere.length;
  annotations.push({
   start:pair.start,end:pair.end,surface:pair.surface,
   replacement:pair.hanja,type:'hanja',
   evidence_source:'inline_hanja_parentheses',
   evidence_excerpt:pair.citation,
   confidence:1
  });
  converted++;
 }
 if(!converted)return {analysis,stats:{found:pairs.length,converted,reused,removedTargets,skipped}};
 targets.sort((a,b)=>a.start-b.start||a.end-b.end);
 annotations.sort((a,b)=>a.start-b.start||a.end-b.end);
 return {analysis:{...analysis,targets,annotations,
  stats:{...analysis.stats,pending:targets.length,
   local_determined:annotations.length}},
  stats:{found:pairs.length,converted,reused,removedTargets,skipped}};
}

// Validate a model-written mixed Hanja/Latin + unchanged-Hangul spelling.
// The Hangul runs are exact, position-sensitive anchors in the original
// source. They can occur at the beginning, middle or end; they are NOT
// assumed to be grammatical suffixes.
const HANGUL=/^[가-힣]+$/u;
const HAN=/^[\p{Script=Han}]+$/u;
const LATIN=/^[\p{Script=Latin}0-9][\p{Script=Latin}\p{M}0-9·.'’()\/&+\-]*$/u;
const HAS_LATIN=/\p{Script=Latin}/u;

/**
 * Return a projection plan for a spelling such as
 *   터부도 -> taboo도, 금기도 -> 禁忌도, 재확인도 -> 재確認도.
 * Reject unsupported scripts, ambiguous source-anchor positions, and any
 * conversion that would consume a Hangul anchor. Latin segments may have
 * arbitrary (nonzero) length relative to Korean; Hanja segments must cover
 * the same number of Hangul syllables as Hanja code points.
 *
 * This is a source-boundary validator, NOT proof of an etymology. The
 * existing experimental-mode permissions and optional Hanja reading check
 * still apply to the resulting projected annotation.
 */
export function alignMixedLiteralOrigin(surface,spelling,config={}){
 if(typeof surface!=='string'||typeof spelling!=='string'||
    !HANGUL.test(surface)||surface.length>300||spelling.length>160||
    !HANGUL.test(spelling.replace(/[^\uac00-\ud7a3]/gu,'')))return null;
 const runs=spelling.match(/[가-힣]+|[^가-힣]+/gu);
 if(!runs||runs.length<2||runs.length>36)return null;
 const pieces=[];
 let hasOrigin=false,hasAnchor=false,hasHanja=false,hasLoanword=false;
 for(const value of runs){
  if(HANGUL.test(value)){hasAnchor=true;pieces.push({value,kind:'anchor',min:value.length});continue;}
  if(HAN.test(value)&&config.experimentalHanja===true){
   hasOrigin=true;hasHanja=true;pieces.push({value,kind:'hanja',min:[...value].length});
  }else if(LATIN.test(value)&&HAS_LATIN.test(value)&&config.experimentalLoanword===true){
   hasOrigin=true;hasLoanword=true;pieces.push({value,kind:'loanword',min:1});
  }else return null;
 }
 if(!hasOrigin||!hasAnchor)return null;
 const minRemaining=new Array(pieces.length+1).fill(0);
 for(let i=pieces.length-1;i>=0;i--)minRemaining[i]=minRemaining[i+1]+pieces[i].min;
 if(minRemaining[0]>surface.length)return null;
 const found=[];const sourceLength=surface.length;
 function walk(i,pos,segments){
  if(found.length>1)return;
  if(i===pieces.length){
   if(pos===sourceLength)found.push(segments);
   return;
  }
  const token=pieces[i];
  if(token.kind==='anchor'){
   if(surface.startsWith(token.value,pos))
    walk(i+1,pos+token.value.length,segments);
   return;
  }
  const endLimit=sourceLength-minRemaining[i+1];
  const minEnd=pos+token.min;
  const maxEnd=token.kind==='hanja'?minEnd:endLimit;
  for(let end=minEnd;end<=Math.min(maxEnd,endLimit);end++){
   if(i+1<pieces.length&&pieces[i+1].kind==='anchor'&&
      !surface.startsWith(pieces[i+1].value,end))continue;
   walk(i+1,end,[...segments,{start:pos,end,surface:surface.slice(pos,end),
    type:token.kind,replacement:token.value}]);
   if(found.length>1)return;
  }
 }
 walk(0,0,[]);
 // Repeated Hangul anchors can create different plausible splits. Never pick
 // an arbitrary one: require a unique, exact source mapping.
 if(found.length!==1||!found[0].length)return null;
 return {type:hasHanja&&hasLoanword?'mixed':hasHanja?'hanja':'loanword',
  replacement:spelling,segments:found[0]};
}

import {primaryHangulReading} from './hanja-reading-data.js';

// Pronunciation evidence only. A phonetic match never proves a candidate is
// the right word in context; every model-authored origin stays unverified.
// The source table contains primary readings, so unknown/polyphonic values
// are fail-closed for automatic output without affecting dictionary entries.
const HAN=/\\p{Script=Han}/u;
const HANGUL=/^[가-힣]$/u;
const DOUBLE_VOWELS=new Set([2,6,7,12,17,20]); // ㅑ ㅕ ㅖ ㅛ ㅠ ㅣ
function initialVariants(reading){
 const code=reading.charCodeAt(0),n=code-0xac00;
 if(n<0||n>=11172)return [];
 const onset=Math.floor(n/588),vowel=Math.floor(n%588/28),rest=n%588;
 // Standard South Korean initial-sound rules (두음법칙):
 // initial ㄹ -> ㅇ before i/y vowels; otherwise initial ㄹ -> ㄴ;
 // initial ㄴ -> ㅇ before i/y vowels.
 if(onset===5)return [String.fromCharCode(0xac00+(DOUBLE_VOWELS.has(vowel)?11:2)*588+rest)];
 if(onset===2&&DOUBLE_VOWELS.has(vowel))return [String.fromCharCode(0xac00+11*588+rest)];
 return [];
}
function beginsWord(context,start){
 return start===0||!/[가-힣]/u.test(context.slice(0,start).at(-1)||'');
}
export function validateModelHanjaReadings(context,annotations){
 let checked=0,missing=0;
 for(const annotation of annotations){
  if(annotation.type!=='hanja')continue;
  const source=[...annotation.surface],origin=[...annotation.replacement];
  if(source.length!==origin.length)return {status:'mismatch',reason:'source/hanja length mismatch'};
  const originalStart=annotation.start;
  let consumed=0;
  for(let i=0;i<source.length;i++){
   const a=source[i],b=origin[i];consumed+=a.length;
   if(!HAN.test(b))continue;
   if(!HANGUL.test(a))return {status:'mismatch',reason:'source is not a Hangul syllable'};
   const reading=primaryHangulReading(b);
   if(!reading){missing++;continue;}
   const starts=beginsWord(context,originalStart+consumed-a.length);
   if(reading!==a&&!(starts&&initialVariants(reading).includes(a)))
    return {status:'mismatch',reason:'Hanja reading does not match source Hangul',character:b,syllable:a};
   checked++;
  }
 }
 return {status:missing?'unknown':'matched',checked,missing};
}

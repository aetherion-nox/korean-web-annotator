import {primaryHangulReading} from './hanja-reading-data.js';

// Multiple character readings are linguistic properties of the Hanja, not
// special-cased words. This supplemental list is deliberately small; unknown
// polyphonic readings return "unknown" rather than being presented as proven.
// Primary mapping remains in hanja-reading-data.js.
const EXTRA_READINGS=new Map([
 ['金',['금']],['率',['율','률']],['不',['불']],['樂',['락','악','요']],
 ['易',['역']],['行',['항']],['更',['경']],['便',['변']],
 ['車',['거']],['長',['장']],['重',['동']],['角',['녹']]
]);
const HAN=/\p{Script=Han}/u;
const HANGUL=/^[가-힣]$/u;
const INITIAL_Y_I_VOWELS=new Set([2,3,6,7,12,16,17,20]); // y/i-related vowels
const syllable=(onset,vowel,final)=>String.fromCharCode(0xac00+onset*588+vowel*28+final);
function parts(reading){
 if(typeof reading!=='string'||reading.length!==1)return null;
 const n=reading.charCodeAt(0)-0xac00;
 return n>=0&&n<11172?{onset:Math.floor(n/588),vowel:Math.floor(n%588/28),final:n%28}:null;
}
function forwardInitialVariant(reading){
 const p=parts(reading);if(!p)return '';
 // ㄹ -> ㅇ before y/i, else ㄹ -> ㄴ; ㄴ -> ㅇ before y/i.
 if(p.onset===5)return syllable(INITIAL_Y_I_VOWELS.has(p.vowel)?11:2,p.vowel,p.final);
 if(p.onset===2&&INITIAL_Y_I_VOWELS.has(p.vowel))return syllable(11,p.vowel,p.final);
 return '';
}
function restoredInitialVariants(reading){
 const p=parts(reading);if(!p)return [];
 // Korean 頭音法則 is conventionally applied only at word onset. In compound
 // interiors a spelling may retain original ㄹ. The primary reading table
 // often gives only the surface onset form (e.g. 영, 량 under ㅇ/ㄹ).
 const extra=[];
 if(p.onset===11&&INITIAL_Y_I_VOWELS.has(p.vowel))
   extra.push(syllable(5,p.vowel,p.final),syllable(2,p.vowel,p.final));
 if(p.onset===2)extra.push(syllable(5,p.vowel,p.final));
 // 量 양 ↔ 량, 療 요 ↔ 료: y glide is not the only affected onset,
 // because some sources record the customary surface rather than the root.
 if(p.onset===11&&!extra.length&&[0,4,8,13].includes(p.vowel))
   extra.push(syllable(5,p.vowel,p.final));
 return extra;
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
  let offset=annotation.start;
  for(let i=0;i<source.length;i++){
   const a=source[i],b=origin[i],start=offset;offset+=a.length;
   if(!HAN.test(b))continue;
   if(!HANGUL.test(a))return {status:'mismatch',reason:'source is not a Hangul syllable'};
   const primary=primaryHangulReading(b);
   const readings=[...new Set([primary,...(EXTRA_READINGS.get(b)||[])].filter(Boolean))];
   if(!readings.length){missing++;continue;}
   const initial=beginsWord(context,start);
   const valid=readings.some(reading=>
      reading===a ||
      (initial&&forwardInitialVariant(reading)===a) ||
      (!initial&&restoredInitialVariants(reading).includes(a))
   );
   if(!valid)return {status:'mismatch',reason:'Hanja readings do not match source Hangul',character:b,syllable:a,known_readings:readings};
   checked++;
  }
 }
 return {status:missing?'unknown':'matched',checked,missing};
}

// Opt-in analysis when no external dictionary has been imported.
// The bundled Kiwi tokenizer proposes word boundaries only. It never invents
// dictionary entries or automatically converts any text.
export const NO_DICTIONARY_IDENTITY=Object.freeze({
 ready:true,dictionary_free:true,
 engine_version:'kiwi-wasm-no-dictionary-v1',
 dictionary_fingerprint:'no-external-dictionary-v1',
 dictionary_metadata:{source_filename:'未提供外部词典（Kiwi + 实验性 LLM）',
  data_version:'no-external-dictionary-v1',total_entries:0,total_senses:0}
});

const LEXICAL=/^(?:NNG|NNB|MAG|MAJ|VV|VA|XR|MM|IC|SL)(?:[-+].*)?$/u;
const NOUN=/^(?:NNG|NNB|XR)(?:[-+].*)?$/u;
const NOUN_SUFFIX=/^(?:XSN|XSM)(?:[-+].*)?$/u;
const PROPER=/^NNP(?:[-+].*)?$/u;
const HANGUL=/[가-힣]/u;

// Positions from Kiwi's JavaScript API are UTF-16 offsets. Keep all source
// envelopes in UTF-16 throughout the browser annotation pipeline.
export function analyzeWithoutDictionary(text,tokens,modes={}){
 if(typeof text!=='string'||!Array.isArray(tokens))throw Error('Invalid Kiwi tokenizer response');
 if(modes.allowNoDictionary!==true||!(modes.hanja||modes.loanword))
  throw Error('无词典模式需要开启实验性汉字词或外来语 LLM 补充选项。');
 const prepared=tokens.map(t=>{
   const start=t.position??t.start,length=t.length??t.len;
   if(!Number.isInteger(start)||!Number.isInteger(length)||start<0||length<=0||
      start+length>text.length)return null;
   return {start,end:start+length,tag:String(t.tag||''),form:String(t.str??t.form??'')};
 }).filter(Boolean).sort((a,b)=>a.start-b.start||b.end-a.end);
 const targets=[],protectedRanges=[],selected=[];
 for(const t of prepared)if(PROPER.test(t.tag)&&HANGUL.test(text.slice(t.start,t.end)))
   protectedRanges.push({start:t.start,end:t.end,reason:'Kiwi NNP'});
 // Whole proper names remain intact even if other Kiwi interpretations
 // contain overlapping common-word tokens.
 for(let i=0;i<prepared.length;i++){
   const first=prepared[i];
   if(!LEXICAL.test(first.tag)||first.end<=first.start)continue;
   let end=first.end,group=[first],j=i;
   // Avoid merging independent nouns across navigation boundaries.
   // Derivational suffixes alone are reliably part of this token.
   if(NOUN.test(first.tag)){
     while(j+1<prepared.length&&prepared[j+1].start===end&&
       NOUN_SUFFIX.test(prepared[j+1].tag)){
       const next=prepared[++j];group.push(next);end=next.end;
     }
   }
   if(end<=first.start||end-first.start>100)continue;
   const start=first.start,surface=text.slice(start,end);
   if(!HANGUL.test(surface)||
      protectedRanges.some(r=>r.start<end&&start<r.end)||
      selected.some(r=>r.start<end&&start<r.end))continue;
   // Reject markup, obvious broken word boundaries and tokens that contain
   // only one of the tokenizer's nonlexical spans.
   if(/[<>\r\n]/u.test(surface))continue;
   targets.push({target_id:'nodict'+targets.length,start,end,surface,context:text,
     options:[{choice_id:'KEEP',type:'keep',replacement:surface,entry_id:null,definitions:[]}],
     morphology:group.map(t=>({form:t.form,tag:t.tag,start:t.start,end:t.end}))});
   selected.push({start,end});
 }
 return {...NO_DICTIONARY_IDENTITY,annotations:[],targets,
  repair_context:{kiwi_tokens:prepared.map(t=>({...t,form:t.form})),protected_ranges:protectedRanges},
  stats:{local_determined:0,pending:targets.length,protected_names:protectedRanges.length}};
}

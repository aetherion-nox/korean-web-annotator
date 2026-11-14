import {browserEngineStatus,browserAnalyze} from './browser-engine.js';
import {normalizeBatchContextTier,normalizeOutputTokenLimit} from './batch-budget.js';
const CJK=/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{323af}]/u;
export function projectAnnotation(text,annotation){
 const {start,end,surface,replacement,type}=annotation;
 if(type==='nonconversion'){
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||text.slice(start,end)!==surface||replacement!==surface||annotation.segments)throw Error('Invalid non-conversion sense');
  return [];
 }
 if(Array.isArray(annotation.segments)){
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||text.slice(start,end)!==surface||!['hanja','loanword','mixed'].includes(type)||!annotation.segments.length)throw Error('Invalid segmented annotation');
  let previous=0,display=surface;const output=[];
  for(const part of annotation.segments){
   if(!part||!Number.isInteger(part.start)||!Number.isInteger(part.end)||part.start<previous||part.end>surface.length||part.end<=part.start||part.segments)throw Error('Invalid origin segments');
   previous=part.end;
   output.push(...projectAnnotation(text,{...part,start:start+part.start,end:start+part.end}));
  }
  for(const part of [...annotation.segments].reverse())display=display.slice(0,part.start)+part.replacement+display.slice(part.end);
  if(display!==replacement)throw Error('Segment replacement mismatch');
  return output;
 }

 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||text.slice(start,end)!==surface||typeof replacement!=='string'||!replacement||/[<>\x00-\x1f\x7f]/.test(replacement)||!['hanja','loanword'].includes(type))throw Error('Invalid engine annotation');
 const src=Array.from(surface),dst=Array.from(replacement);
 let prefix=0,suffix=0;
 while(prefix<src.length && prefix<dst.length && src[prefix]===dst[prefix])prefix++;
 while(suffix<src.length-prefix && suffix<dst.length-prefix && src[src.length-1-suffix]===dst[dst.length-1-suffix])suffix++;
 const left=src.slice(0,prefix).join('').length;
 const changedSrc=src.slice(prefix,src.length-suffix),changedDst=dst.slice(prefix,dst.length-suffix);
 if(!changedSrc.length)return [];
 const make=(a,b,repl)=>({...annotation,start:start+left+a,end:start+left+b,surface:changedSrc.join('').slice(a,b),replacement:repl,confidence:1});
 if(type==='loanword')return [make(0,changedSrc.join('').length,changedDst.join(''))];
 if(changedSrc.length!==changedDst.length)throw alignmentError('Unalignable Hanja');
 const output=[];let offset=0,runStart=null,runReplacement='';
 for(let i=0;i<changedSrc.length;i++){
  if(CJK.test(changedDst[i])){if(!/^[가-힣]$/u.test(changedSrc[i]))throw alignmentError('Invalid Hanja source');if(runStart===null)runStart=offset;runReplacement+=changedDst[i];}
  else {if(changedDst[i]!==changedSrc[i])throw alignmentError('Invalid Hanja context');if(runStart!==null){output.push(make(runStart,offset,runReplacement));runStart=null;runReplacement='';}}
  offset+=changedSrc[i].length;
 }
 if(runStart!==null)output.push(make(runStart,offset,runReplacement));
 return output;
}
function alignmentError(message){const error=Error(message);error.code='KRA_HANJA_ALIGNMENT';return error;}
export function validateAnalysis(text,data){
 if(!data||typeof data.engine_version!=='string'||typeof data.dictionary_fingerprint!=='string'||!Array.isArray(data.annotations)||!Array.isArray(data.targets)||!data.stats)throw Error('Invalid local engine response');
 // Reject conflicting source envelopes before dropping any unalignable word.
 const sourceRanges=[...data.annotations,...data.targets].map(a=>{
  if(!a||!Number.isInteger(a.start)||!Number.isInteger(a.end)||a.start<0||a.end<=a.start||text.slice(a.start,a.end)!==a.surface)throw Error('Invalid engine source span');
  return [a.start,a.end];
 }).sort((a,b)=>a[0]-b[0]);
 if(sourceRanges.some((r,i)=>i&&r[0]<sourceRanges[i-1][1]))throw Error('Overlapping engine spans');
  const dictionaryFree=data.dictionary_free===true;
  if(dictionaryFree && (data.annotations.length||data.targets.some(t=>
    !Array.isArray(t.options)||t.options.some(o=>o.type!=='keep'))))
   throw Error('Dictionary-free engine cannot supply dictionary conversions or senses');
 const annotations=[],targets=[],diagnostics=Array.isArray(data.diagnostics)?data.diagnostics.filter(d=>d?.stage==='alignment'&&d.level==='warning'&&typeof d.message==='string'&&typeof d.detail==='string'):[];
 let rejectedAnnotations=0,rejectedTargets=0,rejectedOptions=0;
 const warn=(a,error,option=false)=>diagnostics.push({stage:'alignment',level:'warning',message:option?'已移除无法可靠对齐的汉字候选，保留其他候选；无可用候选时保留原文。':'已跳过无法可靠对齐的汉字词，保留原文并继续处理。',detail:JSON.stringify({surface:a.surface,replacement:a.replacement,start:a.start,end:a.end,entry_id:a.entry_id,source_characters:Array.from(a.surface).length,replacement_characters:Array.from(a.replacement).length,reason:error.message})});
 for(const a of data.annotations){
  try{annotations.push(...projectAnnotation(text,a));}
  catch(error){if(error.code!=='KRA_HANJA_ALIGNMENT')throw error;rejectedAnnotations++;warn(a,error);}
 }
 const ids=new Set(),ranges=[];
 for(const a of annotations)ranges.push([a.start,a.end]);
 for(const t of data.targets){
  if(t.proper_noun!==undefined&&typeof t.proper_noun!=='boolean')throw Error('Invalid proper-noun hint');
  if(t.suspected_person_name!==undefined&&typeof t.suspected_person_name!=='boolean')throw Error('Invalid suspected-name hint');
  if(typeof t.target_id!=='string'||ids.has(t.target_id)||!Number.isInteger(t.start)||!Number.isInteger(t.end)||t.start<0||t.end<=t.start||text.slice(t.start,t.end)!==t.surface||t.context!==text||!Array.isArray(t.options))throw Error('Invalid engine target');
  ids.add(t.target_id);const choices=new Set(),validOptions=[];
  for(const o of t.options){
   if(Object.keys(o).some(k=>!['choice_id','type','replacement','entry_id','definitions','segments','written_form','part_of_speech','subject_category','semantic_category'].includes(k)))throw Error('Invalid engine option fields');
   if(o.written_form!==undefined&&typeof o.written_form!=='string'||o.part_of_speech!==undefined&&o.part_of_speech!==null&&typeof o.part_of_speech!=='string')throw Error('Invalid dictionary metadata');
   for(const key of ['subject_category','semantic_category'])if(o[key]!==undefined&&o[key]!==null&&typeof o[key]!=='string')throw Error('Invalid dictionary category');
   if(typeof o.choice_id!=='string'||choices.has(o.choice_id)||!Array.isArray(o.definitions))throw Error('Invalid engine option');
   choices.add(o.choice_id);
   if(o.choice_id==='KEEP'&&o.type!=='keep')throw Error('Invalid KEEP');
   if(o.type==='keep'){if(o.choice_id!=='KEEP'||o.replacement!==t.surface)throw Error('Invalid KEEP');}
   else if(o.type==='nonconversion'){
    if(o.replacement!==t.surface||o.entry_id===undefined||o.entry_id===null||o.segments||!o.definitions.length||o.definitions.some(d=>typeof d!=='string'||!d))throw Error('Invalid non-conversion sense');
   }
   else{
    if(o.entry_id===undefined||o.entry_id===null)throw Error('Missing dictionary entry');
    const a={...o,start:t.start,end:t.end,surface:t.surface,context:t.context};
    try{projectAnnotation(text,a);}catch(error){if(error.code!=='KRA_HANJA_ALIGNMENT')throw error;rejectedOptions++;warn(a,error,true);continue;}
   }
   validOptions.push(o);
  }
  if(!choices.has('KEEP'))throw Error('Missing KEEP');
  const convertible=validOptions.some(o=>['hanja','loanword','mixed'].includes(o.type));
  const nameOnlyReview=(t.suspected_person_name===true||t.dictionary_name_homograph===true)&&validOptions.some(o=>o.type==='nonconversion');
   // Dictionary-free inputs have KEEP only; the model can propose allowed
   // Hanja/Latin origins which are independently validated before application.
   if(!convertible&&!nameOnlyReview&&!dictionaryFree&&t.experimental_loanword_audit!==true){rejectedTargets++;continue;}
  targets.push({...t,options:validOptions});ranges.push([t.start,t.end]);
 }
 ranges.sort((a,b)=>a[0]-b[0]);if(ranges.some((r,i)=>i&&r[0]<ranges[i-1][1]))throw Error('Overlapping engine spans');
 return {...data,annotations,targets,diagnostics,stats:{...data.stats,local_determined:Math.max(0,Number(data.stats.local_determined||0)-rejectedAnnotations),pending:Math.max(0,Number(data.stats.pending||0)-rejectedTargets),structural_rejections:Number(data.stats.structural_rejections||0)+rejectedAnnotations+rejectedTargets,rejected_options:Number(data.stats.rejected_options||0)+rejectedOptions}};
}
export async function engineConfig(){
 const {enableModelReview=false,reviewAllCandidates=false,manualModelReview=false,experimentalHanja=false,experimentalLoanword=false,hanjaReadingCheck=true,smartSegmentation=false,reviewLocalConversions=true,batchContextTier,manualOutputTokenLimit,apiOutputTokenLimit,nameProtection=true,filterDictionaryPeople=true,reviewPosFilter=true}=await chrome.storage.local.get(['enableModelReview','reviewAllCandidates','manualModelReview','experimentalHanja','experimentalLoanword','hanjaReadingCheck','smartSegmentation','reviewLocalConversions','batchContextTier','manualOutputTokenLimit','apiOutputTokenLimit','nameProtection','filterDictionaryPeople','reviewPosFilter']);
 return {reviewPosFilter:reviewPosFilter!==false,nameProtection:nameProtection!==false,filterDictionaryPeople:filterDictionaryPeople!==false,enableModelReview:enableModelReview===true||reviewAllCandidates===true||manualModelReview===true||experimentalHanja===true||experimentalLoanword===true||smartSegmentation===true,reviewAllCandidates:reviewAllCandidates===true,manualModelReview:manualModelReview===true,experimentalHanja:experimentalHanja===true,experimentalLoanword:experimentalLoanword===true,hanjaReadingCheck:hanjaReadingCheck!==false,smartSegmentation:smartSegmentation===true,reviewLocalConversions:reviewLocalConversions!==false,batchContextTier:normalizeBatchContextTier(batchContextTier),manualOutputTokenLimit:normalizeOutputTokenLimit(manualOutputTokenLimit,true),apiOutputTokenLimit:normalizeOutputTokenLimit(apiOutputTokenLimit,false)};
}
export const engineStatus=browserEngineStatus;
export const analyzeLocal=browserAnalyze;

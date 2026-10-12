import {browserEngineStatus,browserAnalyze} from './browser-engine.js';
const CJK=/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{323af}]/u;
export function projectAnnotation(text,annotation){
 const {start,end,surface,replacement,type}=annotation;
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
 const annotations=[],targets=[],diagnostics=Array.isArray(data.diagnostics)?data.diagnostics.filter(d=>d?.stage==='alignment'&&d.level==='warning'&&typeof d.message==='string'&&typeof d.detail==='string'):[];
 let rejectedAnnotations=0,rejectedTargets=0;
 const warn=(a,error)=>diagnostics.push({stage:'alignment',level:'warning',message:'已跳过无法可靠对齐的汉字词，保留原文并继续处理。',detail:JSON.stringify({surface:a.surface,replacement:a.replacement,start:a.start,end:a.end,entry_id:a.entry_id,source_characters:Array.from(a.surface).length,replacement_characters:Array.from(a.replacement).length,reason:error.message})});
 for(const a of data.annotations){
  try{annotations.push(...projectAnnotation(text,a));}
  catch(error){if(error.code!=='KRA_HANJA_ALIGNMENT')throw error;rejectedAnnotations++;warn(a,error);}
 }
 const ids=new Set(),ranges=[];
 for(const a of annotations)ranges.push([a.start,a.end]);
 for(const t of data.targets){
  if(typeof t.target_id!=='string'||ids.has(t.target_id)||!Number.isInteger(t.start)||!Number.isInteger(t.end)||t.start<0||t.end<=t.start||text.slice(t.start,t.end)!==t.surface||t.context!==text||!Array.isArray(t.options))throw Error('Invalid engine target');
  ids.add(t.target_id);const choices=new Set();let unalignable=false;
  for(const o of t.options){
   if(Object.keys(o).some(k=>!['choice_id','type','replacement','entry_id','definitions'].includes(k)))throw Error('Invalid engine option fields');
   if(typeof o.choice_id!=='string'||choices.has(o.choice_id)||!Array.isArray(o.definitions))throw Error('Invalid engine option');
   choices.add(o.choice_id);
   if(o.choice_id==='KEEP'&&o.type!=='keep')throw Error('Invalid KEEP');
   if(o.type==='keep'){if(o.choice_id!=='KEEP'||o.replacement!==t.surface)throw Error('Invalid KEEP');}
   else{
    if(o.entry_id===undefined||o.entry_id===null)throw Error('Missing dictionary entry');
    const a={...o,start:t.start,end:t.end,surface:t.surface,context:t.context};
    try{projectAnnotation(text,a);}catch(error){if(error.code!=='KRA_HANJA_ALIGNMENT')throw error;unalignable=true;warn(a,error);}
   }
  }
  if(!choices.has('KEEP'))throw Error('Missing KEEP');
  if(unalignable){rejectedTargets++;continue;}
  targets.push(t);ranges.push([t.start,t.end]);
 }
 ranges.sort((a,b)=>a[0]-b[0]);if(ranges.some((r,i)=>i&&r[0]<ranges[i-1][1]))throw Error('Overlapping engine spans');
 return {...data,annotations,targets,diagnostics,stats:{...data.stats,local_determined:Math.max(0,Number(data.stats.local_determined||0)-rejectedAnnotations),pending:Math.max(0,Number(data.stats.pending||0)-rejectedTargets),structural_rejections:Number(data.stats.structural_rejections||0)+rejectedAnnotations+rejectedTargets}};
}
export async function engineConfig(){
 const {enableModelReview=false}=await chrome.storage.local.get(['enableModelReview']);
 return {enableModelReview:enableModelReview===true};
}
export const engineStatus=browserEngineStatus;
export const analyzeLocal=browserAnalyze;

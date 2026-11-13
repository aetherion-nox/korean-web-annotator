// v1.1.56 positional-only response protocol. No legacy object-row decoding.
// Full answers preserve every target position, including scan-only and repaired
// original targets. Manual partial resubmission uses explicit zero-based indices.
export const POSITIONAL_RESPONSE_FORMAT='positional-v1';
export function parsePositionalResults(targets,response,{allowPartial=false,retired=new Set(),smartSegmentation=false}={}){
 const result={values:new Map(),problems:new Map(),malformed:false,partial:false};
 if(!response||typeof response!=='object'||Array.isArray(response)||
    !Array.isArray(response.results)){
  result.malformed=true;return result;
 }
 const rows=response.results;
 const partial=response.partial===true;
 result.partial=partial;
 if(partial&&!allowPartial){result.malformed=true;return result;}
 if(!partial&&rows.length!==targets.length){result.malformed=true;return result;}
 const seen=new Set();
 for(let i=0;i<rows.length;i++){
  const pair=partial?rows[i]:null;
  const index=partial&&Array.isArray(pair)?pair[0]:i;
  const value=partial&&Array.isArray(pair)?pair[1]:rows[i];
  if(partial&&(!Array.isArray(pair)||pair.length!==2||
     !Number.isSafeInteger(index)||index<0||index>=targets.length||seen.has(index))){
   result.malformed=true;return result;
  }
  seen.add(index);
  // String origins and dictionary choice keys are the only non-null values.
  // false is reserved for scan_only or a SAFELY validated repair; it is not
  // a synonym for keeping ordinary Hangul.
  if(value!==null&&value!==false&&
     (typeof value!=='string'||!value||value.length>180)){
   result.problems.set(index,'unsupported positional value');continue;
  }
  const target=targets[index];
  if(value===false&&(!smartSegmentation||
     !(target.scan_only===true||retired.has(target.target_id)))){
   result.problems.set(index,'false needs a validated repair or scan_only target');continue;
  }
  result.values.set(index,value);
 }
 return result;
}
export function keepOption(target){
 return target?.options?.find(o=>o.type==='keep')||null;
}
export function choiceFromValue(target,value,config={},makeLiteral=()=>null){
 if(value===null)return keepOption(target);
 if(typeof value!=='string')return null;
 const candidate=target?.options?.find(o=>o.type!=='keep'&&o.choice_id===value);
 return candidate||makeLiteral(target,value,config);
}
export function indexedPartialRows(targets,missingIndices,values){
 // Explicit index mapping is never inferred from a shortened value array.
 return [...missingIndices].map(i=>[i,values.get(i)]);
}

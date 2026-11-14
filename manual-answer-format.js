// Manual answers have one canonical format, but the wrapper is not part of
// the annotation. Keep identity checks separate from per-row origin checks.
export function normalizeManualAnswer(value,{requestId,knownTargetIds}={}){
 const response=Array.isArray(value)?{results:value}:value;
 if(!response||typeof response!=='object'||Array.isArray(response)||
    !Array.isArray(response.results))
  throw Error('结果必须是 t/c 数组，或包含 results 数组的 JSON 对象。');
 if(typeof requestId!=='string'||!requestId)throw Error('当前批次没有可验证的请求 ID。');
 // Some models accidentally emit {"t":"t29","n2":"c0"}, using a
 // nonconversion choice ID as the property name. This is a known target with
 // an unusable conversion response, NOT an unknown target. Converting it to
 // JSON null can only preserve the Korean source and cannot fabricate Hanja.
 // Do not guess what an arbitrary extra property means.
 const results=response.results.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||
     typeof row.t!=='string'||!/^n\d+$/u.test(Object.keys(row).find(k=>k!=='t')||'')||
     Object.keys(row).length!==2||Object.hasOwn(row,'c'))return row;
  return {t:row.t,c:null};
 });
 const normalized={...response,results};
 if(Object.hasOwn(response,'batch_id')){
  if(response.batch_id!==requestId)
   throw Error('batch_id 与当前批次不一致，请检查是否粘贴了其他批次的答案。');
  return normalized;
 }
 // IDs in an omitted-ID response must be unambiguously bound to the one
 // pending request. Unknown/foreign IDs cannot be partly saved as this batch.
 // Repair-only answers have no t/c proof: require an explicit batch_id.
 const ids=knownTargetIds instanceof Set?knownTargetIds:new Set(knownTargetIds||[]);
 if(!normalized.results.length||
    normalized.results.some(row=>!row||typeof row!=='object'||Array.isArray(row)||
      typeof row.t!=='string'||!ids.has(row.t)))
  throw Error('缺少 batch_id，且无法确认全部 t 属于当前批次。请补上当前批次 ID，或检查未知的 t。');
 return {...normalized,batch_id:requestId};
}

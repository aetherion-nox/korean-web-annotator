// Snapshot-only recovery after an MV3 background worker/port is retired.
// The caller is the still-open top-level content script. Do NOT cache any
// document references here: every recipient rechecks its original DOM text.
export function partitionMergedManualRecovery(topology,backup,response,originalPrompt=''){
 if(!Array.isArray(topology)||!topology.length||!backup||typeof backup.requestId!=='string')
  throw Error('跨框架恢复快照不完整。请保留答案，重新开始审核。');
 if(!response||response.batch_id!==backup.requestId||!Array.isArray(response.results))
  throw Error('batch_id 与当前批次不一致或缺少 results。');
 if(response.repairs!==undefined&&!Array.isArray(response.repairs))
  throw Error('repairs 必须是数组。');
 if(!Array.isArray(backup.bindings)||!backup.bindings.length)
  throw Error('当前批次没有可恢复的目标快照。');
 const sourceById=new Map();
 for(const record of topology){
  if(!record||typeof record.sentenceId!=='string'||!record.sentenceId||
     typeof record.localId!=='string'||!record.localId||
     !Number.isInteger(record.frameId)||record.frameId<0||
     typeof record.operationId!=='string'||!record.operationId||
     sourceById.has(record.sentenceId))throw Error('跨框架句子映射无效。');
  sourceById.set(record.sentenceId,record);
 }
 const known=new Map(),frames=new Map(),frameKey=t=>t.frameId+':'+t.operationId;
 function byOwner(owner){
  const key=frameKey(owner);
  if(!frames.has(key))frames.set(key,{frameId:owner.frameId,operationId:owner.operationId,
    entries:[],sentenceIds:new Set(),bindings:[],targetIds:new Set(),repairs:[]});
  const frame=frames.get(key);frame.sentenceIds.add(owner.sentenceId);return frame;
 }
 for(const binding of backup.bindings){
  if(!binding||typeof binding.target_id!=='string'||known.has(binding.target_id))
   throw Error('当前批次存在重复或无效的目标快照。');
  const owner=sourceById.get(binding.sentenceId);
  if(!owner)throw Error('当前批次包含无法归属到原始框架的目标。');
  known.set(binding.target_id,owner);
  const frame=byOwner(owner);
  frame.bindings.push({...binding,sentenceId:owner.localId});
  frame.targetIds.add(binding.target_id);
 }
 const seen=new Set();
 for(const row of response.results){
  if(!row||typeof row!=='object'||Array.isArray(row)||
     Object.keys(row).sort().join(',')!=='c,t'||
     typeof row.t!=='string'||!known.has(row.t)||
     !(row.c===null||(typeof row.c==='string'&&row.c.length>0))||seen.has(row.t))
   throw Error('答案包含未知/重复 t 或无效的 c；请使用当前批次的完整 t/c 结果。');
  seen.add(row.t);
  const frame=byOwner(known.get(row.t));
  (frame.rows ||= []).push(row);
 }
 for(const repair of response.repairs||[]){
  const owner=sourceById.get(repair?.sentence_id);
  if(!owner)throw Error('分词修复的 sentence_id 不属于当前批次。');
  const frame=byOwner(owner);
  if((repair.old_target_ids||[]).some(id=>!frame.targetIds.has(id)))
   throw Error('分词修复不能跨越不同 iframe 的目标。');
  frame.repairs.push({...repair,sentence_id:owner.localId});
 }
 const original=originalPrompt.indexOf('{"format":"shared-pools-v4"');
 const payload=backup.smartSegmentation&&original>=0?
  (()=>{try{return JSON.parse(originalPrompt.slice(original));}catch{return null;}})():null;
 for(const frame of frames.values()){
  const ids=frame.targetIds;
  const from=sourceById;
  const ownSentences=new Set([...from].filter(([,owner])=>owner.frameId===frame.frameId&&owner.operationId===frame.operationId).map(([id])=>id));
  const originalValidation=backup.repairValidation;
  const repairValidation=backup.smartSegmentation&&originalValidation?{
   ...originalValidation,
   targets:(originalValidation.targets||[]).filter(t=>ids.has(t.target_id)).map(t=>({
     ...t,repair_sentence_key:from.get(t.repair_sentence_key)?.localId||t.repair_sentence_key
   })),
   scopes:(originalValidation.scopes||[]).filter(([id])=>ownSentences.has(id)).map(([id,scope])=>[from.get(id).localId,scope])
  }:undefined;
  let prompt=originalPrompt;
  if(backup.smartSegmentation){
   if(!payload)throw Error('智能分词修复需要原始提示词安全快照。');
   const framePayload={
    ...payload,
    targets:(payload.targets||[]).filter(t=>ids.has(t.target_id)).map(t=>({
     ...t,sentence_id:from.get(t.sentence_id)?.localId||t.sentence_id
    })),
    sentences:(payload.sentences||[]).filter(s=>ownSentences.has(s.sentence_id)).map(s=>({
     ...s,sentence_id:from.get(s.sentence_id).localId
    }))
   };
   const pools=new Set(framePayload.targets.flatMap(t=>Object.values(t.options||{})));
   framePayload.candidates=(framePayload.candidates||[]).filter(c=>pools.has(c.candidate_id));
   prompt=originalPrompt.slice(0,original)+JSON.stringify(framePayload);
  }
  frame.backup={...backup,bindings:frame.bindings,repairValidation};
  frame.answer=JSON.stringify({batch_id:backup.requestId,results:frame.rows||[],
    ...(response.repairs!==undefined?{repairs:frame.repairs}:{})});
  frame.originalPrompt=prompt;
  delete frame.entries;delete frame.sentenceIds;delete frame.bindings;delete frame.targetIds;
  delete frame.rows;delete frame.repairs;
 }
 return [...frames.values()].sort((a,b)=>a.frameId-b.frameId);
}

import {filterReviewTarget,filterReviewTargets} from './review-pos.js';
import {prepareRequest, thinkingSettings} from './provider-adapter.js';
export {thinkingSettings} from './provider-adapter.js';
import {readModelContent,choicePreviewParser,experimentalChoicePreviewParser} from './model-stream.js';
import {requestLogger} from './request-log.js';
import './model-catalog.js';
import {buildReviewPayload,buildReviewInstructions,normalizePooledChoiceAnswers} from './review-payload.js';
import {literalOriginOption,explainLiteralOriginRejection} from './experimental-options.js';
import {summarizeExperimentalHanjaAnswers} from './experimental-hanja-diagnostics.js';
import {validateSegmentationRepairs} from './segmentation-repairs.js';
import {normalizeOutputTokenLimit,describeBatchBudget} from './batch-budget.js';
import {requestTimeoutGuard} from './request-timeout.js';
import {parsePartialReviewJson} from './partial-review-json.js';
// Response rows have one wire format only: {t, c}. The special null
// c means keep the source. The Latin string "KEEP" is never a fallback marker; null alone means no conversion.
function validWireRow(row,known){
 return row&&typeof row==='object'&&!Array.isArray(row)&&
  Object.keys(row).sort().join(',')==='c,t'&&
  typeof row.t==='string'&&known.has(row.t)&&
  (row.c===null||(typeof row.c==='string'&&row.c.trim().length>0));
}
// Model-written Hangul is not an origin spelling. If it is exactly the
// current source surface, treat it as an explicit keep, never as a new origin.
export function identicalHangulKeep(target,value){
 return typeof value==='string'&&target&&value===target.surface&&
  /^[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7a3\ud7b0-\ud7ff]+$/u.test(value);
}
export function explicitNullChoice(value){
 return value===null||(typeof value==='string'&&value.toLowerCase()==='null');
}
function matchedWireOption(target,value,config){
 const options=filterReviewTarget(target,config).options;
 if(explicitNullChoice(value)||identicalHangulKeep(target,value))return options.find(o=>o.type==='keep')||null;
 const selected=options.find(o=>o.type!=='keep'&&o.choice_id===value);
 if(selected)return selected;
 // Backend-only recovery: pooled p IDs are resolved to a real choice_id
 // using the private, source-bound index. That local choice may have been
 // hidden from the prompt by the optional POS filter; accepting it here is
 // safe because the original engine verified the Hanja/loanword projection.
 // A model-written raw c/n key is separately rejected by the pool decoder.
 const original=target.options.find(o=>o.type!=='keep'&&o.choice_id===value);
 if(original&&['hanja','loanword','mixed'].includes(original.type))return original;
 if(!selected&&typeof value==='string'&&target.dictionary_person_name===true&&
    target.verified_person_hanja?.includes(value)){
  const matched=options.find(o=>o.type==='hanja'&&o.replacement===value&&o.entry_id!=null);
  if(matched)return matched;
 }
 // A real, target-specific dictionary choice is independently valid as an
 // option ID. The optional Hanja reading checker is ONLY for model-written
 // experimental spellings, not dictionary-backed c/n selections.
 // Meaning, named-entity and word boundaries are still checked by the model
 // and the existing review/option safety filters.
 return selected||null;
}
// Only structurally valid t/c rows participate in duplicate detection.
// Missing/malformed-only targets keep Korean in discard mode.
function implicitNullChoice(target,rows,config){
 if(config.discardInvalidReviewResults!==true)return null;
 if(rows.length!==0)return null;
 const option=target.options.find(o=>o.type==='keep');
 return option?{target,option,implicitNull:true}:null;
}
function discardedChoice(target,config){
 if(config.discardInvalidReviewResults!==true)return null;
 const option=target.options.find(o=>o.type==='keep');
 return option?{target,option,discardedInvalid:true}:null;
}
function ambiguousRepeatedRows(rows){
 return rows.length>1&&rows.some(row=>row.c!==rows[0].c);
}
function groupedRows(targets,response,config){
 const known=new Map(targets.map(t=>[t.target_id,t])),result=new Map();
 const rows=Array.isArray(response?.results)?response.results:[];
 if((!response||!Array.isArray(response.results))&&config.discardInvalidReviewResults===true)
  return result;
 if(!response||!Array.isArray(response.results)||Object.hasOwn(response,'experimental_options'))
  return null;
 // Filter malformed rows first. Exact repeated t/c values count as one;
 // conflicting c values for a known t invalidate the target.
 const knownIds=new Set(known.keys());
 for(const row of rows){
  if(!validWireRow(row,knownIds))continue;
  if(!result.has(row.t))result.set(row.t,[]);
  result.get(row.t).push(identicalHangulKeep(known.get(row.t),row.c)?{...row,c:null}:row);
 }
 return result;
}
export function validateChoices(targets,response,config={}){
 const accepted=[],unresolved=[],invalidDictionaryChoiceIds=[];
 const grouped=groupedRows(targets,response,config);
 if(!grouped)return {accepted:[],unresolved:targets,invalidDictionaryChoiceIds:[]};
 for(const target of targets){
  const rows=grouped.get(target.target_id)||[];
  const implicit=implicitNullChoice(target,rows,config);
  if(implicit){accepted.push(implicit);continue;}
  if(rows.length===0||ambiguousRepeatedRows(rows)||!validWireRow(rows[0],new Set([target.target_id]))){
   const dropped=discardedChoice(target,config);
   if(dropped)accepted.push(dropped);else unresolved.push(target);
   continue;
  }
  const value=rows[0].c;
  const option=matchedWireOption(target,value,config);
  if(option){accepted.push({target,option});continue;}
  const dropped=discardedChoice(target,config);
  if(dropped)accepted.push(dropped);
  else {unresolved.push(target);invalidDictionaryChoiceIds.push(target.target_id);}
 }
 return {accepted,unresolved,invalidDictionaryChoiceIds};
}
export function validateExperimentalChoices(targets,response,config={}){
 const grouped=groupedRows(targets,response,config);
 if(!grouped)return {accepted:[],unresolved:targets,experimentalAccepted:0,experimentalProposed:0,experimentalRejected:0,invalidDictionaryChoiceIds:[]};
 const accepted=[],unresolved=[],invalidDictionaryChoiceIds=[];
 let experimentalAccepted=0,experimentalRejected=0;
 const rejectionCounts={},rejectionSamples=[];
 for(const target of targets){
  const rows=grouped.get(target.target_id)||[];
  const implicit=implicitNullChoice(target,rows,config);
  if(implicit){accepted.push(implicit);continue;}
  if(rows.length===0||ambiguousRepeatedRows(rows)||!validWireRow(rows[0],new Set([target.target_id]))){
   const dropped=discardedChoice(target,config);
   if(dropped)accepted.push(dropped);else unresolved.push(target);
   continue;
  }
  const id=rows[0].c;
  const option=matchedWireOption(target,id,config);
  if(option){accepted.push({target,option});continue;}
  const generated=literalOriginOption(target,id,config);
  if(generated){accepted.push({target,option:generated});experimentalAccepted++;continue;}
  const dropped=discardedChoice(target,config);
  if(dropped)accepted.push(dropped);
  else {unresolved.push(target);invalidDictionaryChoiceIds.push(target.target_id);}
  experimentalRejected++;
  const reason=explainLiteralOriginRejection(target,id,config);
  rejectionCounts[reason]=(rejectionCounts[reason]||0)+1;
  if(rejectionSamples.length<16)rejectionSamples.push({target_id:target.target_id,surface:target.surface,c:id,reason});
 }
 return {accepted,unresolved,invalidDictionaryChoiceIds,
  experimentalAccepted,experimentalProposed:experimentalAccepted,experimentalRejected,rejectionCounts,rejectionSamples};
}
export function safeDetail(value,config={}){
 let text=String(value||'');
 for(const secret of [config.apiKey,config.engineToken])if(secret)text=text.split(secret).join('[REDACTED]');
 return text.replace(/Bearer\s+[^\s"'<>]+/gi,'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]+/g,'[REDACTED]').slice(0,3000);
}
export function modelTargets(targets,config={}){
 return filterReviewTargets(targets,config).map(t=>({target_id:t.target_id,start:t.start,end:t.end,surface:t.surface,context:t.context,...(t.adjacent_context?{adjacent_context:t.adjacent_context}:{}),...(t.morphology?{morphology:t.morphology}:{}),...(t.pos_conflict?{pos_conflict:true}:{}),...(t.proper_noun===true?{proper_noun:true}:{}),...(t.dictionary_person_name===true?{dictionary_person_name:true}:{}),...(Array.isArray(t.verified_person_hanja)&&t.verified_person_hanja.length?{verified_person_hanja:t.verified_person_hanja}:{}),...(t.dictionary_name_homograph===true?{dictionary_name_homograph:true}:{}),...(t.suspected_person_name===true?{suspected_person_name:true}:{}),...(t.protected_name_boundary===true?{protected_name_boundary:true}:{}),...(t.experimental_hanja_audit===true?{experimental_hanja_audit:true}:{}),...(t.experimental_loanword_audit===true?{experimental_loanword_audit:true}:{}),...(config.smartSegmentation===true?{repair_context:t.repair_context,repair_sentence_key:t.repair_sentence_key,original_target_id:t.original_target_id,...(t.scan_only?{scan_only:true}:{})}:{}),options:t.options.map(o=>({choice_id:o.choice_id,type:o.type,replacement:o.replacement,entry_id:o.entry_id,definitions:o.definitions,...(o.written_form?{written_form:o.written_form}:{}),...(o.part_of_speech?{part_of_speech:o.part_of_speech}:{}),...(o.subject_category?{subject_category:o.subject_category}:{}),...(o.semantic_category?{semantic_category:o.semantic_category}:{}),...(Array.isArray(o.segments)?{segments:o.segments}:{})}))}));
}
export async function reviewTargets(config,targets,signal){
 if(!config.enableModelReview || !targets.length)return {accepted:[],unresolved:targets,errors:[]};
 let pending=targets,accepted=[],errors=[];
 // Keep every rejected origin (and the reason) for the current live review.
 // The source-bound key survives changing pooled p and wire t identifiers.
 const history=config.retryHistoryFeedback===true&&config.rejectedChoiceHistory instanceof Map?
  config.rejectedChoiceHistory:new Map();
 const sourceKey=t=>JSON.stringify([t.source_sentence_id||t.repair_sentence_key||t.context||'',
  t.original_target_id||t.target_id,t.start,t.end,t.surface]);
 const recordKey=t=>JSON.stringify([config.provider||'',config.model||'',config.endpoint||'',sourceKey(t)]);
 const feedback=config.rejectedChoiceFeedback instanceof Map?
  config.rejectedChoiceFeedback:history;
 const record=t=>history.get(recordKey(t));
 const autoStopped=t=>!config.manualReview&&!config.userForcedRetry&&
  Object.entries(record(t)?.counts||{}).some(([choice,v])=>
   !/^[pcn]\d+$/u.test(choice)&&v?.count>=2);
 // Wrong numbered dictionary choices are corrected in a separate, smaller
 // request before any unrelated incomplete-response retry.
 const correctionIds=new Set();
 const discardInvalid=config.discardInvalidReviewResults===true;
 const notify=event=>config.onDiagnostic?.({...event,message:safeDetail(event.message,config),detail:safeDetail(event.detail,config)});
 const thinking=thinkingSettings(config);
 // Manual input has its own validation and retry UI. API requests adaptively
 // reduce target count after an incomplete response, timeout, or network drop.
 const manual=config.manualReview===true,smart=config.smartSegmentation===true;
 const maxRequests=config.firstPassOnly===true?1:config.pooledRetry===true?3:
  manual?2:smart?4:Math.min(16,Math.max(8,Math.ceil(targets.length/96)*3));
 let windowSize=targets.length,failStreak=0;
 for(let attempt=0;attempt<maxRequests && pending.length;attempt++){
  signal?.throwIfAborted();
  const eligible=manual?pending:pending.filter(t=>!autoStopped(t));
  if(!eligible.length){
   notify({stage:'rejected-choice-stop',level:'warning',message:
    '同一模型此前已多次回答相同的非法词源；停止自动重复提交，保留有效答案。用户仍可选择 API 继续、手动补交或 null。'});
   break;
  }
  const dictionaryOnly=!discardInvalid&&!manual&&
    eligible.some(t=>correctionIds.has(t.target_id));
  const current=dictionaryOnly?eligible.filter(t=>correctionIds.has(t.target_id)):
    manual||smart?eligible:eligible.slice(0,windowSize);
  // A targeted retry disables segmentation repairs, not the original
  // experimental permissions to write a verified Hanja/Latin origin.
  const rejectedChoices=Object.fromEntries(current.map(t=>[t.target_id,
   Object.entries((feedback.get(sourceKey(t))||record(t))?.counts||{})
    .map(([c,detail])=>({c,reason:detail.reason||'invalid_choice_id'}))])
   .filter(([,v])=>v.length));
  const attemptConfig=dictionaryOnly?{...config,dictionaryCorrectionOnly:true,
    smartSegmentation:false,rejectedChoices}:
    {...config,rejectedChoices};
  config.onPreview?.([]);
  notify({stage:'request',level:'info',attempt:attempt+1,model:config.model,thinking:thinking.label,
   message:`模型审核第 ${attempt+1}/${maxRequests} 次请求：本次 ${current.length} 个，尚余 ${pending.length} 个；${dictionaryOnly?'仅纠正错误候选编号（保留原实验性词源权限）；':''}${thinking.label}`});
  try {
   const wire=modelTargets(current,attemptConfig);
   const unfilteredReviewTargets=modelTargets(current,{...attemptConfig,reviewPosFilter:false});
   // No filtered-out choices are sent to the model; the unfiltered snapshot
   // exists only for private same-output pooled ID recovery.
   const requestConfig={...attemptConfig,unfilteredReviewTargets};
   config.onReviewTargetsSubmitted?.(wire,attempt+1);
   const rawResponse=await (config.request || requestChoices)({...requestConfig,attempt:attempt+1},wire,signal);
   // Every external API dictionary answer must use a p ID; map it only through
   // this target's exact outgoing pool. The manual session already normalized its answers.
   const response=manual?rawResponse:
    normalizePooledChoiceAnswers(rawResponse,buildReviewPayload(attemptConfig.context||'',wire,requestConfig).choiceIndex);
   const experimental=attemptConfig.experimentalHanja===true||attemptConfig.experimentalLoanword===true;
   // Manual replies are audited at entry, before invalid rows are normalized.
   if(!manual&&attemptConfig.experimentalHanja===true)
    config.onExperimentalHanjaAnswers?.(summarizeExperimentalHanjaAnswers(wire,response,attemptConfig));
   // In segmentation mode a successfully validated repair owns its old
   // targets. Validate repairs BEFORE requiring ordinary results; an invalid
   // repair never suppresses the original target or its dictionary choice.
   const repair=attemptConfig.smartSegmentation===true?
     validateSegmentationRepairs(wire,response,attemptConfig):{accepted:[],rejected:[]};
   const retired=new Set(repair.accepted.flatMap(r=>r.old_target_ids));
   const active=attemptConfig.smartSegmentation===true?
     current.filter(t=>!t.scan_only&&!retired.has(t.target_id)):current;
   const known=new Set(current.map(t=>t.target_id));
   const badId=attemptConfig.smartSegmentation===true&&attemptConfig.discardInvalidReviewResults!==true&&
     (!Array.isArray(response?.results)||response.results.some(row=>
       !row||typeof row.t!=='string'||!known.has(row.t)));
   const choiceResponse=attemptConfig.smartSegmentation===true&&!badId&&Array.isArray(response?.results)?
     {...response,results:response.results.filter(row=>!retired.has(row?.t)&&
       !current.some(t=>t.scan_only&&t.target_id===row?.t))}:response;
   const result=badId?
     {accepted:[],unresolved:active,experimentalAccepted:0,experimentalRejected:0}:
     experimental?validateExperimentalChoices(active,choiceResponse,attemptConfig):validateChoices(active,choiceResponse,attemptConfig);
   accepted.push(...result.accepted);
   // Do not count omitted answers as wrong guesses. A single malformed c
   // must have a unique, identifiable source target before it enters history.
   const invalid=new Set(result.invalidDictionaryChoiceIds||[]);
   for(const target of current){
    if(!invalid.has(target.target_id))continue;
    const answers=Array.isArray(response?.results)?
     response.results.filter(row=>row?.t===target.target_id):[];
    if(answers.length!==1||typeof answers[0].c!=='string')continue;
    const c=answers[0].c;
    const sample=(result.rejectionSamples||[]).find(x=>x.target_id===target.target_id);
    const reason=sample?.reason||
     (/^p\d+$/u.test(c)?'unknown_pooled_choice_id':
      /^[cn]\d+$/u.test(c)?'unknown_local_choice_id':'invalid_choice_or_origin');
    const key=recordKey(target),previous=history.get(key)||{counts:{}};
    const counts={...previous.counts},old=counts[c];
    counts[c]={count:Math.min(100,(old?.count||0)+1),reason};
    if(Object.keys(counts).length>16)delete counts[Object.keys(counts)[0]];
    const updated={counts};
    history.set(key,updated);
    const commonKey=sourceKey(target),combined={...feedback.get(commonKey)?.counts};
    combined[c]={count:Math.min(100,(combined[c]?.count||0)+1),reason};
    if(Object.keys(combined).length>16)delete combined[Object.keys(combined)[0]];
    feedback.set(commonKey,{counts:combined});
    config.onRejectedChoice?.(key,updated);
   }
   const incomplete=new Set(result.unresolved.map(t=>t.target_id));
   const submitted=new Set(current.map(t=>t.target_id));
   pending=pending.filter(t=>!submitted.has(t.target_id)||incomplete.has(t.target_id));
   for(const id of submitted)if(!incomplete.has(id))correctionIds.delete(id);
   for(const id of result.invalidDictionaryChoiceIds||[])correctionIds.add(id);
   await config.onAccepted?.(result.accepted);
   if(result.accepted.length||repair.accepted.length)failStreak=0;
   else failStreak++;
   if(!manual&&!smart&&incomplete.size)
    windowSize=Math.max(1,Math.ceil(current.length/2));
   if(attemptConfig.smartSegmentation===true){
    await config.onRepairs?.(repair.accepted);
    config.onRepairRejected?.(repair.rejected.length);
    const corrected=repair.accepted.filter(r=>r.offset_corrected===true).length;
    config.onRepairOffsetCorrected?.(corrected);
    if(repair.accepted.length||repair.rejected.length)
     notify({stage:'segmentation',level:repair.rejected.length?'warning':'info',
      message:`本批分词修复：采纳 ${repair.accepted.length} 项，安全拒绝 ${repair.rejected.length} 项；唯一匹配纠正偏移 ${corrected} 项。`,
      detail:repair.rejected.length?JSON.stringify(repair.rejected.slice(0,30)):''});
   }
   config.onPreview?.([]);
   if(experimental)notify({stage:'experimental',level:result.experimentalRejected?'warning':'info',message:`单次回复：直接词源标注 ${result.experimentalAccepted} 项、拒绝无效直接词源 ${result.experimentalRejected} 项。`,detail:result.experimentalRejected?JSON.stringify({reasons:result.rejectionCounts,samples:result.rejectionSamples}):''});
   if(!discardInvalid&&result.invalidDictionaryChoiceIds?.length)notify({stage:'retry-dictionary-choice',level:'warning',attempt:attempt+1,
    message:`发现 ${result.invalidDictionaryChoiceIds.length} 个非法选项或未通过校验的词源，已保存有效答案；仅对这些目标生成下一次纠错请求。`,
    detail:result.invalidDictionaryChoiceIds.slice(0,20).join(', ')});
   const implicitCount=result.accepted.filter(a=>a.implicitNull).length;
   const discardedCount=result.accepted.filter(a=>a.discardedInvalid).length;
   notify({stage:'response',level:pending.length?'warning':'info',message:discardInvalid?
    `模型返回：本次处理 ${result.accepted.length} 项（遗漏或空 c 按 null：${implicitCount}；非法结果按 null：${discardedCount}）；未解决 ${pending.length} 项，不因答案问题重试。`:
    `模型返回：采纳 ${result.accepted.length} 项，未解决 ${pending.length} 项`,detail:pending.length?JSON.stringify(response):''});
   if(discardInvalid)break;
  }catch(error){
   // A stream can be interrupted after many COMPLETE, individually valid
   // t/c objects. Keep those decisions and retry only the missing targets.
   // Never accept an unfinished row, duplicate ID or an unchecked literal.
   if(!signal?.aborted&&Array.isArray(error.partialAccepted)&&error.partialAccepted.length){
    const stillPending=new Map(pending.map(t=>[t.target_id,t]));
    const committed=[],seen=new Set();
    for(const row of error.partialAccepted){
     const id=row?.target?.target_id;
     if(!stillPending.has(id)||seen.has(id)||!row?.option)continue;
     seen.add(id);committed.push({target:stillPending.get(id),option:row.option});
    }
    if(committed.length){
     accepted.push(...committed);
     pending=pending.filter(t=>!seen.has(t.target_id));
     await config.onAccepted?.(committed,{interrupted:true});
     notify({stage:'partial',level:'warning',message:`API 流中断：已保留 ${committed.length} 条完整有效答案；其余 ${pending.length} 条仍待重试。${smart?'尚未收到的分词修复不阻止保留普通答案。':''}`});
    }
   }
   config.onPreview?.([]);
   if(signal?.aborted)throw error;
   const message=error.name==='TimeoutError'?'模型请求超时；已保留本地结果':error instanceof TypeError?'模型网络请求失败；请检查接口地址、API 域名权限与网络':error.message;
   const diagnostic={stage:'error',level:'error',attempt:attempt+1,message:safeDetail(message,config),detail:safeDetail(error.detail,config),permanent:error.permanent===true};
   errors.push(diagnostic);notify(diagnostic);
   if(error.permanent)break;
   failStreak++;
   if(attempt+1>=maxRequests||!pending.length||failStreak>=5||current.length===1&&failStreak>=3)break;
   if(!manual&&!smart&&current.length>1){
    windowSize=Math.max(1,Math.ceil(current.length/2));
    if(!dictionaryOnly&&pending.length>windowSize)
     notify({stage:'retry',level:'warning',attempt:attempt+1,
      message:`请求失败，下一次缩小到最多 ${windowSize} 个目标，已完成答案不会重发。`});
   }
   const delay=config.request?0:Math.min(6000,750*2**Math.min(failStreak,3));
   if(delay){await new Promise(resolve=>setTimeout(resolve,delay));signal?.throwIfAborted();}
  }
 }
 if(pending.length)notify({stage:'incomplete',level:'warning',
  message:discardInvalid?`有 ${pending.length} 个目标未获得有效结果；已保留正确答案，不会因答案无效而再次请求。`:`仍有 ${pending.length} 个审核目标未完成。已保留所有有效答案，不能将本轮视为完整成功。`});
 return {accepted,unresolved:pending,errors};
}
async function requestChoices(config,targets,signal){
 const {payload,stats:payloadStats,choiceIndex}=buildReviewPayload(config.context,targets,config);
 config.onDiagnostic?.({stage:'request',level:'info',message:`共享请求：${payloadStats.targets} 个词，${payloadStats.sentences} 份句子，${payloadStats.candidates} 个候选；用户输入 ${payloadStats.legacyUserBytes} → ${payloadStats.userBytes} 字节。`});
 const messages=[
  {role:'system',content:buildReviewInstructions(config)},
  {role:'user',content:JSON.stringify(payload)}];
 const requestedCap=config.apiOutputTokenLimit??config.batchBudget?.outputLimit;
 const requestBudget=describeBatchBudget(config.context||'',targets,{
  tier:config.batchContextTier||'1m',wireIds:true,manual:false,
  reviewPosFilter:config.reviewPosFilter,experimentalHanja:config.experimentalHanja,
  experimentalLoanword:config.experimentalLoanword,dictionaryFree:config.dictionaryFree,
  smartSegmentation:config.smartSegmentation,manualOutputTokenLimit:config.manualOutputTokenLimit,
  apiOutputTokenLimit:requestedCap,
  matchManualOutputBudget:config.matchManualOutputBudget===true
 });
 const outputTokenLimit=normalizeOutputTokenLimit(requestBudget.requestedOutputTokens,false);
 const {provider,endpoint,protocol,body,headers}=prepareRequest(config,messages,outputTokenLimit);
 const logger=config.logger||requestLogger;
 const started=Date.now(),secrets=[config.apiKey,config.engineToken].filter(Boolean);
 const record={startedAt:new Date(started).toISOString(),endpoint,provider,model:config.model,operationId:config.operationId,attempt:config.attempt||1,stream:body.stream===true,payloadStats,batchBudget:{...config.batchBudget,requestOutputTokens:outputTokenLimit},headers,body};
 const logId=await logger.start(record,secrets);
 const guard=requestTimeoutGuard({signal,
  hardMs:config.timeoutMs || 600000,
  idleMs:config.stream===true?180000:(config.timeoutMs||600000)});
 const requestSignal=guard.signal;
 let raw='',rawTruncated=false,status,firstByteMs,metadata={},responseHeaders={},latestPreview=[];
 const onRaw=chunk=>{if(chunk)guard.activity();if(chunk&&firstByteMs===undefined)firstByteMs=Date.now()-started;
   // Full wire response is retained only when the user enables request logging.
   // A disabled logger still uses the old bounded diagnostic buffer.
   if(logId){raw+=chunk;return;}
   if(raw.length+chunk.length>1_500_000)rawTruncated=true;
   raw+=chunk.slice(0,Math.max(0,1_500_000-raw.length));};
 const onMetadata=data=>{if(provider==='openrouter'&&typeof data.provider==='string'&&metadata.inferenceProvider!==data.provider){metadata.inferenceProvider=data.provider;config.onDiagnostic?.({stage:'response-provider',level:'info',message:'OpenRouter 推理供应商：'+data.provider});}if(data.id)metadata.id=data.id;if(data.usage)metadata.usage={...metadata.usage,...data.usage};if(data.stop_reason)metadata.finishReason=data.stop_reason;if(data.choices?.[0]?.finish_reason)metadata.finishReason=data.choices[0].finish_reason;};
 try{
  const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body),signal:requestSignal,...(provider==='openrouter'||globalThis.KRA_PROVIDER_REGISTRY.local(provider)?{redirect:'error',credentials:'omit'}:{})});
  guard.activity();
  status=response.status;responseHeaders=Object.fromEntries(['content-type','x-request-id','request-id','retry-after'].map(name=>[name,response.headers.get(name)]).filter(([,v])=>v));
  if(!response.ok){const detail=await response.text();onRaw(detail);const error=Error(`模型 API HTTP ${response.status}`);error.detail=detail;error.permanent=response.status>=400&&response.status<500&&![408,429].includes(response.status);throw error;}
  // Streamed literal origins are validated per complete result before preview.
  const previewCallback=accepted=>{latestPreview=accepted;config.onPreview?.(accepted);};
  // The background-only unfiltered view is used strictly to validate the
  // already source-matched local ID during partial streaming and diagnostics.
  const choiceValidationTargets=Array.isArray(config.unfilteredReviewTargets)?
    config.unfilteredReviewTargets:targets;
  const preview=(config.experimentalHanja||config.experimentalLoanword)?
    experimentalChoicePreviewParser(choiceValidationTargets,{...config,choiceIndex},previewCallback):
    choicePreviewParser(choiceValidationTargets,previewCallback,()=>null,{...config,choiceIndex});
  const content=await readModelContent(response,{protocol,signal:requestSignal,maxContentChars:Math.min(16_000_000,Math.max(2_000_000,outputTokenLimit*8)),onRaw,onMetadata,onDelta:preview,onStarted:()=>config.onDiagnostic?.({stage:'response',level:'info',message:'已收到模型流式响应，正在接收审核结果。'})});
  let result,recovered=false;
  try{({response:result,recovered}=parsePartialReviewJson(content));}
  catch{if(config.discardInvalidReviewResults===true){result={results:[]};config.onDiagnostic?.({stage:'discard-invalid',level:'warning',message:'模型回复无法解析，已丢弃本次无效答案，不重新请求。'});}
    else{const error=Error('模型最终回复为空、非 JSON 或不符合候选 ID 协议');error.detail=content||raw;throw error;}}
  if(recovered&&config.smartSegmentation===true){
   // Do not apply incomplete repair objects. Complete, individually validated
   // streamed t/c rows can still be salvaged by the interrupted-response path.
   const error=Error('智能分词回复 JSON 不完整；保留已校验的流式普通答案，其他目标等待补交');error.detail=content;throw error;
  }
  if(recovered)config.onDiagnostic?.({stage:'partial-json',level:'warning',message:config.discardInvalidReviewResults===true?`模型 JSON 存在语法错误，已安全提取 ${result.results.length} 条有效对象，其他错误对象直接丢弃。`:`模型 JSON 存在语法错误，已安全提取 ${result.results.length} 条独立完整的 t/c 答案；其他目标将单独补交。`});
  const internal=normalizePooledChoiceAnswers(result,choiceIndex);
  const checked=(config.experimentalHanja||config.experimentalLoanword)?
    validateExperimentalChoices(choiceValidationTargets,internal,config):
    validateChoices(choiceValidationTargets,internal,config);
  await logger.finish(logId,{status,responseHeaders,finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started,firstByteMs,validation:{accepted:checked.accepted.length,unresolved:checked.unresolved.length,recovered},response:{raw,truncated:rawTruncated,parsed:result,...metadata}},secrets);
  return result;
 }catch(error){
  // Only completed and validated stream rows can be salvaged. Request-level
  // failure still remains visible in diagnostics and logs; this is not
  // interpreted as a successful full model reply.
  if(latestPreview.length&&!error.discardPartial)error.partialAccepted=latestPreview;
  await logger.finish(logId,{status,responseHeaders,finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started,firstByteMs,response:{raw,truncated:rawTruncated,...metadata},error:{name:error.name,message:error.message,detail:error.detail||''},partialRows:latestPreview.length},secrets);
  throw error;
 }finally{
  guard.cleanup();
 }
}

import {filterReviewTarget,filterReviewTargets} from './review-pos.js';
import {qwenRequestSettings} from './qwen-api.js';
import {readModelContent,choicePreviewParser,experimentalChoicePreviewParser} from './model-stream.js';
import {requestLogger} from './request-log.js';
import './model-catalog.js';
import {buildReviewPayload,buildReviewInstructions} from './review-payload.js';
import {literalOriginOption,explainLiteralOriginRejection} from './experimental-options.js';
import {validateSegmentationRepairs} from './segmentation-repairs.js';
import {normalizeOutputTokenLimit} from './batch-budget.js';
import {parsePositionalResults,choiceFromValue} from './positional-results.js';
// Only positional-v1 values, never object rows keyed by target_id.
function validatePositional(targets,response,config={},experimental=false){
 const parsed=parsePositionalResults(targets,response,{
  allowPartial:false,retired:config.retired||new Set(),
  smartSegmentation:config.smartSegmentation===true
 });
 if(parsed.malformed)return {accepted:[],unresolved:targets,
  experimentalAccepted:0,experimentalProposed:0,experimentalRejected:0,
  positionalMalformed:true};
 const accepted=[],unresolved=[];let experimentalAccepted=0,experimentalRejected=0;
 const rejectionCounts={},rejectionSamples=[];
 for(let i=0;i<targets.length;i++){
  const target=targets[i],value=parsed.values.get(i);
  if(config.smartSegmentation===true&&
     (config.retired?.has(target.target_id)||target.scan_only===true))continue;
  if(!parsed.values.has(i)||parsed.problems.has(i)||value===false){
   unresolved.push(target);continue;
  }
  const option=choiceFromValue(filterReviewTarget(target,config),value,config,experimental?literalOriginOption:()=>null);
  if(option){
   accepted.push({target,option});
   if(experimental&&option.entry_id&&String(option.entry_id).startsWith('experimental:'))
     experimentalAccepted++;
  }else{
   unresolved.push(target);
   if(experimental){
    experimentalRejected++;
    const reason=explainLiteralOriginRejection(target,value,config);
    rejectionCounts[reason]=(rejectionCounts[reason]||0)+1;
    if(rejectionSamples.length<16)rejectionSamples.push({
     target_id:target.target_id,surface:target.surface,value,reason
    });
   }
  }
 }
 return {accepted,unresolved,experimentalAccepted,experimentalProposed:experimentalAccepted,
  experimentalRejected,rejectionCounts,rejectionSamples};
}
export function validateChoices(targets,response,config={}){
 return validatePositional(targets,response,config,false);
}
export function validateExperimentalChoices(targets,response,config={}){
 return validatePositional(targets,response,config,true);
}
export function thinkingSettings(config){
 const capability=globalThis.KRA_MODEL_CATALOG.resolve(config);
 if(!capability)return {body:{},label:'模型默认思考设置（未收录能力）'};
 const enabled=capability.thinking==='required'||config.disableThinking===false;
 const provider=config.provider||globalThis.KRA_MODEL_CATALOG.inferProvider(config.endpoint);
 const effort=capability.efforts.includes(config.reasoningEffort)?config.reasoningEffort:capability.efforts[0];
 if(provider==='qwen'){
  if(capability.thinking==='none')return {body:{},label:'此模型不使用思考参数'};
  const body=capability.thinking==='toggle'?{enable_thinking:enabled}:{};
  if(enabled&&capability.efforts.length)body.reasoning_effort=effort;
  return {body,label:enabled?`Qwen 思考开启${capability.efforts.length?'（'+effort+'）':''}`:'Qwen 思考关闭'};
 }
 if(provider==='openai')return {body:{reasoning_effort:enabled?effort:'none'},label:enabled?`思考强度：${effort}`:'关闭思考'};
 if(provider==='anthropic')return {body:{thinking:{type:enabled?'adaptive':capability.offType||'disabled'},output_config:{effort:enabled?effort:'low'}},label:enabled?`自适应思考（${effort}）`:capability.offType==='between_tools'?'关闭前置思考':'关闭思考'};
 const body={thinking:{type:enabled?'enabled':'disabled'}};
 if(enabled&&capability.efforts.length)body.reasoning_effort=capability.efforts.includes(config.reasoningEffort)?config.reasoningEffort:capability.efforts[0];
 return {body,label:enabled?`思考开启${body.reasoning_effort?`（${body.reasoning_effort}）`:''}`:'关闭思考'};
}
export function safeDetail(value,config={}){
 let text=String(value||'');
 for(const secret of [config.apiKey,config.engineToken])if(secret)text=text.split(secret).join('[REDACTED]');
 return text.replace(/Bearer\s+[^\s"'<>]+/gi,'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]+/g,'[REDACTED]').slice(0,3000);
}
export function modelTargets(targets,config={}){
 return filterReviewTargets(targets,config).map(t=>({target_id:t.target_id,start:t.start,end:t.end,surface:t.surface,context:t.context,...(t.adjacent_context?{adjacent_context:t.adjacent_context}:{}),...(t.morphology?{morphology:t.morphology}:{}),...(t.pos_conflict?{pos_conflict:true}:{}),...(t.partial_word?{partial_word:true}:{}),...(t.proper_noun===true?{proper_noun:true}:{}),...(t.dictionary_person_name===true?{dictionary_person_name:true}:{}),...(t.dictionary_name_homograph===true?{dictionary_name_homograph:true}:{}),...(t.suspected_person_name===true?{suspected_person_name:true}:{}),...(config.smartSegmentation===true?{repair_context:t.repair_context,repair_sentence_key:t.repair_sentence_key,original_target_id:t.original_target_id,...(t.scan_only?{scan_only:true}:{})}:{}),options:t.options.map(o=>({choice_id:o.choice_id,type:o.type,replacement:o.replacement,entry_id:o.entry_id,definitions:o.definitions,...(o.written_form?{written_form:o.written_form}:{}),...(o.part_of_speech?{part_of_speech:o.part_of_speech}:{}),...(o.subject_category?{subject_category:o.subject_category}:{}),...(o.semantic_category?{semantic_category:o.semantic_category}:{}),...(Array.isArray(o.segments)?{segments:o.segments}:{})}))}));
}
export async function reviewTargets(config,targets,signal){
 if(!config.enableModelReview || !targets.length)return {accepted:[],unresolved:targets,errors:[]};
 let pending=targets,accepted=[],errors=[];
 const notify=event=>config.onDiagnostic?.({...event,message:safeDetail(event.message,config),detail:safeDetail(event.detail,config)});
 const thinking=thinkingSettings(config);
 for(let attempt=0;attempt<(config.smartSegmentation===true?1:2) && pending.length;attempt++){
  signal?.throwIfAborted();
  config.onPreview?.([]);
  notify({stage:'request',level:'info',attempt:attempt+1,model:config.model,thinking:thinking.label,message:`正在请求模型审核：${pending.length} 个候选；${thinking.label}`});
  try {
   const current=pending;
   const wire=modelTargets(current,config);
   const response=await (config.request || requestChoices)({...config,attempt:attempt+1},wire,signal);
   const experimental=config.experimentalHanja===true||config.experimentalLoanword===true;
   // In segmentation mode a successfully validated repair owns its old
   // targets. Validate repairs BEFORE requiring ordinary results; an invalid
   // repair never suppresses the original target or its dictionary choice.
   const repair=config.smartSegmentation===true?
     validateSegmentationRepairs(wire,response,config):{accepted:[],rejected:[]};
   const retired=new Set(repair.accepted.flatMap(r=>r.old_target_ids));
   const validatorConfig={...config,retired};
   const result=experimental?
     validateExperimentalChoices(current,response,validatorConfig):
     validateChoices(current,response,validatorConfig);
   accepted.push(...result.accepted);pending=result.unresolved;config.onAccepted?.(result.accepted);
   if(config.smartSegmentation===true){
    config.onRepairs?.(repair.accepted);
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
   notify({stage:'response',level:pending.length?'warning':'info',message:`模型返回：采纳 ${result.accepted.length} 项，未解决 ${pending.length} 项`,detail:pending.length?JSON.stringify(response):''});
  }catch(error){
   config.onPreview?.([]);
   if(signal?.aborted)throw error;
   const message=error.name==='TimeoutError'?'模型请求超时；已保留本地结果':error instanceof TypeError?'模型网络请求失败；请检查接口地址、API 域名权限与网络':error.message;
   const diagnostic={stage:'error',level:'error',attempt:attempt+1,message:safeDetail(message,config),detail:safeDetail(error.detail,config)};
   errors.push(diagnostic);notify(diagnostic);
   if(error.permanent)break;
  }
 }
 return {accepted,unresolved:pending,errors};
}
async function requestChoices(config,targets,signal){
 const provider=config.provider||globalThis.KRA_MODEL_CATALOG.inferProvider(config.endpoint);
 const native=provider==='openai'||provider==='anthropic';
 const timeout=AbortSignal.timeout(config.timeoutMs || (native||provider==='qwen'?120000:20000));
 const requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
 // Each API request has an independently verified batch identifier. A model
 // answer for another page/batch cannot be applied merely because lengths fit.
 const batchId=crypto.randomUUID();
 const requestConfig={...config,batchId};
 const {payload,stats:payloadStats}=buildReviewPayload(config.context,targets,requestConfig);
 config.onDiagnostic?.({stage:'request',level:'info',message:`共享请求：${payloadStats.targets} 个词，${payloadStats.sentences} 份句子，${payloadStats.candidates} 个候选；用户输入 ${payloadStats.legacyUserBytes} → ${payloadStats.userBytes} 字节。`});
 let body={model:config.model,messages:[
  {role:'system',content:buildReviewInstructions(requestConfig)},
  {role:'user',content:JSON.stringify(payload)}],response_format:{type:'json_object'},...thinkingSettings(config).body};
 if(provider==='qwen'){delete body.response_format;Object.assign(body,qwenRequestSettings(config));}
 const responses=provider==='openai'&&/\/responses\/?$/.test(new URL(config.endpoint).pathname);
 const outputTokenLimit=normalizeOutputTokenLimit(config.batchBudget?.reservedOutputTokens??config.apiOutputTokenLimit,false);
 if(responses){
  const {messages,reasoning_effort}=body;
  body={model:config.model,input:messages,store:false,
   text:{format:{type:'json_object'}},max_output_tokens:outputTokenLimit,
   ...(reasoning_effort?{reasoning:{effort:reasoning_effort}}:{})};
 }else if(provider==='anthropic'){
  const {messages,thinking,output_config}=body;
  body={model:config.model,system:messages[0].content,messages:messages.slice(1),
   max_tokens:outputTokenLimit,...(thinking?{thinking,output_config}:{})};
 }else if(provider==='openai'){
  body.max_completion_tokens=outputTokenLimit;
 }else{
  body.max_tokens=outputTokenLimit;
 }
 if(config.stream===true){body.stream=true;if(['qwen','deepseek'].includes(provider))body.stream_options={include_usage:true};}
 const auth=provider==='anthropic'?{'x-api-key':config.apiKey||'','anthropic-version':'2023-06-01'}:config.apiKey?(provider==='mimo'?{'api-key':config.apiKey}:{Authorization:`Bearer ${config.apiKey}`}):{};
 const logger=config.logger||requestLogger;
 const started=Date.now(),secrets=[config.apiKey,config.engineToken].filter(Boolean);
 const headers={'Content-Type':'application/json',...auth};
 const record={startedAt:new Date(started).toISOString(),endpoint:config.endpoint,provider,model:config.model,operationId:config.operationId,attempt:config.attempt||1,stream:body.stream===true,payloadStats,batchBudget:config.batchBudget,headers,body};
 const logId=await logger.start(record,secrets);
 let raw='',rawTruncated=false,status,firstByteMs,metadata={},responseHeaders={};
 const onRaw=chunk=>{if(chunk&&firstByteMs===undefined)firstByteMs=Date.now()-started;if(raw.length+chunk.length>1_500_000)rawTruncated=true;raw+=(chunk.slice(0,Math.max(0,1_500_000-raw.length)));};
 const onMetadata=data=>{if(data.id)metadata.id=data.id;if(data.usage)metadata.usage={...metadata.usage,...data.usage};if(data.stop_reason)metadata.finishReason=data.stop_reason;if(data.choices?.[0]?.finish_reason)metadata.finishReason=data.choices[0].finish_reason;};
 try{
  const response=await fetch(config.endpoint,{method:'POST',headers,body:JSON.stringify(body),signal:requestSignal});
  status=response.status;responseHeaders=Object.fromEntries(['content-type','x-request-id','request-id','retry-after'].map(name=>[name,response.headers.get(name)]).filter(([,v])=>v));
  if(!response.ok){const detail=await response.text();onRaw(detail);const error=Error(`模型 API HTTP ${response.status}`);error.detail=detail;error.permanent=response.status>=400&&response.status<500&&![408,429].includes(response.status);throw error;}
  // Streamed literal origins are validated per complete result before preview.
  const preview=!config.onPreview?()=>{}:(config.experimentalHanja||config.experimentalLoanword)?experimentalChoicePreviewParser(targets,requestConfig,config.onPreview):choicePreviewParser(targets,config.onPreview,batchId);
  const content=await readModelContent(response,{protocol:responses?'responses':provider==='anthropic'?'anthropic':'chat',signal:requestSignal,maxContentChars:Math.min(16_000_000,Math.max(2_000_000,outputTokenLimit*8)),onRaw,onMetadata,onDelta:preview,onStarted:()=>config.onDiagnostic?.({stage:'response',level:'info',message:'已收到模型流式响应，正在接收审核结果。'})});
  let result;try{if(typeof content!=='string'||!content.trim())throw Error('empty');result=JSON.parse(content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}
  catch{const error=Error('模型最终回复为空、非 JSON 或不符合 positional-v1 协议');error.detail=content||raw;throw error;}
  if(result?.batch_id!==batchId){
   const error=Error('positional-v1 batch_id 与当前 API 批次不一致或缺失，已拒绝应用结果');
   error.detail=JSON.stringify({expected:batchId,received:result?.batch_id});
   throw error;
  }
  const checked=(config.experimentalHanja||config.experimentalLoanword)?
   validateExperimentalChoices(targets,result,config):validateChoices(targets,result,config);
  await logger.finish(logId,{status,responseHeaders,finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started,firstByteMs,validation:{accepted:checked.accepted.length,unresolved:checked.unresolved.length},response:{raw,truncated:rawTruncated,...metadata}},secrets);
  return result;
 }catch(error){
  await logger.finish(logId,{status,responseHeaders,finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started,firstByteMs,response:{raw,truncated:rawTruncated,...metadata},error:{name:error.name,message:error.message,detail:error.detail||''}},secrets);
  throw error;
 }
}

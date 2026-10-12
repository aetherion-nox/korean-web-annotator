import './model-catalog.js';
export function validateChoices(targets,response) {
 const accepted=[],unresolved=[];
 const rows=Array.isArray(response?.results)?response.results:[];
 const known=new Set(targets.map(t=>t.target_id));
 // Cross-task/unknown IDs invalidate the entire response.
 const invalid=rows.some(r=>!r || !known.has(r.target_id));
 for(const target of targets){
  const matches=rows.filter(r=>r?.target_id===target.target_id);
  const option=matches.length===1 && target.options.find(o=>o.choice_id===matches[0].choice_id);
  if(!invalid && option) accepted.push({target,option}); else unresolved.push(target);
 }
 return {accepted,unresolved};
}
export function thinkingSettings(config){
 const capability=globalThis.KRA_MODEL_CATALOG.resolve(config);
 if(!capability)return {body:{},label:'模型默认思考设置（未收录能力）'};
 const enabled=capability.thinking==='required'||config.disableThinking===false;
 const provider=config.provider||globalThis.KRA_MODEL_CATALOG.inferProvider(config.endpoint);
 const effort=capability.efforts.includes(config.reasoningEffort)?config.reasoningEffort:capability.efforts[0];
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
export function modelTargets(targets){
 return targets.map(t=>({target_id:t.target_id,start:t.start,end:t.end,surface:t.surface,context:t.context,options:t.options.map(o=>({choice_id:o.choice_id,type:o.type,replacement:o.replacement,entry_id:o.entry_id,definitions:o.definitions}))}));
}
export async function reviewTargets(config,targets,signal){
 if(!config.enableModelReview || !targets.length)return {accepted:[],unresolved:targets,errors:[]};
 let pending=targets,accepted=[],errors=[];
 const notify=event=>config.onDiagnostic?.({...event,message:safeDetail(event.message,config),detail:safeDetail(event.detail,config)});
 const thinking=thinkingSettings(config);
 for(let attempt=0;attempt<2 && pending.length;attempt++){
  signal?.throwIfAborted();
  notify({stage:'request',level:'info',attempt:attempt+1,model:config.model,thinking:thinking.label,message:`正在请求模型审核：${pending.length} 个候选；${thinking.label}`});
  try {
   const response=await (config.request || requestChoices)(config,modelTargets(pending),signal);
   const result=validateChoices(pending,response);accepted.push(...result.accepted);pending=result.unresolved;config.onAccepted?.(result.accepted);
   notify({stage:'response',level:pending.length?'warning':'info',message:`模型返回：采纳 ${result.accepted.length} 项，未解决 ${pending.length} 项`,detail:pending.length?JSON.stringify(response):''});
  }catch(error){
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
 const timeout=AbortSignal.timeout(config.timeoutMs || (native?120000:20000));
 const requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
 let body={model:config.model,messages:[
  {role:'system',content:'Select only supplied dictionary choice IDs using context and definitions. KEEP preserves Korean. Return JSON {"results":[{"target_id":"...","choice_id":"..."}]} for every target. Never generate replacement text.'},
  {role:'user',content:JSON.stringify({context:config.context,targets})}],response_format:{type:'json_object'},...thinkingSettings(config).body};
 const responses=provider==='openai'&&/\/responses\/?$/.test(new URL(config.endpoint).pathname);
 if(responses){const {messages,reasoning_effort}=body;body={model:config.model,input:messages,store:false,text:{format:{type:'json_object'}},max_output_tokens:16384,...(reasoning_effort?{reasoning:{effort:reasoning_effort}}:{})};}
 if(provider==='anthropic'){const {messages,thinking,output_config}=body;body={model:config.model,system:messages[0].content,messages:messages.slice(1),max_tokens:16384,...(thinking?{thinking,output_config}:{})};}
 const auth=provider==='anthropic'?{'x-api-key':config.apiKey||'','anthropic-version':'2023-06-01'}:config.apiKey?(provider==='mimo'?{'api-key':config.apiKey}:{Authorization:`Bearer ${config.apiKey}`}):{};
 const response=await fetch(config.endpoint,{method:'POST',headers:{'Content-Type':'application/json',...auth},body:JSON.stringify(body),signal:requestSignal});
 const raw=await response.text();
 if(!response.ok){const error=Error(`模型 API HTTP ${response.status}`);error.detail=raw;error.permanent=response.status>=400&&response.status<500&&![408,429].includes(response.status);throw error;}
 let data,content;
 try{
  data=JSON.parse(raw);
  if(responses){if(data.status==='incomplete'||data.status==='failed')throw Error('incomplete');content=(data.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(block=>block.type==='output_text').map(block=>block.text).join('');}
  else if(provider==='anthropic'){if(data.stop_reason==='max_tokens'||data.stop_reason==='refusal')throw Error('incomplete');content=(data.content||[]).filter(block=>block.type==='text').map(block=>block.text).join('');}
  else content=data?.choices?.[0]?.message?.content;
  if(typeof content!=='string'||!content.trim())throw Error('empty');return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
 }
 catch{const error=Error('模型返回为空、非 JSON 或格式不符合候选 ID 协议');error.detail=content||raw;throw error;}
}

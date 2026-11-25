import './model-catalog.js';
import './provider-registry.js';
import {qwenRequestSettings} from './qwen-api.js';
const registry = globalThis.KRA_PROVIDER_REGISTRY;

export function thinkingSettings(config){
 const provider=registry.idOf(config);
 const discovered=config.modelCapability;
 if(provider==='openrouter'||provider==='ollama'){
  const supported=['supported','required'].includes(discovered?.thinking);
  const enabled=discovered?.thinking==='required'||config.disableThinking===false;
  return {body:{},label:supported?(enabled?'思考开启'+(config.reasoningEffort?'（'+config.reasoningEffort+'）':''):'请求关闭思考'):'模型默认思考设置（未收录能力）'};
 }
 const bundled=globalThis.KRA_MODEL_CATALOG.resolve({...config,provider});
 const thinking=discovered?.thinking;
 const capability=['toggle','required','none'].includes(thinking)&&Array.isArray(discovered?.efforts)?
   {...bundled,thinking,efforts:discovered.efforts}:bundled;
 if(!capability || provider==='custom' || registry.local(provider))return {body:{},label:'模型默认思考设置（未收录能力）'};
 if(capability.thinking==='none')return {body:{},label:'此模型不使用思考参数'};
 const enabled=capability.thinking==='required'||config.disableThinking===false;
 const effort=capability.efforts.includes(config.reasoningEffort)?config.reasoningEffort:capability.efforts[0];
 if(provider==='qwen'){
  const body=capability.thinking==='toggle'?{enable_thinking:enabled}:{};
  if(enabled&&capability.efforts.length)body.reasoning_effort=effort;
  return {body,label:enabled?`Qwen 思考开启${capability.efforts.length?'（'+effort+'）':''}`:'Qwen 思考关闭'};
 }
 // Gemini and Meta Muse use OpenAI-style reasoning_effort rather than
 // Xiaomi/GLM's vendor-specific "thinking" object. Muse cannot disable reasoning.
 if(provider==='gemini'||provider==='muse'){
  const level=enabled?effort:'none';
  return {body:level?{reasoning_effort:level}:{},label:enabled?(level?`思考强度：${level}`:'思考开启'):'关闭思考'};
 }
 // Tencent TokenHub supports the same explicit thinking switch for
 // Hy4 Flash, Hy4, Hy4 Preview and Hy3. The accepted effort levels differ:
 // Hy3: low/high/no_think; Hy4 family: high/no_think.
 if(provider==='hunyuan'){
  const body={thinking:{type:enabled?'enabled':'disabled'}};
  if(capability.efforts.length)body.reasoning_effort=enabled?effort:'no_think';
  return {body,label:enabled?(effort?`混元思考强度：${effort}`:'混元思考开启'):'混元关闭思考'};
 }
 if(provider==='openai')return {body:{reasoning_effort:enabled?effort:'none'},label:enabled?`思考强度：${effort}`:'关闭思考'};
 if(provider==='anthropic')return {body:{thinking:{type:enabled?'adaptive':capability.offType||'disabled'},output_config:{effort:enabled?effort:'low'}},label:enabled?`自适应思考（${effort}）`:capability.offType==='between_tools'?'关闭前置思考':'关闭思考'};
 const body={thinking:{type:enabled?'enabled':'disabled'}};
 if(enabled&&capability.efforts.length)body.reasoning_effort=capability.efforts.includes(config.reasoningEffort)?config.reasoningEffort:capability.efforts[0];
 return {body,label:enabled?`思考开启${body.reasoning_effort?`（${body.reasoning_effort}）`:''}`:'关闭思考'};
}

export function prepareRequest(config,messages,outputTokenLimit){
 const provider=registry.idOf(config);
 let endpoint=registry.endpoint(config.endpoint,provider);
 const lmNative=provider==='lmstudio' && config.localReasoningMode==='native' &&
   registry.localReasoningEnabled(provider,config.localReasoningMode,config.localReasoningValue);
 if(lmNative){
  const url=new URL(endpoint);
  url.pathname=url.pathname.replace(/(?:\/v1)?\/chat\/completions\/?$/,'/api/v1/chat');
  endpoint=url.href;
 }
 const responses=provider==='openai'&&/\/responses\/?$/.test(new URL(endpoint).pathname);
 let body={model:config.model,messages,response_format:{type:'json_object'},...thinkingSettings(config).body};
 if(provider==='qwen'){delete body.response_format;Object.assign(body,qwenRequestSettings(config));}
 if(responses){
  const {messages,reasoning_effort}=body;
  body={model:config.model,input:messages,store:false,
   text:{format:{type:'json_object'}},max_output_tokens:outputTokenLimit,
   ...(reasoning_effort?{reasoning:{effort:reasoning_effort}}:{})};
 }else if(provider==='anthropic'){
  const {messages,thinking,output_config}=body;
  body={model:config.model,system:messages[0].content,messages:messages.slice(1),
   max_tokens:outputTokenLimit,...(thinking?{thinking,output_config}:{})};
 }else if(provider==='openai'||provider==='muse'){
  body.max_completion_tokens=outputTokenLimit;
 }else{
  body.max_tokens=outputTokenLimit;
 }
 if(config.stream===true){body.stream=true;if(['qwen','deepseek','hunyuan'].includes(provider))body.stream_options={include_usage:true};}

 const protocol=lmNative?'lmstudio':responses?'responses':provider==='anthropic'?'anthropic':provider==='ollama'?'ollama':'chat';
 return {provider,endpoint,protocol,body:registry.adapt(config,body,outputTokenLimit),headers:registry.headers(provider,config.apiKey)};
}

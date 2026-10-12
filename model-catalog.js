(function () {
 const dsDocs='https://api-docs.deepseek.com/guides/thinking_mode/';
 const glmDocs='https://docs.z.ai/guides/llm/glm-5.3';
 const mimoDocs='https://mimo.mi.com/docs/en-US/quick-start/usage-guide/other/deep-thinking';
 const model=(id,thinking,efforts,docs)=>({id,label:id,thinking,efforts,docs});
 const providers=[
  {id:'openai',label:'OpenAI',endpoint:'https://api.openai.com/v1/responses',models:[
   model('gpt-6.1-sol','required',['low','medium','high','xhigh','max'],'https://developers.openai.com/api/docs/models/gpt-6.1-sol'),
   model('gpt-6-astra','required',['low','medium','high','xhigh','max'],'https://developers.openai.com/api/docs/models/gpt-6-astra'),
   model('gpt-6-luna','toggle',['low','medium','high','xhigh','max'],'https://developers.openai.com/api/docs/models/gpt-6-luna')
  ]},
  {id:'anthropic',label:'Claude (Anthropic)',endpoint:'https://api.anthropic.com/v1/messages',models:[
   {...model('claude-sonnet-5-5','toggle',['low','medium','high','xhigh','max'],'https://platform.claude.com/docs/en/models/sonnet-5-5/overview'),offType:'between_tools'},
   model('claude-opus-5-5','required',['low','medium','high','xhigh','max'],'https://platform.claude.com/docs/en/models/opus-5-5/overview'),
   model('claude-haiku-5-5','toggle',['low','medium','high','xhigh','max'],'https://platform.claude.com/docs/en/models/haiku-5-5/overview'),
   model('claude-fable-5-1','required',['low','medium','high','xhigh','max'],'https://platform.claude.com/docs/en/models/fable-5-1/overview')
  ]},
  {id:'deepseek',label:'DeepSeek',endpoint:'https://api.deepseek.com/chat/completions',models:['deepseek-flash','deepseek-v4-pro'].map(id=>model(id,'toggle',['low','high','max'],dsDocs))},
  {id:'zai',label:'GLM (Z.AI)',endpoint:'https://api.z.ai/api/paas/v4/chat/completions',models:['glm-5.3-flash','glm-5.3-flashx','glm-5.3'].map(id=>model(id,'required',['low','high','max'],id==='glm-5.3'?glmDocs:'https://docs.z.ai/guides/vlm/glm-5.3-flash'))},
  {id:'mimo',label:'Xiaomi MiMo',endpoint:'https://api.xiaomimimo.com/v1/chat/completions',models:['mimo-v2.6-flash','mimo-v2.6-pro','mimo-v2.6-pro-ultraspeed','mimo-v2.5','mimo-v2.5-pro'].map(id=>model(id,'toggle',[],mimoDocs))},
  {id:'custom',label:'自定义 / Custom',endpoint:'',models:[]}
 ];
 function inferProvider(endpoint){try{const host=new URL(endpoint).hostname;return providers.find(p=>p.endpoint&&new URL(p.endpoint).hostname===host)?.id||'custom';}catch{return 'custom';}}
 function resolve(config){const id=config.provider||inferProvider(config.endpoint);return providers.find(p=>p.id===id)?.models.find(m=>m.id===config.model)||null;}
 globalThis.KRA_MODEL_CATALOG={providers,inferProvider,resolve,verifiedAt:'2026-10-12'};
})();

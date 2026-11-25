(() => {
  const registry = globalThis.KRA_PROVIDER_REGISTRY;
  const storeKey = 'providerReferenceConfigV1';
  const urlKey='providerReferenceUrlV1';
  const source = 'remote-reference';
  const allowedEfforts = ['none','minimal','low','medium','high','xhigh','max'];
  const mappings = ['openrouter-reasoning','openrouter-effort','ollama-toggle','ollama-level'];
  function object(value,keys) {
    if(!value || typeof value!=='object' || Array.isArray(value) ||
       Object.keys(value).some(key=>!keys.includes(key)))throw Error('Invalid provider configuration fields.');
  }
  function string(value,max) {
    if(typeof value!=='string' || !value.trim() || value.length>max)throw Error('Invalid provider configuration text.');
    return value;
  }
  function list(value,allowed=null) {
    if(!Array.isArray(value)||value.length>64)throw Error('Invalid provider configuration array.');
    return value.map(item=>{
      string(item,100);
      if(allowed&&!allowed.includes(item))throw Error('Unsupported provider configuration value.');
      return item;
    });
  }
  function validate(input) {
    object(input,['schemaVersion','version','channels']);
    if(input.schemaVersion!==1 || !Number.isSafeInteger(input.version) || input.version<1)throw Error('Unsupported configuration version.');
    if(!Array.isArray(input.channels)||input.channels.length>registry.providers.length)throw Error('Invalid channels.');
    const channels=input.channels.map(channel=>{
      object(channel,['id','defaults','models','families']);
      if(!registry.providers.some(provider=>provider.id===channel.id))throw Error('Unknown channel.');
      const defaults=channel.defaults ?? {};
      object(defaults,['effort','stream']);
      if(defaults.effort!==undefined&&!allowedEfforts.includes(defaults.effort))throw Error('Unsupported default effort.');
      if(defaults.stream!==undefined&&typeof defaults.stream!=='boolean')throw Error('Invalid streaming default.');
      if(!Array.isArray(channel.models)||channel.models.length>2000)throw Error('Invalid models.');
      const models=channel.models.map(model=>{
        object(model,['id','label','developer','contextLength','parameters','thinking','efforts','mapping','stream']);
        string(model.id,256);
        if(model.label!==undefined)string(model.label,200);
        if(model.developer!==undefined)string(model.developer,100);
        if(model.contextLength!==undefined&&(!Number.isSafeInteger(model.contextLength)||model.contextLength<1))throw Error('Invalid context length.');
        if(model.parameters!==undefined)list(model.parameters);
        if(model.efforts!==undefined)list(model.efforts,allowedEfforts);
        if(model.thinking!==undefined&&!['none','supported','toggle','required'].includes(model.thinking))throw Error('Invalid thinking capability.');
        if(model.mapping!==undefined&&(!mappings.includes(model.mapping)||
            !model.mapping.startsWith(channel.id+'-')))throw Error('Invalid adapter mapping.');
        if(model.stream!==undefined&&typeof model.stream!=='boolean')throw Error('Invalid streaming capability.');
        return {...model,label:model.label||model.id,channel:channel.id,source};
      });
      if(new Set(models.map(model=>model.id)).size!==models.length)throw Error('Duplicate model ID.');
      const families=channel.families ?? [];
      if(!Array.isArray(families)||families.length>100)throw Error('Invalid model families.');
      const seen=new Set();
      for(const family of families){
        object(family,['base','reference']);
        string(family.base,256);
        if(seen.has(family.base)||!models.some(model=>model.id===family.reference && model.thinking && Array.isArray(model.efforts)))
          throw Error('Invalid model family reference.');
        seen.add(family.base);
      }
      return {id:channel.id,defaults,models,families};
    });
    if(new Set(channels.map(channel=>channel.id)).size!==channels.length)throw Error('Duplicate channel.');
    return {schemaVersion:1,version:input.version,channels};
  }
  async function read() {
    return (await chrome.storage.local.get(storeKey))[storeKey] || {};
  }
  async function download(value,maxBytes) {
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password)throw Error('Configuration URL must use HTTPS.');
    const response=await fetch(url,{redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    const reader=response.body.getReader();
    const decoder=new TextDecoder();
    let bytes=0,text='';
    try{
      while(true){
        const {value,done}=await reader.read();
        if(done)break;
        bytes+=value.byteLength;
        if(bytes>maxBytes)throw Error('Catalog exceeds the allowed download size.');
        text+=decoder.decode(value,{stream:true});
      }
      text+=decoder.decode();
    }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    return JSON.parse(text);
  }
  async function update(value,refresh=false) {
    const data=validate(await download(value,1_000_000));
    const state=await read();
    if(refresh && data.version===state.current?.version)return data.version;
    if(data.version<=(state.current?.version || 0))throw Error('Configuration version is not newer.');
    await chrome.storage.local.set({[urlKey]:value,[storeKey]:{current:{...data,updatedAt:new Date().toISOString()},previous:state.current || null}});
    return data.version;
  }
  async function rollback() {
    const {previous,current}=await read();
    if(!current)throw Error('No reference configuration to roll back.');
    await chrome.storage.local.set({[storeKey]:{current:previous || null,previous:null}});
    return previous?.version || 0;
  }
  async function sourceUrl(){
    return (await chrome.storage.local.get(urlKey))[urlKey] || '';
  }
  async function refreshRules(){
    const url=await sourceUrl();
    return url ? update(url,true) : null;
  }
  function modelRule(channel,id){
    const exact=channel?.models.find(model=>model.id===id);
    if(exact)return exact;
    const family=channel?.families?.find(({base})=>
      id===base || id.startsWith(base+'-') && /^(?:\d{4}|\d{8}|\d{4}-\d{2}-\d{2})$/.test(id.slice(base.length+1)));
    const model=family && channel.models.find(item=>item.id===family.reference);
    return model ? {...model,id} : null;
  }
  function mergeModelRule(rule,official){
    if(!official)return rule;
    const fields=Object.fromEntries(Object.entries(official).filter(([,value])=>value!=null));
    if(fields.thinking==='supported' && ['toggle','required'].includes(rule?.thinking))delete fields.thinking;
    return {...rule,...fields};
  }
  async function channel(id) {
    const {current}=await read();
    const data=current?.channels.find(row=>row.id===id);
    return data ? {...data,models:data.models.map(model=>({...model,updatedAt:current.updatedAt}))} : null;
  }
  const supplementalKey='modelsDevReferenceV1';
  const modelDevChannels={openai:'openai',anthropic:'anthropic',deepseek:'deepseek',zai:'zai',
    mimo:'xiaomi',qwen:'alibaba',gemini:'google',openrouter:'openrouter'};
  async function refreshPublicCatalog() {
    const data=await download('https://models.dev/api.json',16_000_000);
    const updatedAt=new Date().toISOString();
    const catalogs={};
    let count=0;
    for(const [channel,sourceId] of Object.entries(modelDevChannels)){
      const models=data?.[sourceId]?.models;
      if(!models || typeof models!=='object' || Array.isArray(models))continue;
      catalogs[channel]=Object.values(models).flatMap(row=>{
        if(typeof row?.id!=='string'||!row.id||row.id.length>256)return [];
        const context=row.limit?.context;
        return [{id:row.id,channel,source:'models.dev',updatedAt,
          label:typeof row.name==='string' ? row.name.slice(0,200) : row.id,
          contextLength:Number.isSafeInteger(context)&&context>0 ? context : null,
          thinking:typeof row.reasoning==='boolean' ? (row.reasoning?'supported':'none') : null}];
      });
      count+=catalogs[channel].length;
    }
    if(!count)throw Error('Invalid Models.dev catalog.');
    await chrome.storage.local.set({[supplementalKey]:catalogs});
    return count;
  }
  async function publicMetadata(channel) {
    if(!Object.hasOwn(modelDevChannels,channel))return [];
    return (await chrome.storage.local.get(supplementalKey))[supplementalKey]?.[channel] || [];
  }
  globalThis.KRA_PROVIDER_CONFIG = {validate,update,rollback,channel,modelRule,mergeModelRule,sourceUrl,refreshRules,refreshPublicCatalog,publicMetadata};
})();

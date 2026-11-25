(() => {
  const registry = globalThis.KRA_PROVIDER_REGISTRY;
  const cacheKey = 'providerDirectoryV1';
  const vendorPaths = {gemini:'/v1beta/models',openai:'/v1/models',anthropic:'/v1/models',
    deepseek:'/models',zai:'/api/paas/v4/models'};
  // These catalogs are suggestions. They do not certify account access.
  const referenceOnUnsupported = new Set(['muse','hunyuan','qwen','mimo','zai']);
  const isText = model => !/(?:^|[\/:-])(?:embed(?:ding)?s?|rerank(?:er)?|whisper|tts|moderation|imagen|veo|sora|transcribe|dall-e)(?:[\/:.-]|$)/i.test(model);

  function directoryKey(config) {
    const url=new URL(registry.endpoint(config.endpoint,config.provider));
    url.search='';
    url.hash='';
    return JSON.stringify([config.provider,url.href,config.provider==='openrouter' ? '' : config.profileId || '']);
  }
  async function store(config,result) {
    const key = directoryKey(config);
    // Each catalog has its own storage key so parallel refreshes cannot overwrite each other.
    await chrome.storage.local.set({[cacheKey+key]:result});
  }
  async function load(config) {
    try {
      const key = cacheKey+directoryKey(config);
      return (await chrome.storage.local.get(key))[key] || null;
    } catch { return null; }
  }

  async function json(url, config={}, body) {
    const headers=config.provider==='gemini' ? {'x-goog-api-key':config.apiKey} : registry.headers(config.provider,config.apiKey);
    const response = await fetch(url,{method:body?'POST':'GET',headers,
      redirect:'error',credentials:'omit',signal:AbortSignal.timeout(20000),...(body ? {body:JSON.stringify(body)} : {})});
    if (!response.ok) throw Object.assign(Error(`HTTP ${response.status}`),{status:response.status});
    return response.json();
  }

  function modelsUrl(config) {
    const id = config.provider;
    const url = new URL(registry.endpoint(config.endpoint,id));
    if (id === 'qwen' && (/^[a-z0-9-]+\.[a-z0-9-]+\.maas\.aliyuncs\.com$/.test(url.hostname) || url.hostname === 'dashscope-us.aliyuncs.com')) url.pathname='/api/v1/models';
    else if (vendorPaths[id]) url.pathname = vendorPaths[id];
    else if (id === 'ollama') url.pathname = url.pathname.replace(/\/api\/chat$/,'/api/tags');
    else if (/\/chat\/completions\/?$/.test(url.pathname)) url.pathname = url.pathname.replace(/\/chat\/completions\/?$/,'/models');
    else if (!/\/models\/?$/.test(url.pathname)) url.pathname = url.pathname.replace(/\/$/,'') + (/\/v1\/?$/.test(url.pathname) ? '/models' : '/v1/models');
    return url;
  }

  function normalize(row,id,updatedAt,source) {
    const model = id === 'gemini' && typeof row.name==='string' ? row.name.replace(/^models\//,'') : row.id || row.model || row.key || row.name;
    if (id==='lmstudio' && row.type && row.type!=='llm')return null;
    if (typeof model !== 'string' || !model || !isText(model)) return null;
    if (Array.isArray(row.supportedGenerationMethods) && !row.supportedGenerationMethods.includes('generateContent')) return null;
    if (Array.isArray(row.architecture?.output_modalities) && !row.architecture.output_modalities.includes('text')) return null;
    if (Array.isArray(row.architecture?.input_modalities) && !row.architecture.input_modalities.includes('text')) return null;
    if(id==='qwen'){
      const {request_modality:input,response_modality:output}=row.inference_metadata || {};
      if([input,output].some(modalities=>Array.isArray(modalities) && !modalities.includes('Text')))return null;
    }
    const parameters = Array.isArray(row.supported_parameters) ? row.supported_parameters.filter(p=>typeof p==='string') : null;
    const text = value => typeof value==='string' && value.trim() ? value : null;
    const developer = id === 'openrouter' && model.includes('/') ? model.split('/')[0] :
      text(row.author?.name) || text(row.author) || text(row.developer) || text(row.publisher) || (id==='qwen' ? text(row.provider) : null);
    const reasoning = row.reasoning || row.capabilities?.reasoning;
    const localReasoningOptions=id==='lmstudio' && Array.isArray(reasoning?.allowed_options) ?
      reasoning.allowed_options.filter(value=>registry.localReasoningValues('native').includes(value)) : null;
    const thinking = localReasoningOptions?.some(value=>value!=='off') ? 'supported' : reasoning?.mandatory === true ? 'required' :
      parameters?.some(name=>['reasoning','reasoning_effort'].includes(name)) ||
      reasoning===true || row.thinking===true || (id==='qwen' && Array.isArray(row.capabilities) && row.capabilities.includes('Reasoning'))
        ? 'supported' : ['required','toggle','supported','none'].includes(row.thinking) ? row.thinking :
          reasoning===false || row.thinking===false ? 'none' : null;
    return {channel:id,id:model,label:text(row.displayName) || text(row.display_name) || text(row.label) || text(row.name) || model,
      developer,inferenceProvider:text(row.inference_provider),
      localReasoningOptions,contextLength:row.max_context_length ?? row.context_length ?? row.inputTokenLimit ?? row.top_provider?.context_length ?? row.model_info?.context_window ?? null,
      thinking,efforts:Array.isArray(reasoning?.supported_efforts) ? reasoning.supported_efforts.filter(value=>registry.efforts.includes(value)) : null,
      parameters,pricing:row.pricing || row.prices || null,architecture:row.architecture || row.inference_metadata || null,
      capabilities:Array.isArray(row.capabilities) ? row.capabilities : null,updatedAt,source};
  }

  async function discover(config) {
    const id = config.provider;
    const previous = await load(config);
    const updatedAt = new Date().toISOString();
    let source = id === 'openrouter' ? 'public-api' : 'service-api';
    let rows;
    try {
      const url = modelsUrl(config);
      if (!config.apiKey && !registry.keyOptional(url,id) && id !== 'openrouter') throw Error('API Key required');
      const qwenNative=id==='qwen' && url.pathname==='/api/v1/models';
      if(qwenNative){
        url.searchParams.set('page_no','1');
        url.searchParams.set('page_size','100');
      }
      rows = [];
      for (let page = 0; page < 100; page++) {
        let data;
        if(id==='lmstudio'){
          const native=new URL(url);
          native.pathname=native.pathname.replace(/(?:\/v1)?\/models\/?$/,'/api/v1/models');
          try{ data={data:(await json(native,config)).models}; }
          catch(error){ if(error.status!==404 && error.status!==405)throw error; }
        }
        data ??= await json(url,id==='openrouter' ? {provider:id} : config);
        if(qwenNative && data.success===false)throw Error('Qwen model list request failed.');
        const batch = qwenNative ? data.output?.models : id === 'gemini' || id === 'ollama' ? data.models : data.data;
        if (!Array.isArray(batch)) throw Error('Invalid model list');
        rows.push(...batch);
        if(qwenNative && Number(data.output.page_no)*Number(data.output.page_size)<Number(data.output.total)){
          url.searchParams.set('page_no',String(page+2));
        }
        else if (id === 'gemini' && data.nextPageToken) url.searchParams.set('pageToken',data.nextPageToken);
        else if (id === 'anthropic' && data.has_more && data.last_id) url.searchParams.set('after_id',data.last_id);
        else break;
        if (page === 99) throw Error('Model list pagination limit exceeded');
      }
    } catch(error) {
      if (!referenceOnUnsupported.has(id) || previous && previous.source !== 'bundled-reference' || ![404,405,501].includes(error.status)) throw error;
      source='bundled-reference';
      rows=registry.get(id).models;
    }
    const oldIds = new Set(previous?.models.map(model=>model.id) || []);
    const models = [...new Map(rows.flatMap(row=>{
      if (!row || typeof row !== 'object') return [];
      const model = normalize(row,id,updatedAt,source);
      return model ? [[model.id,model]] : [];
    })).values()];
    const result = {models,source,updatedAt,added:models.filter(model=>!oldIds.has(model.id)).length};
    await store(config,result);
    return result;
  }

  async function inferenceProviders(model,apiKey) {
    const parts = model.split('/');
    if (parts.length !== 2 || parts.some(part=>!part || part === '.' || part === '..')) throw Error('Enter an OpenRouter model ID (developer/model).');
    const config = {provider:'openrouter',apiKey};
    const [modelData,providers] = await Promise.all([
      json(registry.routerBase+'/models/'+parts.map(encodeURIComponent).join('/')+'/endpoints',config),
      json(registry.routerBase+'/providers',config)
    ]);
    if (!Array.isArray(modelData.data?.endpoints) || !Array.isArray(providers.data)) throw Error('Invalid OpenRouter provider list');
    const slugs = new Set(providers.data.map(p=>p.slug));
    const names = new Map(providers.data.map(p=>[p.name,p.slug]));
    const matches = modelData.data.endpoints.flatMap(row=>{
      const slug = row.tag || row.provider_slug || names.get(row.provider_name);
      return typeof slug === 'string' && (row.tag || row.provider_slug || slugs.has(slug)) ?
        [[slug,{id:slug,label:row.provider_name || slug,...(Array.isArray(row.supported_parameters) ?
          {parameters:row.supported_parameters.filter(value=>typeof value==='string')} : {})}]] : [];
    });
    return [...new Map(matches).values()];
  }

  async function ollamaDetails(config) {
    const url = new URL(registry.endpoint(config.endpoint,'ollama'));
    url.pathname = url.pathname.replace(/\/api\/chat$/,'/api/show');
    const data = await json(url,config,{model:config.model});
    const capabilities = Array.isArray(data.capabilities) ? data.capabilities : null;
    const architecture = data.model_info?.['general.architecture'];
    const advertised=Array.isArray(data.thinking?.values) ? data.thinking.values.filter(
      value=>typeof value==='boolean' || typeof value==='string' && value.length>0 && value.length<=100) : null;
    const legacyLevels=data.details?.family==='gptoss'||architecture==='gptoss' ? ['low','medium','high'] : null;
    const thinkValues=advertised ?? legacyLevels ?? (capabilities?.includes('thinking') ? [false,true] : null);
    const efforts=thinkValues?.filter(value=>typeof value==='string') || [];
    const canThink=thinkValues?.some(value=>value!==false);
    const thinking=thinkValues?.length ? (canThink ? (thinkValues.includes(false)?'supported':'required') : 'none') : null;
    return {channel:'ollama',id:config.model,label:config.model,developer:null,inferenceProvider:null,source:'service-api',
      updatedAt:new Date().toISOString(),contextLength:data.model_info?.[architecture+'.context_length'] ?? null,
      parameters:null,capabilities,thinking,efforts,thinkValues,
      thinkDefault:thinkValues?.includes(data.thinking?.default) ? data.thinking.default : null};
  }

  const detailKey = config => cacheKey+directoryKey(config)+':'+JSON.stringify(config.model);
  async function loadDetail(config) {
    const key = detailKey(config);
    return (await chrome.storage.local.get(key))[key] || null;
  }
  async function refreshDetail(config) {
    const detail = await ollamaDetails(config);
    await chrome.storage.local.set({[detailKey(config)]:detail});
    return detail;
  }

  globalThis.KRA_PROVIDER_DIRECTORY = {load,discover,inferenceProviders,refreshDetail,loadDetail,modelsUrl};
})();

(() => {
  const catalog = globalThis.KRA_MODEL_CATALOG;
  const routerBase = 'https://openrouter.ai/api/v1';
  const locals = {
    ollama: ['Ollama', 'http://127.0.0.1:11434'],
    lmstudio: ['LM Studio', 'http://127.0.0.1:1234'],
    llamacpp: ['llama.cpp Server', 'http://127.0.0.1:8080'],
    vllm: ['vLLM', 'http://127.0.0.1:8000'],
    localai: ['LocalAI', 'http://127.0.0.1:8080'],
    local: ['OpenAI-compatible · Local', 'http://127.0.0.1:8080']
  };
  const providers = [
    ...catalog.providers.slice(0, -1),
    {id:'openrouter', label:'OpenRouter', endpoint:routerBase+'/chat/completions', models:[]},
    ...Object.entries(locals).map(([id,[label,endpoint]]) => ({id,label,endpoint,models:[]})),
    catalog.providers.at(-1)
  ];
  const get = id => providers.find(p => p.id === id) || providers.at(-1);
  const local = id => Object.hasOwn(locals,id);
  const efforts = ['minimal','low','medium','high','xhigh','max'];
  const routes = ['balanced','price','throughput','latency','only'];
  const idOf = config => config.provider || catalog.inferProvider(config.endpoint);

  function privateHost(host) {
    return ['localhost','[::1]'].includes(host) || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) && /^\d+(?:\.\d+){3}$/.test(host)
      || /^\[(?:f[cd]|fe[89ab])[0-9a-f]*:/i.test(host) || host.endsWith('.local');
  }

  function checkedUrl(value, id) {
    const url = new URL(value);
    const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if (url.username || url.password || (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && (loopback || local(id) && privateHost(url.hostname))))) {
      throw Error('Use HTTPS for remote APIs. Local channels allow HTTP on loopback and private network addresses.');
    }
    if (id === 'openrouter' && url.origin !== 'https://openrouter.ai') throw Error('OpenRouter requires https://openrouter.ai.');
    return url;
  }

  function endpoint(value,id) {
    const url = checkedUrl(value,id);
    if (id === 'openrouter') return get(id).endpoint;
    if (id === 'ollama' || (local(id) && !/\/chat\/completions\/?$/.test(url.pathname)) ||
        (id === 'custom' && (url.pathname==='/' || /\/v1\/?$/.test(url.pathname)))) {
      const path=url.pathname.replace(/\/$/,'');
      if(id==='ollama')url.pathname=path.replace(/\/(?:api\/chat|api|v1)$/,'')+'/api/chat';
      else url.pathname=path+(/\/v1$/.test(path)?'/chat/completions':'/v1/chat/completions');
    }
    return url.href;
  }
  const keyOptional = (url,id) => local(id) || url.protocol === 'http:' && privateHost(url.hostname);
  const originPattern = url => `${url.protocol}//${url.hostname}/*`;
  function headers(id,key) {
    const auth = id === 'anthropic' ? {'x-api-key':key || '', 'anthropic-version':'2023-06-01'} :
      key ? (id === 'mimo' ? {'api-key':key} : {Authorization:`Bearer ${key}`}) : {};
    return {'Content-Type':'application/json',...auth};
  }

  function routing(config) {
    const mode = config.routerMode || 'balanced';
    if (mode === 'balanced') return undefined;
    if (routes.slice(1,4).includes(mode)) return {sort:mode};
    if (mode === 'only' && config.routerProvider && config.routerProviderModel === config.model) {
      return {only:[config.routerProvider],allow_fallbacks:false};
    }
    const error = Error('Select an available OpenRouter provider for this model.');
    error.permanent = true;
    throw error;
  }

  const advancedRanges={
    temperature:[0,2],top_p:[0,1],top_k:[1,Number.MAX_SAFE_INTEGER,true],
    min_p:[0,1],top_a:[0,1],frequency_penalty:[-2,2],presence_penalty:[-2,2],
    repetition_penalty:[0,2],seed:[0,Number.MAX_SAFE_INTEGER,true],
    reasoning_max_tokens:[1,Number.MAX_SAFE_INTEGER,true]
  };
  function advancedOptions(value) {
    if(!value || typeof value!=='object' || Array.isArray(value))throw Error('OpenRouter parameters must be a JSON object.');
    return Object.fromEntries(Object.entries(value).map(([key,number])=>{
      const range=Object.hasOwn(advancedRanges,key) && advancedRanges[key];
      if(!range || !Number.isFinite(number) || number<range[0] || number>range[1] ||
         range[2]&&!Number.isSafeInteger(number))throw Error('Invalid OpenRouter parameter: '+key);
      return [key,number];
    }));
  }

  const localReasoningModes = id => ({
    lmstudio:['native'],llamacpp:['effort','template'],vllm:['effort','template'],localai:['template','metadata'],
    local:['effort','template','metadata'],custom:['effort','template','metadata']
  })[id] || [];
  const localReasoningValues = mode => ({
    native:['off','on','low','medium','high'],
    effort:['off','low','medium','high','minimal','xhigh','max'],
    template:['off','on','low','medium','high'],
    metadata:['off','on','low','medium','high']
  })[mode] || [];
  const localReasoningEnabled = (id,mode,value) =>
    localReasoningModes(id).includes(mode) && localReasoningValues(mode).includes(value);

  function adapt(config,body,limit) {
    const id = idOf(config);
    const cap = id==='openrouter' && config.routerMode==='only' && Array.isArray(config.routerProviderParameters) ?
      {...config.modelCapability,parameters:config.routerProviderParameters} : config.modelCapability;
    if (id === 'openrouter') {
      const provider = routing(config);
      if (provider) body.provider = provider;
      const {reasoning_max_tokens,...sampling}=advancedOptions(config.routerAdvanced || {});
      for(const [key,value] of Object.entries(sampling))if(cap?.parameters?.includes(key))body[key]=value;
      if (!cap?.parameters?.includes('response_format')) delete body.response_format;
      if (cap?.parameters?.includes('reasoning') || cap?.parameters?.includes('reasoning_effort')) {
        const enabled=cap.thinking==='required'||config.disableThinking===false;
        const effort=enabled ? ((cap.efforts || efforts).includes(config.reasoningEffort) ? config.reasoningEffort : undefined) : 'none';
        if(cap.mapping==='openrouter-effort' || !cap.parameters.includes('reasoning')){
          if(effort)body.reasoning_effort=effort;
        } else if(enabled && reasoning_max_tokens){
          if(reasoning_max_tokens>=limit)throw Object.assign(Error('Reasoning token budget must be below the output token limit.'),{permanent:true});
          body.reasoning={max_tokens:reasoning_max_tokens};
        } else if(effort)body.reasoning={effort};
        else body.reasoning={enabled:true};
      }
    }
    if (local(id) || id==='custom'&&Array.isArray(cap?.parameters)) {
      if (!cap?.parameters?.includes('response_format')) delete body.response_format;
    }
    if (cap?.stream===false) delete body.stream;
    const {localReasoningMode:mode,localReasoningValue:value}=config;
    if(localReasoningEnabled(id,mode,value)){
      const enabled=value!=='off';
      if(mode==='native')return {model:body.model,system_prompt:body.messages[0].content,
        input:body.messages[1].content,max_output_tokens:limit,reasoning:value,stream:body.stream===true,store:false};
      if(mode==='effort')body.reasoning_effort=enabled ? value : 'none';
      if(mode==='template')body.chat_template_kwargs={enable_thinking:enabled,...(enabled && value!=='on' ? {reasoning_effort:value} : {})};
      if(mode==='metadata')body.metadata={enable_thinking:String(enabled),...(enabled && value!=='on' ? {reasoning_effort:value} : {})};
    }
    if (id !== 'ollama') return body;
    const supportsThinking = ['supported','required'].includes(cap?.thinking);
    const levels=cap?.efforts?.length ? cap.efforts : cap?.mapping==='ollama-level' ? ['low','medium','high'] : [];
    let think;
    if(supportsThinking){
      const enabled=cap.thinking==='required'||config.disableThinking===false;
      think=!enabled ? false : levels.length ? (
        levels.includes(config.reasoningEffort) ? config.reasoningEffort :
          levels.includes(cap.thinkDefault) ? cap.thinkDefault : levels[0]
      ) : true;
    }
    return {model:body.model,messages:body.messages,stream:body.stream === true,
      options:{num_predict:limit},...(think!==undefined ? {think} : {})};
  }

  globalThis.KRA_PROVIDER_REGISTRY = {providers,get,idOf,local,routerBase,efforts,routes,checkedUrl,endpoint,keyOptional,originPattern,headers,adapt,routing,advancedOptions,localReasoningModes,localReasoningValues,localReasoningEnabled};
})();

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readModelContent} from '../model-stream.js';
import {prepareRequest} from '../provider-adapter.js';
import {reviewTargets} from '../choice-review.js';
import '../provider-directory.js';
import '../provider-config.js';
import '../api-profiles.js';

const registry=globalThis.KRA_PROVIDER_REGISTRY;
const directory=globalThis.KRA_PROVIDER_DIRECTORY;
const reference=globalThis.KRA_PROVIDER_CONFIG;
const endpoint=registry.get('openrouter').endpoint;
const messages=[{role:'system',content:'Return JSON.'},{role:'user',content:'경제'}];
const model='acme/chat';
const config={endpoint,model,provider:'openrouter',profileId:'fixture'};
const reply=data=>Response.json(data);

function mock(t,fetch) {
  const originalFetch=globalThis.fetch;
  const originalChrome=globalThis.chrome;
  const state={};
  globalThis.fetch=fetch;
  globalThis.chrome={storage:{local:{get:async key=>({[key]:structuredClone(state[key])}),
    set:async values=>Object.assign(state,structuredClone(values))}}};
  t.after(()=>{
    globalThis.fetch=originalFetch;
    globalThis.chrome=originalChrome;
  });
}

test('OpenRouter routing preserves the selected model and keeps strict provider slugs',()=>{
  const expected={balanced:undefined,price:{sort:'price'},throughput:{sort:'throughput'},
    latency:{sort:'latency'},only:{only:['alpha/us'],allow_fallbacks:false}};
  for(const [routerMode,provider] of Object.entries(expected)){
    const request=prepareRequest({...config,routerMode,routerProvider:'alpha/us',routerProviderModel:model,
      disableThinking:false,reasoningEffort:'high',modelCapability:{parameters:['reasoning','response_format']}},messages,2000);
    assert.equal(request.body.model,model);
    assert.deepEqual(request.body.provider,provider);
    assert.deepEqual(request.body.reasoning,{effort:'high'});
    assert.equal(request.body.response_format.type,'json_object');
  }
  assert.throws(()=>prepareRequest({...config,routerMode:'only',routerProvider:'alpha/us',routerProviderModel:'acme/other'},messages,2000),/Select an available/);
  const request=prepareRequest({...config,provider:'custom',endpoint:'https://example.com/v1',routerMode:'price'},messages,2000);
  assert.equal(request.body.provider,undefined);
  assert.equal(request.endpoint,'https://example.com/v1/chat/completions');
});

test('OpenRouter advanced settings use only advertised parameters and never override routing',()=>{
  const request=prepareRequest({...config,routerMode:'only',routerProvider:'alpha/us',routerProviderModel:model,
    modelCapability:{parameters:['temperature','response_format','reasoning'],efforts:['high']},
    routerProviderParameters:['temperature','reasoning'],disableThinking:false,reasoningEffort:'high',
    routerAdvanced:{temperature:0.2,top_p:0.8,reasoning_max_tokens:300}},messages,2000);
  assert.equal(request.body.temperature,0.2);
  assert.equal(request.body.top_p,undefined);
  assert.equal(request.body.response_format,undefined);
  assert.deepEqual(request.body.reasoning,{max_tokens:300});
  assert.deepEqual(request.body.provider,{only:['alpha/us'],allow_fallbacks:false});
  assert.throws(()=>registry.advancedOptions({model:'acme/other'}),/Invalid OpenRouter parameter/);
});

test('discovery keeps previous success on failure, handles removed and new models, and uses provider tags',async t=>{
  let version=0;
  mock(t,async (input,init)=>{
    const path=new URL(input).pathname;
    assert.equal(init.redirect,'error');
    if(path.endsWith('/providers'))return reply({data:[{name:'Alpha Inference',slug:'alpha'}]});
    if(path.endsWith('/endpoints'))return reply({data:{endpoints:[{provider_name:'Alpha Inference',tag:'alpha/us'},{provider_name:'Alpha Inference'},{provider_name:'Unknown'}]}});
    if(version===2)return new Response('',{status:503});
    return reply({data:[
      {id:version ? 'acme/new' : model,name:'Acme Chat',context_length:8192,pricing:{prompt:'0.0001'},supported_parameters:['reasoning','temperature']},
      {id:'acme/embed-v1'},
      {id:'acme/image',architecture:{output_modalities:['image']}}
    ]});
  });
  assert.deepEqual((await directory.discover(config)).models.map(row=>row.id),[model]);
  version=1;
  const refreshed=await directory.discover(config);
  assert.equal(refreshed.added,1);
  assert.equal(refreshed.models[0].developer,'acme');
  assert.equal(refreshed.models[0].contextLength,8192);
  assert.deepEqual(refreshed.models[0].pricing,{prompt:'0.0001'});
  version=2;
  await assert.rejects(directory.discover(config),/503/);
  assert.deepEqual(await directory.load(config),refreshed);
  assert.deepEqual(await directory.inferenceProviders(model),[
    {id:'alpha/us',label:'Alpha Inference'},{id:'alpha',label:'Alpha Inference'}
  ]);
});

test('vendor and compatible directory URLs preserve the origin and version prefix',()=>{
  const directoryUrl=(provider,endpoint)=>directory.modelsUrl({provider,endpoint}).href;
  assert.equal(directoryUrl('custom','https://api.example.com'),'https://api.example.com/v1/models');
  assert.equal(directoryUrl('custom','https://api.example.com/gateway/v1/'),'https://api.example.com/gateway/v1/models');
  assert.equal(directoryUrl('custom','https://api.example.com/gateway/v1/chat/completions'),'https://api.example.com/gateway/v1/models');
  assert.equal(directoryUrl('qwen','https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions'),'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/models');
  assert.equal(directoryUrl('gemini',registry.get('gemini').endpoint),'https://generativelanguage.googleapis.com/v1beta/models');
  assert.equal(directoryUrl('anthropic',registry.get('anthropic').endpoint),'https://api.anthropic.com/v1/models');
  assert.throws(()=>registry.endpoint('https://other.example/api','openrouter'));
  assert.throws(()=>registry.endpoint('http://example.com','ollama'));
});

test('native Ollama discovery, capability lookup, keyless requests and NDJSON',async t=>{
  const local={provider:'ollama',endpoint:'http://192.168.1.2:11434',model:'dev:latest'};
  let namedLevels=false;
  mock(t,async(input,init)=>{
    const path=new URL(input).pathname;
    assert.equal(init.headers.Authorization,undefined);
    if(path==='/api/tags')return reply({models:[{name:local.model}]});
    assert.equal(path,'/api/show');
    assert.deepEqual(JSON.parse(init.body),{model:local.model});
    return reply({capabilities:['completion','thinking'],model_info:{'general.architecture':'dev','dev.context_length':4096},
      ...(namedLevels?{thinking:{values:['brief','deep'],default:'deep'}}:{})});
  });
  const result=await directory.discover(local);
  assert.equal(result.models[0].id,local.model);
  const modelCapability=await directory.refreshDetail(local);
  assert.equal(modelCapability.contextLength,4096);
  assert.deepEqual(await directory.loadDetail(local),modelCapability);
  const request=prepareRequest({...local,modelCapability,stream:true,disableThinking:false},messages,2000);
  assert.equal(request.endpoint,local.endpoint+'/api/chat');
  assert.deepEqual(request.body,{model:local.model,messages,stream:true,options:{num_predict:2000},think:true});
  namedLevels=true;
  const named=await directory.refreshDetail(local);
  assert.equal(named.thinking,'required');
  assert.equal(prepareRequest({...local,modelCapability:named},messages,2000).body.think,'deep');
  assert.equal(prepareRequest({...local,modelCapability:named,reasoningEffort:'brief'},messages,2000).body.think,'brief');
  const jsonRows=[
    {message:{thinking:'discard reasoning',content:''},done:false},
    {message:{content:'{"results":'},done:false},
    {message:{content:'[]}'},done:true,done_reason:'stop'}
  ].map(row=>JSON.stringify(row)).join('\n');
  const ndjson=body=>new Response(body,{headers:{'Content-Type':'application/x-ndjson'}});
  assert.equal(await readModelContent(ndjson(jsonRows),{protocol:'ollama'}),'{"results":[]}');
  assert.equal(await readModelContent(reply({message:{thinking:'ignore',content:'ok'},done:true,done_reason:'stop'}),{protocol:'ollama'}),'ok');
  await assert.rejects(()=>readModelContent(ndjson('{"error":"model missing"}'),{protocol:'ollama'}),/API/);
});

test('existing official adapter requests still validate dictionary choices end to end',async t=>{
  let fixture;
  mock(t,async (input,init)=>{
    const {provider}=fixture;
    const body=JSON.parse(init.body);
    const user=(body.input||body.messages).find(item=>item.role==='user');
    const wire=JSON.parse(user.content);
    const id=wire.targets[0].target_id;
    const result=JSON.stringify({results:[{t:id,c:null}]});
    if(provider==='openai'){
      assert.equal(body.store,false);
      assert.equal(init.headers.Authorization,'Bearer test');
      return reply({status:'completed',output:[{type:'message',content:[{type:'output_text',text:result}]}]});
    }
    if(provider==='anthropic'){
      assert.equal(init.headers['x-api-key'],'test');
      return reply({stop_reason:'end_turn',content:[{type:'thinking',thinking:'ignore'},{type:'text',text:result}]});
    }
    if(provider==='ollama'){
      assert.equal(init.headers.Authorization,undefined);
      assert.equal(body.stream,true);
      return new Response(JSON.stringify({message:{content:result},done:true,done_reason:'stop'})+'\n',
        {headers:{'Content-Type':'application/x-ndjson'}});
    }
    if(provider==='mimo')assert.equal(init.headers['api-key'],'test');
    else assert.equal(init.headers.Authorization,'Bearer test');
    if(body.stream){
      const rows=[
        {provider:provider==='openrouter'?'Alpha Inference':undefined,choices:[{index:0,delta:{reasoning:'ignore',content:result}}]},
        {choices:[{index:0,delta:{},finish_reason:'stop'}]}
      ];
      return new Response(rows.map(row=>'data: '+JSON.stringify(row)+'\n\n').join('')+'data: [DONE]\n\n',
        {headers:{'Content-Type':'text/event-stream'}});
    }
    return reply({choices:[{message:{content:result},finish_reason:'stop'}]});
  });
  const target={target_id:'original',start:0,end:2,surface:'경제',context:'경제',
    options:[{choice_id:null,type:'keep',replacement:'경제',entry_id:null,definitions:[]},{choice_id:'c0',type:'hanja',replacement:'經濟',entry_id:1,definitions:['economy']}]};
  for(const provider of ['openai','anthropic','mimo','qwen','gemini','deepseek','zai','muse','hunyuan','custom','openrouter','ollama']){
    const item=registry.get(provider);
    fixture={provider,endpoint:item.endpoint||'https://example.com/v1',model:item.models[0]?.id||model};
    const diagnostics=[];
    const result=await reviewTargets({...fixture,apiKey:provider==='ollama'?'':'test',enableModelReview:true,firstPassOnly:true,stream:['openrouter','ollama'].includes(provider),
      onDiagnostic:event=>diagnostics.push(event)},[target]);
    assert.equal(result.accepted.length,1,provider+': '+JSON.stringify(result.errors));
    if(provider==='openrouter')assert.match(diagnostics.find(event=>event.stage==='response-provider')?.message||'',/Alpha Inference/);
  }
});

test('reference configuration validates versions, rolls back, and cannot change credential destinations',async t=>{
  let version=1;
  let invalid=false;
  mock(t,async (url,init)=>{
    assert.equal(init.credentials,'omit');
    assert.equal(init.headers,undefined);
    return reply({schemaVersion:1,version,channels:[{
      id:'openrouter',defaults:{stream:true},models:[{id:model,parameters:['reasoning'],...(invalid ? {endpoint:'https://wrong.example'} : {})}]
    }]});
  });
  assert.equal(await reference.update('https://example.com/config.json'),1);
  await assert.rejects(reference.update('https://example.com/config.json'),/newer/);
  version=2;invalid=true;
  await assert.rejects(reference.update('https://example.com/config.json'),/Invalid/);
  assert.equal((await reference.channel('openrouter')).models[0].source,'remote-reference');
  invalid=false;
  assert.equal(await reference.update('https://example.com/config.json'),2);
  assert.equal(await reference.rollback(),1);
  const migration=globalThis.KRA_API_PROFILES.migrateApiProfileState({apiConfig:{endpoint,model},persistentApiKey:'legacy'});
  assert.equal(migration.profiles.default.model,model);
  assert.equal(migration.profiles.default.routerMode,'balanced');
  assert.equal(migration.profiles.default.localApiKey,'legacy');
});

test('optional live OpenRouter catalog contract', {skip:!process.env.KRA_ROUTER_FIXTURES},async t=>{
  const files={'/api/v1/models':'models','/api/v1/providers':'providers','/api/v1/models/openai/gpt-4o/endpoints':'endpoints'};
  mock(t,async input=>reply(JSON.parse(readFileSync(process.env.KRA_ROUTER_FIXTURES+files[new URL(input).pathname]+'.json','utf8'))));
  const result=await directory.discover(config);
  assert.ok(result.models.length>100);
  assert.ok((await directory.inferenceProviders('openai/gpt-4o')).length>0);
});

test('Qwen workspace model discovery parses the native paged catalog',async t=>{
  const config={provider:'qwen',endpoint:'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
    profileId:'workspace',apiKey:'test'};
  const pages=[];
  mock(t,async (input,init)=>{
    const url=new URL(input);
    assert.equal(url.pathname,'/api/v1/models');
    assert.equal(init.headers.Authorization,'Bearer test');
    const page=Number(url.searchParams.get('page_no'));
    pages.push(page);
    return reply({success:true,output:{page_no:page,page_size:1,total:2,models:[{
      model:'qwen/model-'+page,name:'Qwen Model '+page,provider:'qwen',inference_provider:'bailian',
      inference_metadata:{request_modality:['Text'],response_modality:page===1?['Text']:['Audio']},
      model_info:{context_window:8192}
    }]}});
  });
  const {models}=await directory.discover(config);
  assert.deepEqual(pages,[1,2]);
  assert.equal(models.length,1);
  assert.equal(models[0].developer,'qwen');
  assert.equal(models[0].inferenceProvider,'bailian');
  assert.equal(models[0].contextLength,8192);
});

test('Models.dev is separate, keyless metadata and does not change discovered account models',async t=>{
  mock(t,async (input,init)=>{
    if(String(input)==='https://models.dev/api.json'){
      assert.equal(init.headers,undefined);
      return reply({openai:{models:{outside:{id:'outside',name:'Public model',reasoning:true,limit:{context:1234}}}}});
    }
    return reply({data:[{id:'inside'}]});
  });
  assert.equal(await reference.refreshPublicCatalog(),1);
  assert.equal((await reference.publicMetadata('openai'))[0].contextLength,1234);
  const config={provider:'openai',endpoint:registry.get('openai').endpoint,apiKey:'test'};
  assert.deepEqual((await directory.discover(config)).models.map(model=>model.id),['inside']);
});

test('local reasoning sends only the selected server format',async()=>{
  const messages=[{role:'system',content:'Review'},{role:'user',content:'테스트'}];
  for(const [provider,mode,value,fields] of [
    ['lmstudio','native','high',{reasoning:'high',store:false}],
    ['llamacpp','template','off',{chat_template_kwargs:{enable_thinking:false}}],
    ['vllm','effort','medium',{reasoning_effort:'medium'}],
    ['localai','metadata','low',{metadata:{enable_thinking:'true',reasoning_effort:'low'}}],
    ['local','template','on',{chat_template_kwargs:{enable_thinking:true}}],
    ['custom','effort','off',{reasoning_effort:'none'}]
  ]){
    const config={provider,endpoint:registry.get(provider).endpoint||'https://example.test/v1/chat/completions',model:'example'};
    const unconfigured=prepareRequest(config,messages,1000);
    assert.equal(unconfigured.protocol,'chat');
    for(const key of Object.keys(fields))assert.equal(unconfigured.body[key],undefined);
    const configured=prepareRequest({...config,localReasoningMode:mode,localReasoningValue:value},messages,1000);
    for(const [key,expected] of Object.entries(fields))assert.deepEqual(configured.body[key],expected);
    if(provider==='lmstudio'){
      assert.equal(configured.protocol,'lmstudio');
      assert.equal(new URL(configured.endpoint).pathname,'/api/v1/chat');
      assert.equal(configured.body.input,'테스트');
      const events=[{type:'reasoning.delta',content:'ignore'},{type:'message.delta',content:'answer'},{type:'chat.end'}];
      const response=new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),
        {headers:{'content-type':'text/event-stream'}});
      assert.equal(await readModelContent(response,{protocol:configured.protocol}),'answer');
    }
  }
});

test('reasoning rules match dated snapshots without guessing other variants',()=>{
  const data=reference.validate({schemaVersion:1,version:1,channels:[{id:'qwen',
    models:[{id:'example',thinking:'toggle',efforts:['low','high']}],
    families:[{base:'example',reference:'example'}]
  }]});
  const rule=reference.modelRule(data.channels[0],'example-2026-11-25');
  assert.deepEqual(rule.efforts,['low','high']);
  assert.equal(reference.modelRule(data.channels[0],'example-reasoning'),null);
  assert.equal(reference.mergeModelRule(rule,{thinking:'supported'}).thinking,'toggle');
  assert.equal(reference.mergeModelRule(rule,{thinking:'none'}).thinking,'none');
  assert.deepEqual(globalThis.KRA_MODEL_CATALOG.resolve({provider:'qwen',model:'qwen3.8-max-1125'}).efforts,
    ['low','medium','xhigh']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const source=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const scripts=['api-profiles.js','model-catalog.js','provider-registry.js','provider-directory.js','provider-config.js','options.js'];
const copy=value=>structuredClone(value);

async function initialize(t,fetch,localState,sessionState={}) {
  const dom=new JSDOM(source('options.html'),{url:'https://extension.invalid/options.html',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const {window}=dom;
  function storage(state){
    return {
      get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,copy(state[key])])),
      set:async values=>Object.assign(state,copy(values)),
      remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete state[key];}
    };
  }
  Object.assign(window,{
    fetch,TextEncoder,TextDecoder,AbortSignal,
    chrome:{storage:{local:storage(localState),session:storage(sessionState)},
      permissions:{contains:async()=>true},runtime:{sendMessage:async()=>({ok:true})}}
  });
  for(const script of scripts)window.eval(source(script));
  const element=id=>window.document.getElementById(id);
  async function until(check){
    for(let i=0;i<100;i++){
      if(check())return;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.fail(element('status').textContent+' / '+element('directoryStatus').textContent+' / '+element('routerStatus').textContent);
  }
  const choose=(id,value,event='change')=>{
    element(id).value=value;
    element(id).dispatchEvent(new window.Event(event));
  };
  await until(()=>element('provider').options.length>0);
  return {element,until,choose};
}

test('refresh all isolates failed channels and keeps serving the configured model and credentials',async t=>{
  const original={id:'main',name:'Local proxy',provider:'custom',endpoint:'https://proxy.example/gateway/v1',
    model:'existing',localApiKey:'existing-key',keyStorageMode:'local',disableThinking:true};
  const localState={apiProfilesV1:{main:original},activeApiProfileId:'main'};
  const calls=[];
  let refresh=0;
  const {element,until,choose}=await initialize(t,async(input,init)=>{
    const url=new URL(input);
    calls.push(url.hostname);
    if(url.hostname==='proxy.example'){
      assert.equal(url.pathname,'/gateway/v1/models');
      assert.equal(init.headers.Authorization,'Bearer existing-key');
      return refresh ? new Response('',{status:500}) : Response.json({data:[{id:'new',name:'New Name',developer:'Fixture Labs'}]});
    }
    if(url.hostname==='openrouter.ai')return Response.json({data:[{id:'fixture/chat',name:'OpenRouter Fixture'}]});
    throw Error('Mock service offline');
  },localState);
  assert.deepEqual(calls,[]);
  assert.equal(element('routerSettings').hidden,true);
  element('refreshAllModels').click();
  await until(()=>!element('refreshAllModels').disabled && element('directoryStatus').textContent.includes('OpenRouter'));
  assert.ok(element('directoryStatus').textContent.includes('Ollama'));
  assert.ok(element('modelSelect').querySelector('option[value=new]'));
  assert.equal(element('model').value,'existing');
  assert.equal(localState.apiProfilesV1.main.localApiKey,'existing-key');
  assert.equal(localState.apiProfilesV1.main.endpoint,original.endpoint);
  choose('modelSelect','new');
  refresh++;
  element('refreshProviderModels').click();
  await until(()=>element('directoryStatus').textContent.includes('500'));
  await until(()=>!element('refreshProviderModels').disabled);
  assert.equal(element('modelSelect').value,'new');
  assert.equal(localState.apiProfilesV1.main.model,'existing');
  choose('provider','ollama');
  assert.equal(element('localSettings').hidden,false);
  assert.equal(element('endpoint').value,'http://127.0.0.1:11434');
});

test('OpenRouter settings filter catalogs and recheck provider availability when the model changes',async t=>{
  const localState={};
  const urls=[];
  const {element,until,choose}=await initialize(t,async input=>{
    const url=new URL(input);
    urls.push(url.pathname);
    if(url.pathname.endsWith('/providers'))return Response.json({data:[{name:'Alpha Inference',slug:'alpha'},{name:'Beta Inference',slug:'beta'}]});
    if(url.pathname.endsWith('/endpoints'))return Response.json({data:{endpoints:[
      url.pathname.includes('/fixture/second/') ? {provider_name:'Beta Inference',tag:'beta'} :
        {provider_name:'Alpha Inference',tag:'alpha/us'}
    ]}});
    return Response.json({data:[
      {id:'fixture/first',name:'Catalog Label One',supported_parameters:['reasoning'],reasoning:{supported_efforts:['low','high']}},
      {id:'fixture/second',name:'Catalog Label Two'},
      ...Array.from({length:210},(_,index)=>({id:'more/model-'+index,name:'Model '+index}))
    ]});
  },localState);
  choose('provider','openrouter');
  await until(()=>element('modelSelect').querySelector('option[value="fixture/first"]'));
  assert.equal(element('routerSettings').hidden,false);
  assert.equal(element('localSettings').hidden,true);
  assert.equal(element('routerMode').value,'balanced');
  assert.equal(element('modelSelect').options.length,201);
  assert.deepEqual([...element('routerDeveloper').options].map(option=>option.value),['','fixture','more']);
  choose('routerDeveloper','fixture');
  assert.deepEqual([...element('modelSelect').options].map(option=>option.value),['fixture/first','fixture/second','custom']);
  choose('modelSearch','Catalog Label','input');
  assert.equal(element('modelSelect').options.length,3);
  choose('modelSelect','fixture/first');
  choose('apiKey','fixture-key','input');
  choose('routerMode','only');
  await until(()=>element('routerProvider').querySelector('option[value="alpha/us"]'));
  choose('routerProvider','alpha/us');
  assert.deepEqual([...element('reasoningEffort').options].map(option=>option.value),['','low','high']);
  element('saveButton').click();
  await until(()=>localState.apiProfilesV1.default.routerProvider==='alpha/us');
  assert.equal(localState.apiProfilesV1.default.routerProviderModel,'fixture/first');
  choose('modelSelect','fixture/second');
  await until(()=>element('routerProvider').querySelector('option[value="beta"]'));
  assert.equal(element('routerProvider').value,'');
  choose('routerDeveloper','more');
  assert.equal(element('model').value,'fixture/second');
  assert.equal(element('modelSelect').querySelector('option[value="fixture/second"]').disabled,true);
  assert.equal(element('modelSelect').querySelector('option[value="fixture/first"]'),null);
  assert.ok(urls.includes('/api/v1/models/fixture/first/endpoints'));
  assert.ok(urls.includes('/api/v1/models/fixture/second/endpoints'));
});

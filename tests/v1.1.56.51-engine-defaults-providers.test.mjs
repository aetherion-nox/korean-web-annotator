import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {ENGINE_SWITCH_DEFAULTS,engineSwitchValues} from '../engine-defaults.js';
import {engineConfig} from '../local-engine.js';
import {normalizeBatchContextTier} from '../batch-budget.js';
import {reviewTargets,thinkingSettings} from '../choice-review.js';

const {JSDOM}=createRequire(import.meta.url)('jsdom');
const html=await fs.readFile(new URL('../options.html',import.meta.url),'utf8');
const engineScript=await fs.readFile(new URL('../engine-settings.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
const catalog=globalThis.KRA_MODEL_CATALOG;
const target={target_id:'t0',start:0,end:2,surface:'경제',context:'경제',
 options:[{choice_id:null,type:'keep',replacement:'경제',entry_id:null,definitions:[]}]};
const answer=JSON.stringify({results:[{t:'t0',c:null}]});

test('fresh engine defaults match the photographed switches; 1M is a separate default',async()=>{
 assert.deepEqual(ENGINE_SWITCH_DEFAULTS,{
  enableModelReview:true,preloadEngineOnStartup:true,nameProtection:true,
  filterDictionaryPeople:true,reviewPosFilter:true,experimentalHanja:true,
  hanjaReadingCheck:false,experimentalLoanword:true,smartSegmentation:true,
  reviewLocalConversions:true,retryInvalidDictionaryChoices:true,discardInvalidReviewResults:false,reviewAllCandidates:false,manualModelReview:true
 });
 assert.equal(normalizeBatchContextTier(undefined),'1m');
 assert.equal(normalizeBatchContextTier('invalid'),'1m');
 assert.equal(normalizeBatchContextTier('32k'),'32k');
 assert.equal(new JSDOM(html).window.document.querySelector('#batchContextTier option:checked').value,'1m');
 const previous=globalThis.chrome;
 try{
  globalThis.chrome={storage:{local:{get:async()=>({})}}};
  const result=await engineConfig();
  assert.equal(result.batchContextTier,'1m');
  for(const [key,value] of Object.entries(ENGINE_SWITCH_DEFAULTS))if(key!=='preloadEngineOnStartup')assert.equal(result[key],value,key);
 }finally{globalThis.chrome=previous;}
});

test('explicit review-disabled profiles keep their legacy choice before reset',()=>{
 const legacy=engineSwitchValues({enableModelReview:false});
 assert.equal(legacy.enableModelReview,false);
 for(const key of ['manualModelReview','experimentalHanja','experimentalLoanword','smartSegmentation'])
  assert.equal(legacy[key],false,key);
 assert.equal(engineSwitchValues({enableModelReview:false,experimentalHanja:true}).experimentalHanja,true);
});

test('reset button changes only the 14 switches and leaves batch size, keys, logs, dictionary, profiles untouched',async()=>{
 const dom=new JSDOM(html);
 const stored={
  enableModelReview:false,manualModelReview:false,smartSegmentation:false,
  batchContextTier:'128k',apiOutputTokenLimit:32768,manualOutputTokenLimit:131072,
  requestLoggingEnabled:true,requestLogs:[{id:'secret'}],
  profileStorage:{key:'not touched'},localApiKey:'do-not-reset',dictionary:'do-not-reset'
 };
 const context={
  document:dom.window.document,console,ENGINE_SWITCH_DEFAULTS,engineSwitchValues,
  normalizeBatchContextTier,readDictionaryInfo:async()=>({imported:true}),
  chrome:{storage:{local:{get:async()=>({...stored}),set:async obj=>Object.assign(stored,obj)}}}
 };
 vm.runInNewContext(engineScript.replace(/^import[^\n]*\n/gm,''),context);
 await tick();
 const root=dom.window.document.querySelector('.engine-switch-panel');
 assert.ok(root);
 assert.equal(root.querySelectorAll('input[type=checkbox]').length,14);
 assert.equal(root.contains(dom.window.document.getElementById('batchContextTier')),false);
 dom.window.document.getElementById('resetEngineSwitches').click();
 await tick();
 for(const [key,value] of Object.entries(ENGINE_SWITCH_DEFAULTS)){
  assert.equal(stored[key],value,key);
  assert.equal(dom.window.document.getElementById(key).checked,value,key);
 }
 assert.equal(stored.batchContextTier,'128k');
 assert.equal(stored.apiOutputTokenLimit,32768);
 assert.equal(stored.manualOutputTokenLimit,131072);
 assert.equal(stored.localApiKey,'do-not-reset');
 assert.equal(stored.dictionary,'do-not-reset');
 assert.deepEqual(stored.requestLogs,[{id:'secret'}]);
 assert.deepEqual(stored.profileStorage,{key:'not touched'});
 dom.window.close();
});

test('official endpoints and region-dependent Tencent model inference are selectable',()=>{
 const providers=Object.fromEntries(catalog.providers.map(p=>[p.id,p]));
 assert.equal(providers.gemini.endpoint,'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
 assert.equal(providers.muse.endpoint,'https://api.meta.ai/v1/chat/completions');
 assert.equal(providers.hunyuan.endpoint,'https://tokenhub.tencentmaas.com/v1/chat/completions');
 assert.equal(providers.hunyuan.models[0].id,'hy4-flash');
 for(const [provider,id] of [['gemini','gemini-3.5-flash'],['muse','muse-spark-1.3'],['hunyuan','hy4']])
  assert.ok(catalog.resolve({provider,model:id}));
 assert.equal(catalog.inferProvider('https://tokenhub-intl.tencentmaas.com/v1/chat/completions'),'hunyuan');
 assert.equal(catalog.inferProvider('https://tokenhub.tencentmaas.cn/v1/chat/completions'),'hunyuan');
 assert.equal(catalog.inferProvider('https://api.meta.ai/v1/chat/completions'),'muse');
});

test('reasoning flags are provider specific and do not inject unsupported thinking objects',()=>{
 assert.deepEqual(thinkingSettings({provider:'gemini',model:'gemini-3.5-flash',disableThinking:true,reasoningEffort:'high'}).body,{reasoning_effort:'high'});
 assert.deepEqual(thinkingSettings({provider:'gemini',model:'gemini-2.5-flash',disableThinking:true}).body,{reasoning_effort:'none'});
 assert.deepEqual(thinkingSettings({provider:'muse',model:'muse-spark-1.3',disableThinking:true,reasoningEffort:'max'}).body,{reasoning_effort:'max'});
 assert.deepEqual(thinkingSettings({provider:'hunyuan',model:'hy4',disableThinking:true}).body,{thinking:{type:'disabled'},reasoning_effort:'no_think'});
 assert.deepEqual(thinkingSettings({provider:'hunyuan',model:'hy4',disableThinking:false}).body,{thinking:{type:'enabled'},reasoning_effort:'high'});
 assert.deepEqual(thinkingSettings({provider:'hunyuan',model:'hy4-flash',disableThinking:true}).body,{thinking:{type:'disabled'},reasoning_effort:'no_think'});
});

test('Gemini, Muse and Tencent request adapters accept nonstreamed and SSE model replies',async()=>{
 const oldFetch=globalThis.fetch;
 try{
  for(const config of [
   {provider:'gemini',model:'gemini-3.5-flash',endpoint:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',reasoningEffort:'medium',disableThinking:true},
   {provider:'muse',model:'muse-spark-1.3',endpoint:'https://api.meta.ai/v1/chat/completions',reasoningEffort:'high',disableThinking:true},
   {provider:'hunyuan',model:'hy4',endpoint:'https://tokenhub.tencentmaas.com/v1/chat/completions',disableThinking:true}
  ]){
   for(const stream of [false,true]){
    globalThis.fetch=async(url,request)=>{
     assert.equal(url,config.endpoint);
     assert.equal(request.headers.Authorization,'Bearer fake-key');
     const body=JSON.parse(request.body);
     assert.equal(body.model,config.model);
     assert.equal(body.stream,stream||undefined);
     assert.equal(body.response_format.type,'json_object');
     assert.equal(body.thinking===undefined,config.provider!=='hunyuan');
     assert.equal(body.max_completion_tokens!==undefined,config.provider==='muse');
     assert.ok((body.max_tokens??body.max_completion_tokens)>=1024);
     if(!stream)return new Response(JSON.stringify({choices:[{message:{content:answer},finish_reason:'stop'}]}));
     const chunks=[
      'data: '+JSON.stringify({choices:[{index:0,delta:{content:answer},finish_reason:null}]})+'\n\n',
      'data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n',
      'data: [DONE]\n\n'
     ];
     return new Response(chunks.join(''),{headers:{'content-type':'text/event-stream'}});
    };
    const result=await reviewTargets({...config,stream,apiKey:'fake-key',context:'경제',enableModelReview:true},[target]);
    assert.equal(result.accepted.length,1,config.provider+' stream='+stream);
    assert.equal(result.accepted[0].option.type,'keep');
   }
  }
 }finally{globalThis.fetch=oldFetch;}
});

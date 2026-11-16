import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {reviewTargets,thinkingSettings} from '../choice-review.js';
const target={target_id:'t',start:0,end:2,surface:'경제',options:[{choice_id:'KEEP',type:'keep',replacement:'경제',definitions:[]}]};
const answer=JSON.stringify({results:[{target_id:'t',choice_id:'KEEP'}]});
test('latest provider models expose verified thinking capabilities',()=>{
 const catalog=globalThis.KRA_MODEL_CATALOG;
 for(const id of ['gpt-6-astra','gpt-6.1-sol','gpt-6-luna'])assert.ok(catalog.resolve({provider:'openai',model:id}));
 for(const id of ['claude-fable-5-1','claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5'])assert.ok(catalog.resolve({provider:'anthropic',model:id}));
 assert.deepEqual(thinkingSettings({provider:'openai',model:'gpt-6-luna',disableThinking:true}).body,{reasoning_effort:'none'});
 assert.equal(thinkingSettings({provider:'openai',model:'gpt-6-astra',disableThinking:true,reasoningEffort:'max'}).body.reasoning_effort,'max');
 assert.equal(thinkingSettings({provider:'anthropic',model:'claude-opus-5-5',disableThinking:true}).body.thinking.type,'adaptive');
 assert.equal(thinkingSettings({provider:'anthropic',model:'claude-sonnet-5-5',disableThinking:true}).body.thinking.type,'between_tools');
 assert.equal(thinkingSettings({provider:'anthropic',model:'claude-haiku-5-5',disableThinking:true,reasoningEffort:'max'}).body.output_config.effort,'low');
});
test('OpenAI Responses uses reasoning and parses output text without reasoning blocks',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url,request)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');
  const body=JSON.parse(request.body);
  assert.equal(body.reasoning.effort,'high');assert.equal(body.store,false);
  assert.equal(body.thinking,undefined);assert.equal(body.response_format,undefined);
  assert.equal(request.headers.Authorization,'Bearer test-key');
  return new Response(JSON.stringify({status:'completed',output:[{type:'reasoning',summary:[]},{type:'message',content:[{type:'output_text',text:answer}]}]}));
 };
 try{const result=await reviewTargets({provider:'openai',model:'gpt-6.1-sol',endpoint:'https://api.openai.com/v1/responses',apiKey:'test-key',enableModelReview:true,reasoningEffort:'high'},[target]);assert.equal(result.accepted.length,1);}finally{globalThis.fetch=original;}
});
test('Claude Messages uses native authentication and parses only text blocks',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url,request)=>{
  const body=JSON.parse(request.body);
  assert.equal(body.thinking.type,'adaptive');assert.equal(body.output_config.effort,'medium');
  assert.equal(body.messages[0].role,'user');assert.equal(typeof body.system,'string');assert.ok(body.max_tokens>0);
  assert.equal(body.response_format,undefined);assert.equal(body.reasoning_effort,undefined);
  assert.equal(request.headers['x-api-key'],'test-key');assert.equal(request.headers['anthropic-version'],'2023-06-01');assert.equal(request.headers.Authorization,undefined);
  return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'thinking',thinking:'private'},{type:'text',text:answer}]}));
 };
 try{const result=await reviewTargets({provider:'anthropic',model:'claude-opus-5-5',endpoint:'https://api.anthropic.com/v1/messages',apiKey:'test-key',enableModelReview:true,reasoningEffort:'medium'},[target]);assert.equal(result.accepted.length,1);}finally{globalThis.fetch=original;}
});
test('thinking controls hide unsupported toggles and expose supported efforts',()=>{
 const elements=Object.fromEntries(['#disableThinkingRow','#reasoningEffortRow','#modelCapabilityNote','#modelDocs'].map(id=>[id,{removeAttribute(){}}]));
 const context={catalog:globalThis.KRA_MODEL_CATALOG,providerInput:{value:'openai'},endpointInput:{value:'https://api.openai.com/v1/responses'},modelInput:{value:'gpt-6-astra'},disableThinkingInput:{checked:true},effortInput:{value:'',replaceChildren(...options){this.options=options}},uiLocale:{value:'en'},document:{querySelector:id=>elements[id]},Option:function(text,value){this.text=text;this.value=value},t:key=>key};
 vm.createContext(context);
 const source=fs.readFileSync(new URL('../options.js',import.meta.url),'utf8');
 vm.runInContext(source.slice(source.indexOf('const thinkingOffNotes='),source.indexOf("providerInput.addEventListener('change'")),context);
 context.refreshThinkingControls();assert.equal(elements['#disableThinkingRow'].hidden,true);assert.equal(context.disableThinkingInput.checked,false);assert.equal(context.effortInput.options.length,5);
 context.providerInput.value='anthropic';context.modelInput.value='claude-sonnet-5-5';context.refreshThinkingControls();assert.equal(elements['#disableThinkingRow'].hidden,false);assert.match(elements['#modelCapabilityNote'].textContent,/up-front/);
 context.disableThinkingInput.checked=true;context.refreshThinkingControls();assert.equal(elements['#reasoningEffortRow'].hidden,true);
 context.modelInput.value='claude-opus-5-5';context.refreshThinkingControls();assert.equal(elements['#disableThinkingRow'].hidden,true);assert.equal(elements['#reasoningEffortRow'].hidden,false);
});
test('OpenAI Chat Completions and existing MiMo authentication remain compatible',async()=>{
 const original=globalThis.fetch;
 let provider='openai';
 globalThis.fetch=async(url,request)=>{
  const body=JSON.parse(request.body);assert.equal(body.response_format.type,'json_object');
  if(provider==='openai'){assert.equal(body.reasoning_effort,'none');assert.equal(body.thinking,undefined);}
  else {assert.equal(request.headers['api-key'],'test-key');assert.equal(body.thinking.type,'disabled');}
  return new Response(JSON.stringify({choices:[{message:{content:answer}}]}));
 };
 try{
  for(const config of [{provider:'openai',model:'gpt-6-luna',endpoint:'https://api.openai.com/v1/chat/completions'},{provider:'mimo',model:'mimo-v2.6-flash',endpoint:'https://api.xiaomimimo.com/v1/chat/completions'}]){provider=config.provider;const result=await reviewTargets({...config,apiKey:'test-key',disableThinking:true,enableModelReview:true},[target]);assert.equal(result.accepted.length,1);}
 }finally{globalThis.fetch=original;}
});
test('truncated native responses do not accept dictionary choices',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({status:'incomplete',output:[{type:'message',content:[{type:'output_text',text:answer}]}]}));
 try{const result=await reviewTargets({provider:'openai',model:'gpt-6-luna',endpoint:'https://api.openai.com/v1/responses',enableModelReview:true},[target]);assert.equal(result.accepted.length,0);assert.equal(result.unresolved.length,1);}finally{globalThis.fetch=original;}
});

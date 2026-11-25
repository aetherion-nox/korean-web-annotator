import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {reviewTargets,thinkingSettings} from '../choice-review.js';

const catalog=globalThis.KRA_MODEL_CATALOG;
const validAnswer=JSON.stringify({results:[{t:'t0',c:null}]});
const target={target_id:'t0',start:0,end:2,surface:'경제',context:'경제',
 options:[{choice_id:null,type:'keep',replacement:'경제',definitions:[]}]};

test('TokenHub Hy4 family and Hy3 all expose an explicit thinking toggle',()=>{
 const models=['hy4-flash','hy4','hy4-preview','hy3'];
 for(const id of models){
  const ability=catalog.resolve({provider:'hunyuan',model:id});
  assert.equal(ability.thinking,'toggle',id);
  assert.deepEqual(ability.efforts,id==='hy3'?['low','high']:['high']);
  for(const [off,expected] of [[true,{thinking:{type:'disabled'},reasoning_effort:'no_think'}],
                               [false,{thinking:{type:'enabled'},reasoning_effort:id==='hy3'?'low':'high'}]]){
   assert.deepEqual(thinkingSettings({provider:'hunyuan',model:id,disableThinking:off}).body,expected,id);
  }
 }
 assert.deepEqual(thinkingSettings({provider:'hunyuan',model:'hy3',disableThinking:false,reasoningEffort:'high'}).body,
  {thinking:{type:'enabled'},reasoning_effort:'high'});
});

test('Hunyuan Flash toggle is visible and disabled effort picker is hidden in UI',()=>{
 const source=fs.readFileSync(new URL('../options.js',import.meta.url),'utf8');
 const elements=Object.fromEntries(['#disableThinkingRow','#reasoningEffortRow','#modelCapabilityNote','#modelDocs']
  .map(id=>[id,{removeAttribute(){}}]));
 const ctx={
  catalog,selectedModelMetadata:()=>null,providerInput:{value:'hunyuan'},
  endpointInput:{value:'https://tokenhub.tencentmaas.com/v1/chat/completions'},
  modelInput:{value:'hy4-flash'},disableThinkingInput:{checked:true},
  effortInput:{value:'',options:[],replaceChildren(...o){this.options=o;}},
  uiLocale:{value:'zh-CN'},Option:function(label,value){this.label=label;this.value=value;},
  document:{querySelector:selector=>elements[selector]},
  t:key=>key,hunyuanNotes:{'zh-CN':'test'},qwenNotes:{'zh-CN':'test'},
  thinkingOffNotes:{'zh-CN':'test'},fixedThinkingNotes:{'zh-CN':['none','required']}
 };
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('const thinkingOffNotes='),source.indexOf("providerInput.addEventListener('change'")),ctx);
 ctx.refreshThinkingControls('high');
 assert.equal(elements['#disableThinkingRow'].hidden,false);
 assert.equal(elements['#reasoningEffortRow'].hidden,true);
 ctx.disableThinkingInput.checked=false;
 ctx.refreshThinkingControls('high');
 assert.equal(elements['#reasoningEffortRow'].hidden,false);
 assert.deepEqual(ctx.effortInput.options.map(o=>o.value),['high']);
});

test('hy4-flash generates correct TokenHub request for thinking on/off in both transport modes',async()=>{
 const original=globalThis.fetch;
 try{
  for(const stream of [false,true])for(const disableThinking of [true,false]){
   globalThis.fetch=async(endpoint,request)=>{
    assert.equal(endpoint,'https://tokenhub.tencentmaas.com/v1/chat/completions');
    assert.equal(request.headers.Authorization,'Bearer sample-key');
    const body=JSON.parse(request.body);
    assert.equal(body.model,'hy4-flash');
    assert.deepEqual(body.thinking,{type:disableThinking?'disabled':'enabled'});
    assert.equal(body.reasoning_effort,disableThinking?'no_think':'high');
    assert.equal(body.stream,stream||undefined);
    assert.ok(body.max_tokens>=1024);
    if(!stream)return new Response(JSON.stringify({choices:[{index:0,finish_reason:'stop',message:{
      content:validAnswer,reasoning_content:disableThinking?'':'model thinking'}}]}));
    const streamText=[
      'data: '+JSON.stringify({choices:[{index:0,delta:{reasoning_content:'thinking'},finish_reason:null}]})+'\n\n',
      'data: '+JSON.stringify({choices:[{index:0,delta:{content:validAnswer},finish_reason:null}]})+'\n\n',
      'data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n',
      'data: [DONE]\n\n'
    ].join('');
    return new Response(streamText,{headers:{'content-type':'text/event-stream'}});
   };
   const result=await reviewTargets({provider:'hunyuan',model:'hy4-flash',apiKey:'sample-key',
    endpoint:'https://tokenhub.tencentmaas.com/v1/chat/completions',disableThinking,
    reasoningEffort:'high',stream,context:'경제',enableModelReview:true},[target]);
   assert.equal(result.accepted.length,1,JSON.stringify({stream,disableThinking,errors:result.errors}));
   assert.equal(result.accepted[0].option.type,'keep');
  }
 }finally{globalThis.fetch=original;}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readModelContent,choicePreviewParser} from '../model-stream.js';
import {reviewTargets} from '../choice-review.js';
const target={target_id:'t0',surface:'학교',start:0,end:2,context:'학교',options:[{choice_id:null,type:'keep',replacement:'학교',definitions:[]},{choice_id:'c0',type:'hanja',replacement:'學校',entry_id:1,definitions:['school']}]};
const event=(delta,finish_reason)=>({id:'hy-fixture',choices:[{index:0,delta,finish_reason}]});
const sse=x=>'data: '+(typeof x==='string'?x:JSON.stringify(x))+'\r\n\r\n';
function response(events){const bytes=new TextEncoder().encode(events.map(sse).join(''));let offset=0;return new Response(new ReadableStream({pull(controller){if(offset===bytes.length){controller.close();return;}const end=Math.min(offset+7,bytes.length);controller.enqueue(bytes.slice(offset,end));offset=end;}}),{headers:{'content-type':'text/event-stream; charset=utf-8'}});}
test('TokenHub SSE: role, reasoning, split UTF-8 JSON, usage, DONE',async()=>{
 const deltas=[],metadata=[];
 const content=await readModelContent(response([event({role:'assistant'}),event({reasoning_content:'{"results":[{"t":"t0","c":"wrong"}]}'}),event({content:'{"results":[{"t":"t0",'}),event({content:'"c":"學校"}]}'} ,'stop'),{choices:[],usage:{completion_tokens:42}},'[DONE]']),{onDelta:x=>deltas.push(x),onMetadata:x=>metadata.push(x)});
 assert.equal(content,'{"results":[{"t":"t0","c":"學校"}]}');assert.equal(deltas.join(''),content);assert.equal(metadata.at(-1).usage.completion_tokens,42);
});
test('preview permanently stops after results array; trailing objects cannot replace valid rows',()=>{
 let latest=[];const preview=choicePreviewParser([target],rows=>latest=rows,()=>null,{choiceIndex:{t0:{p0:['c0']}}});
 preview('{"results":[{"t":"t0","c":"p0"}],');assert.equal(latest[0].option.replacement,'學校');
 preview('"other":[{"t":"t0","c":null}]}');assert.equal(latest.length,1);assert.equal(latest[0].option.replacement,'學校');
});
test('explicit rejection cannot salvage preview rows, truncation remains recoverable',async()=>{
 for(const [reason,discard] of [['sensitive',true],['content_filter',true],['length',false]]){
 await assert.rejects(readModelContent(response([event({content:'{"results":[{"t":"t0","c":null},'}),event({},reason),'[DONE]'])),e=>Boolean(e.discardPartial)===discard);
 }
});
test('single missing index is compatible; usage-only chunk never becomes content',async()=>{
 assert.equal(await readModelContent(response([{choices:[{delta:{content:'hello'},finish_reason:'stop'}]},{choices:[],usage:{completion_tokens:1}},'[DONE]'])),'hello');
});
test('Hunyuan request asks for streaming usage, keeps JSON mode and excludes reasoning',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url,req)=>{const body=JSON.parse(req.body);assert.equal(body.stream,true);assert.deepEqual(body.stream_options,{include_usage:true});assert.equal(body.response_format.type,'json_object');return response([event({reasoning_content:'not an answer'}),event({content:'{"results":[{"t":"t0","c":null}]}'},'stop'),{choices:[],usage:{completion_tokens:20}},'[DONE]']);};
 try{const result=await reviewTargets({provider:'hunyuan',model:'hy4-flash',endpoint:'https://tokenhub.tencentmaas.com/v1/chat/completions',apiKey:'test',stream:true,enableModelReview:true,firstPassOnly:true,context:'학교',logger:{start:async()=>null,finish:async()=>{}}},[target]);assert.equal(result.accepted.length,1);}finally{globalThis.fetch=original;}
});

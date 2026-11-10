import {literalOriginOption} from './experimental-options.js';
// Protocol-specific SSE envelopes share one byte/framing reader. Reasoning is
// retained only in the opt-in log, never parsed as dictionary choices.
function streamError(message,detail=''){const e=Error(message);e.detail=detail;return e;}
export function choicePreviewParser(targets,onPreview,resolveExtra=()=>null){
 const known=new Map(targets.map(t=>[t.target_id,t]));
 let text='',position=0,array=false,start=-1,depth=0,string=false,escape=false,invalid=false;
 const rows=[];
 return chunk=>{
  text+=chunk;
  if(!array){const prefix=/^\s*(?:```(?:json)?\s*)?\{\s*"results"\s*:\s*\[/i.exec(text);if(!prefix)return;position=prefix[0].length;array=true;}
  let changed=false;
  for(;position<text.length;position++){
   const c=text[position];
   if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;continue;}
   if(c==='"'){string=true;continue;}
   if(c==='{'){if(depth===0)start=position;depth++;}
   else if(c==='}'&&depth){depth--;if(depth===0){
    let row;try{row=JSON.parse(text.slice(start,position+1));}catch{invalid=true;}
    if(!row||!known.has(row.target_id)||rows.some(r=>r.target_id===row.target_id))invalid=true;
    if(row)rows.push(row);changed=true;
   }}else if(c===']'&&depth===0){position=text.length;break;}
  }
  if(changed){const accepted=invalid?[]:rows.flatMap(row=>{const target=known.get(row.target_id),option=target?.options.find(o=>o.choice_id===row.choice_id)||resolveExtra(target,row.choice_id);return option?[{target,option}]:[];});onPreview(accepted);}
 };
}
// A literal etymology uses the same results[] streaming path as an existing
// choice_id. Validate each *complete* row locally before provisional display.
export function experimentalChoicePreviewParser(targets,config,onPreview){
 return choicePreviewParser(targets,onPreview,(target,id)=>literalOriginOption(target,id,config));
}

export async function readModelContent(response,{protocol='chat',signal,onStarted=()=>{},onDelta=()=>{},onRaw=()=>{},onMetadata=()=>{},maxContentChars=2_000_000}={}){
 const contentCap=Number.isSafeInteger(maxContentChars)?Math.min(16_000_000,Math.max(2_000_000,maxContentChars)):2_000_000;
 if(!response.headers.get('content-type')?.includes('text/event-stream')){
  const raw=await response.text();onRaw(raw);
  let data;try{data=JSON.parse(raw);}catch{throw streamError('模型响应不是有效 JSON',raw);}
  onMetadata(data);
  if(data.error)throw streamError('模型返回 API 错误',JSON.stringify(data.error));
  if(protocol==='responses'){
   if(data.status!=='completed')throw streamError('模型回复未正常结束',String(data.status));
   return (data.output||[]).filter(i=>i.type==='message').flatMap(i=>i.content||[]).filter(b=>b.type==='output_text').map(b=>b.text).join('');
  }
  if(protocol==='anthropic'){
   if(!['end_turn','stop_sequence'].includes(data.stop_reason))throw streamError('模型回复未正常结束',String(data.stop_reason));
   return (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
  }
  const choice=data.choices?.find(c=>c.index===0)||data.choices?.[0];
  if(choice?.finish_reason&&choice.finish_reason!=='stop')throw streamError('模型回复未正常结束，已保留原文',String(choice.finish_reason));
  return choice?.message?.content;
 }
 if(!response.body)throw streamError('模型流式响应为空');
 const reader=response.body.getReader(),decoder=new TextDecoder();
 let buffer='',lines=[],content='',finish=null,done=false,started=false;
 const append=delta=>{if(typeof delta==='string'){content+=delta;if(content.length>contentCap)throw streamError('模型回复超出审核结果大小限制');onDelta(delta);}};
 function dispatch(){
  if(!lines.length)return;const data=lines.join('\n');lines=[];
  if(data.trim()==='[DONE]'){done=true;return;}
  let event;try{event=JSON.parse(data);}catch{throw streamError('模型流式响应包含无效 JSON');}
  if(event.error||event.type==='error')throw streamError('模型返回流式 API 错误',JSON.stringify(event.error||event));
  if(!started){started=true;onStarted();}
  if(protocol==='responses'){
   if(event.type==='response.output_text.delta')append(event.delta);
   if(event.type==='response.completed'){finish=event.response?.status;onMetadata(event.response||event);done=true;}
   if(['response.failed','response.incomplete'].includes(event.type))throw streamError('模型回复未正常结束',JSON.stringify(event.response||event));
  }else if(protocol==='anthropic'){
   if(event.type==='content_block_start'&&event.content_block?.type==='text')append(event.content_block.text);
   if(event.type==='content_block_delta'&&event.delta?.type==='text_delta')append(event.delta.text);
   if(event.type==='message_start')onMetadata(event.message||event);
   if(event.type==='message_delta'){finish=event.delta?.stop_reason||finish;onMetadata(event);}
   if(event.type==='message_stop')done=true;
  }else{
   const choice=event.choices?.find(c=>c.index===0);if(choice){append(choice.delta?.content);if(choice.finish_reason)finish=choice.finish_reason;}
   if(event.usage||event.id)onMetadata(event);
  }
 }
 function line(value){if(value===''){dispatch();return;}if(value.startsWith('data:'))lines.push(value.slice(5).replace(/^ /,''));}
 try{
  while(!done){
   signal?.throwIfAborted();const chunk=await reader.read();const raw=decoder.decode(chunk.value,{stream:!chunk.done});onRaw(raw);buffer+=raw;
   let index;while((index=buffer.indexOf('\n'))!==-1){const value=buffer.slice(0,index).replace(/\r$/,'');buffer=buffer.slice(index+1);line(value);if(done)break;}
   if(buffer.length>2_000_000)throw streamError('模型流式数据包超出大小限制');
   if(chunk.done){if(buffer)line(buffer.replace(/\r$/,''));dispatch();break;}
  }
  const valid=protocol==='responses'?finish==='completed':protocol==='anthropic'?done&&['end_turn','stop_sequence'].includes(finish):finish==='stop';
  if(!valid)throw streamError('模型流式回复中断或未正常结束，已保留原文',String(finish||'missing finish_reason'));
  return content;
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

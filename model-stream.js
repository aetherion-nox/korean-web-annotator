import {literalOriginOption} from './experimental-options.js';
// Protocol-specific SSE envelopes share one byte/framing reader. Reasoning is
// retained only in the opt-in log, never parsed as dictionary choices.
function streamError(message,detail=''){const e=Error(message);e.detail=detail;return e;}
// Incrementally locate the root results array, even after other root fields.
function rootResultsLocator(){
 let pos=0,root=false,phase='key',key='',depth=0,inString=false,escaped=false;
 return text=>{
  if(!root){
   const prefix=/^\s*(?:\x60\x60\x60(?:json)?\s*)?\{/i.exec(text);
   if(!prefix)return -1;
   root=true;pos=prefix[0].length;
  }
  while(pos<text.length){
   const ch=text[pos];
   if(phase==='key'){
    if(/\s/.test(ch)||ch===','){pos++;continue;}
    if(ch!=='"')return -1;
    const match=/^"(?:[^"\\]|\\.)*"/.exec(text.slice(pos));
    if(!match)return -1;
    try{key=JSON.parse(match[0]);}catch{return -1;}
    pos+=match[0].length;phase='colon';continue;
   }
   if(phase==='colon'){
    if(/\s/.test(ch)){pos++;continue;}
    if(ch!==':')return -1;
    pos++;phase='value';continue;
   }
   if(phase==='value'){
    if(/\s/.test(ch)){pos++;continue;}
    if(key==='results'&&ch==='[')return pos+1;
    phase='skip';depth=0;inString=false;escaped=false;
   }
   if(inString){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inString=false;}
   else if(ch==='"')inString=true;
   else if(ch==='{'||ch==='[')depth++;
   else if(ch===']'||ch==='}'){if(depth===0)return -1;depth--;}
   else if(ch===','&&depth===0)phase='key';
   pos++;
  }
  return -1;
 };
}
export function choicePreviewParser(targets,onPreview,resolveExtra=()=>null,config={}){
 const known=new Map(targets.map(t=>[t.target_id,t]));
 const choiceIndex=config.choiceIndex||{};
 let text='',position=0,array=false,closed=false,start=-1,depth=0,string=false,escape=false;
 const rows=[],locateResults=rootResultsLocator();
 return chunk=>{
  if(closed)return;
  text+=chunk;
  if(!array){const offset=locateResults(text);if(offset<0)return;position=offset;array=true;}
  let changed=false;
  for(;position<text.length;position++){
   const ch=text[position];
   if(string){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch==='"')string=false;continue;}
   if(ch==='"'){string=true;continue;}
   if(ch==='{'){if(depth===0)start=position;depth++;}
   else if(ch==='}'&&depth){depth--;if(depth===0){
    let row;try{row=JSON.parse(text.slice(start,position+1));}catch{}
    // Malformed rows are skipped; only complete well-formed t/c rows
    // participate in duplicate detection in the final reviewer and preview.
    if(row&&typeof row==='object'&&!Array.isArray(row)&&
       Object.keys(row).sort().join(',')==='c,t'&&
       typeof row.t==='string'&&known.has(row.t)&&
       (row.c===null||typeof row.c==='string'&&row.c.trim().length>0)){
     rows.push(row);changed=true;
    }
   }}else if(ch===']'&&depth===0){closed=true;break;}
  }
  if(changed){
   const unique=new Map(),ambiguous=new Set();
   for(const row of rows){
    const existing=unique.get(row.t);
    if(existing&&existing.c!==row.c)ambiguous.add(row.t);
    else if(!existing)unique.set(row.t,row);
   }
   const accepted=[...unique.values()].filter(row=>!ambiguous.has(row.t)).flatMap(row=>{
   const target=known.get(row.t);
   const pooledKeys=typeof row.c==='string'&&/^p\d+$/u.test(row.c)?
     (choiceIndex[row.t]?.[row.c]||[]):[];
   const selected=pooledKeys.length===1?
     target?.options.find(o=>o.choice_id===pooledKeys[0]):
     (target&&choiceIndex.__noOpPoolIds?.includes(row.c)?
       target.options.find(o=>o.type==='keep'):
       target?.dictionary_person_name===true&&target?.verified_person_hanja?.includes(row.c)?
         target.options.find(o=>o.type==='hanja'&&o.replacement===row.c):null);
   // A preview must not fabricate a KEEP decision from a malformed or
   // unrecognized c field: the final validator will retry it in strict mode.
   const exactHangulEcho=typeof row.c==='string'&&row.c===target?.surface&&
     /^[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7a3\ud7b0-\ud7ff]+$/u.test(row.c);
   const explicitNull=row.c===null||typeof row.c==='string'&&row.c.toLowerCase()==='null'||exactHangulEcho;
   const option=(explicitNull?target?.options.find(o=>o.type==='keep'):null)||
     selected||resolveExtra(target,row.c)||null;
   // Preview and final application must agree; an invalid origin is a
   // no-conversion result, never a speculative annotation.
   return option&&!target.scan_only?[{target,option}]:[];
  });onPreview(accepted);}
 };
}
// A literal etymology uses the same results[] streaming path as an existing
// choice_id. Validate each *complete* row locally before provisional display.
export function experimentalChoicePreviewParser(targets,config,onPreview){
 return choicePreviewParser(targets,onPreview,(target,id)=>literalOriginOption(target,id,config),config);
}

export async function readModelContent(response,{protocol='chat',signal,onStarted=()=>{},onDelta=()=>{},onRaw=()=>{},onMetadata=()=>{},maxContentChars=2_000_000}={}){
 const contentCap=Number.isSafeInteger(maxContentChars)?Math.min(16_000_000,Math.max(2_000_000,maxContentChars)):2_000_000;
 const contentType=response.headers.get('content-type')?.toLowerCase() || '';
 const ndjson=protocol==='ollama'&&contentType.includes('ndjson');
 if(!ndjson&&!contentType.includes('text/event-stream')){
  const raw=await response.text();onRaw(raw);
  let data;try{data=JSON.parse(raw);}catch{throw streamError('模型响应不是有效 JSON',raw);}
  onMetadata(data);
  if(data.error)throw streamError('模型返回 API 错误',JSON.stringify(data.error));
  if(protocol==='lmstudio')return (data.output||[]).filter(item=>item.type==='message').map(item=>item.content).join('');
  if(protocol==='responses'){
   if(data.status!=='completed')throw streamError('模型回复未正常结束',String(data.status));
   return (data.output||[]).filter(i=>i.type==='message').flatMap(i=>i.content||[]).filter(b=>b.type==='output_text').map(b=>b.text).join('');
  }
  if(protocol==='anthropic'){
   if(!['end_turn','stop_sequence'].includes(data.stop_reason))throw streamError('模型回复未正常结束',String(data.stop_reason));
   return (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
  }
  if(protocol==='ollama'){
   if(data.done!==true || ![undefined,'stop'].includes(data.done_reason))throw streamError('Ollama 回复未正常结束',String(data.done_reason));
   return data.message?.content;
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
  if(event.error||event.type==='error'){const error=streamError('模型返回流式 API 错误',JSON.stringify(event.error||event));error.discardPartial=true;throw error;}
  if(!started){started=true;onStarted();}
  if(protocol==='lmstudio'){
   if(event.type==='message.delta')append(event.content);
   if(event.type==='chat.end')done=true;
  }else if(protocol==='ollama'){
   append(event.message?.content);
   if(event.done){done=true;finish=event.done_reason||'stop';onMetadata(event);}
  }else if(protocol==='responses'){
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
   const choice=event.choices?.find(c=>c.index===0)??(event.choices?.length===1&&event.choices[0]?.index==null?event.choices[0]:undefined);if(choice){append(choice.delta?.content);if(choice.finish_reason)finish=choice.finish_reason;}
   if(event.usage||event.id||event.provider)onMetadata(event);
  }
 }
 function line(value){if(ndjson){if(value.trim()){lines=[value];dispatch();}return;}if(value===''){dispatch();return;}if(value.startsWith('data:'))lines.push(value.slice(5).replace(/^ /,''));}
 try{
  while(!done){
   signal?.throwIfAborted();const chunk=await reader.read();const raw=decoder.decode(chunk.value,{stream:!chunk.done});onRaw(raw);buffer+=raw;
   let index;while((index=buffer.indexOf('\n'))!==-1){const value=buffer.slice(0,index).replace(/\r$/,'');buffer=buffer.slice(index+1);line(value);if(done)break;}
   if(buffer.length>2_000_000)throw streamError('模型流式数据包超出大小限制');
   if(chunk.done){if(buffer)line(buffer.replace(/\r$/,''));dispatch();break;}
  }
  const valid=protocol==='lmstudio'?done:protocol==='responses'?finish==='completed':protocol==='anthropic'?done&&['end_turn','stop_sequence'].includes(finish):finish==='stop';
  if(!valid){
   const error=streamError('模型流式回复中断或未正常结束，已保留原文',String(finish||'missing finish_reason'));
   // Only truncation or a lost transport may salvage complete rows. Explicit
   // refusal/moderation/tool termination must roll back provisional results.
   if(finish&&!['length','max_tokens'].includes(finish))error.discardPartial=true;
   throw error;
  }
  return content;
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

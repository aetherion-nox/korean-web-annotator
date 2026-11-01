// All credentials are removed before a record crosses the storage boundary.
export const LOG_KEY='kraModelRequestLogsV1';
export const LOG_ENABLED_KEY='requestLoggingEnabled';
export const MAX_LOG_BYTES=10*1024*1024;
const MAX_RECORD_BYTES=2*1024*1024,MAX_RECORDS=50;
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const secretField=/^(?:authorization|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|token|password|secret|engineToken)$/i;
export function sanitizeLog(value,secrets=[]){
 const redact=text=>{
  for(const secret of secrets.filter(Boolean))for(const variant of new Set([secret,encodeURIComponent(secret),JSON.stringify(secret).slice(1,-1)]))text=text.split(variant).join('[REDACTED]');
  return text.replace(/Bearer\s+[^\s"'<>]+/gi,'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]+/g,'[REDACTED]');
 };
 function visit(item,key=''){
  if(secretField.test(key))return '[REDACTED]';
  if(typeof item==='string'){
   let text=redact(item);
   if(['endpoint','url'].includes(key))try{const url=new URL(text);url.username='';url.password='';for(const name of [...url.searchParams.keys()])if(secretField.test(name))url.searchParams.set(name,'[REDACTED]');text=url.href;}catch{}
   return text;
  }
  if(Array.isArray(item))return item.map(v=>visit(v));
  if(item&&typeof item==='object')return Object.fromEntries(Object.entries(item).map(([k,v])=>[k,visit(v,k)]));
  return item;
 }
 return visit(value);
}
function bound(record){
 if(bytes(record)<=MAX_RECORD_BYTES)return record;
 const trim=value=>typeof value==='string'?(value.length>100000?value.slice(0,100000)+'\n[TRUNCATED]':value):Array.isArray(value)?value.map(trim):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,trim(v)])):value;
 const result={...trim(record),truncated:true};
 if(bytes(result)<=MAX_RECORD_BYTES)return result;
 return {id:record.id,state:record.state,startedAt:record.startedAt,finishedAt:record.finishedAt,elapsedMs:record.elapsedMs,model:record.model,endpoint:record.endpoint,status:record.status,truncated:true,summary:JSON.stringify(result).slice(0,350000)};
}
export function createRequestLogger(storage){
 let queue=Promise.resolve();
 const serial=(fn,quiet=true)=>{const next=queue.then(fn);queue=next.catch(()=>null);return quiet?queue:next;};
 async function save(rows){while(rows.length>MAX_RECORDS||bytes(rows)>MAX_LOG_BYTES)rows.shift();await storage.set({[LOG_KEY]:rows});}
 return {
  start(record,secrets=[]){return serial(async()=>{
   if(!storage||(await storage.get(LOG_ENABLED_KEY))[LOG_ENABLED_KEY]!==true)return null;
   const id=globalThis.crypto.randomUUID();const row=bound(sanitizeLog({...record,id,state:'started'},secrets));
   const saved=(await storage.get(LOG_KEY))[LOG_KEY];await save([...(Array.isArray(saved)?saved:[]),row]);return id;
  });},
  finish(id,record,secrets=[]){return serial(async()=>{
   if(!id||!storage||(await storage.get(LOG_ENABLED_KEY))[LOG_ENABLED_KEY]!==true)return;
   const saved=(await storage.get(LOG_KEY))[LOG_KEY],rows=Array.isArray(saved)?saved:[];const index=rows.findIndex(row=>row.id===id);if(index===-1)return;
   rows[index]=bound(sanitizeLog({...rows[index],...record,id,state:record.error?'error':'completed'},secrets));await save(rows);
  });},
  clear(){return serial(async()=>{await storage.set({[LOG_KEY]:[]});},false);}
 };
}
export const requestLogger=createRequestLogger(globalThis.chrome?.storage?.local);

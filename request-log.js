// All credentials are removed before a record crosses the storage boundary.
export const LOG_KEY='kraModelRequestLogsV1';
// Last three untruncated exchanges; the 50-row summary stays size-bounded.
export const LOG_FULL_KEY='kraModelRequestFullV1';
export const FULL_RECORD_LIMIT=50;
export const LOG_FULL_INDEX_KEY='kraModelRequestFullIndexV2';
export const LOG_FULL_LIMIT_KEY='kraModelRequestFullLimitV2';
export const LOG_FULL_RECORD_PREFIX='kraModelRequestFullEntryV2:';
export const MAX_FULL_RECORD_LIMIT=500;
export const fullLogStorageKey=id=>LOG_FULL_RECORD_PREFIX+id;
export const normalizeFullLogLimit=value=>Number.isSafeInteger(Number(value))&&Number(value)>=1&&Number(value)<=MAX_FULL_RECORD_LIMIT?Number(value):FULL_RECORD_LIMIT;
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

// The unbounded-bytes full exchange is stored under ONE KEY PER REQUEST.
// Writing a single 7 MiB answer must never rewrite the preceding 49 full
// responses. A small index provides order, status, and per-row deletion.
const metadataOf=record=>({
 id:record.id,startedAt:record.startedAt,finishedAt:record.finishedAt,
 model:record.model,provider:record.provider,operationId:record.operationId,
 attempt:record.attempt,state:record.state,stream:record.stream,
 status:record.status,targets:record.payloadStats?.targets
});
export function createRequestLogger(storage){
 let queue=Promise.resolve();
 const serial=(fn,quiet=true)=>{
  const next=queue.then(fn);queue=next.catch(()=>null);
  return quiet?queue:next;
 };
 const removeKeys=async keys=>{
  if(!keys.length)return;
  if(typeof storage.remove==='function')await storage.remove(keys);
  else await storage.set(Object.fromEntries(keys.map(key=>[key,null])));
 };
 async function logLimit(){
  const data=await storage.get(LOG_FULL_LIMIT_KEY);
  return normalizeFullLogLimit(data[LOG_FULL_LIMIT_KEY]);
 }
 async function saveSummary(rows){
  while(rows.length>MAX_RECORDS||bytes(rows)>MAX_LOG_BYTES)rows.shift();
  await storage.set({[LOG_KEY]:rows});
 }
 async function readIndex(){
  const data=await storage.get([LOG_FULL_INDEX_KEY,LOG_FULL_KEY]);
  if(Array.isArray(data[LOG_FULL_INDEX_KEY]))return data[LOG_FULL_INDEX_KEY];
  // One-time, lossless migration of the older last-three complete records.
  const legacy=Array.isArray(data[LOG_FULL_KEY])?data[LOG_FULL_KEY].filter(row=>typeof row?.id==='string'):[];
  const index=[];
  for(const record of legacy){
   await storage.set({[fullLogStorageKey(record.id)]:record});
   index.push(metadataOf(record));
  }
  await storage.set({[LOG_FULL_INDEX_KEY]:index,[LOG_FULL_KEY]:[]});
  return index;
 }
 async function retain(index,limit){
  const excess=Math.max(0,index.length-limit);
  if(excess){
   await removeKeys(index.slice(0,excess).map(row=>fullLogStorageKey(row.id)));
   index=index.slice(excess);
  }
  await storage.set({[LOG_FULL_INDEX_KEY]:index});
  return index;
 }
 return {
  start(record,secrets=[]){return serial(async()=>{
   if(!storage||(await storage.get(LOG_ENABLED_KEY))[LOG_ENABLED_KEY]!==true)return null;
   const id=globalThis.crypto.randomUUID();
   const full=sanitizeLog({...record,id,state:'started'},secrets);
   const index=await readIndex();
   await storage.set({[fullLogStorageKey(id)]:full});
   await retain([...index,metadataOf(full)],await logLimit());
   const saved=await storage.get(LOG_KEY);
   await saveSummary([...(Array.isArray(saved[LOG_KEY])?saved[LOG_KEY]:[]),bound(full)]);
   return id;
  });},
  finish(id,record,secrets=[]){return serial(async()=>{
   if(!id||!storage||(await storage.get(LOG_ENABLED_KEY))[LOG_ENABLED_KEY]!==true)return;
   const index=await readIndex(),i=index.findIndex(row=>row.id===id);
   if(i<0)return; // Deleted or evicted records stay deleted.
   const key=fullLogStorageKey(id);
   const data=await storage.get([key,LOG_KEY]);
   if(!data[key])return;
   const sanitized=sanitizeLog(record,secrets);
   const full={...data[key],...sanitized,id,state:record.error?'error':'completed'};
   await storage.set({[key]:full});
   index[i]=metadataOf(full);
   await storage.set({[LOG_FULL_INDEX_KEY]:index});
   const rows=Array.isArray(data[LOG_KEY])?data[LOG_KEY]:[];
   const summaryIndex=rows.findIndex(row=>row.id===id);
   if(summaryIndex>=0){
    rows[summaryIndex]=bound({...rows[summaryIndex],...sanitized,id,state:full.state});
    await saveSummary(rows);
   }
  });},
  list(){return serial(async()=>({records:await readIndex(),limit:await logLimit()}),false);},
  getFull(id){return serial(async()=>{
   if(typeof id!=='string'||!id)return null;
   if(!(await readIndex()).some(row=>row.id===id))return null;
   const key=fullLogStorageKey(id);
   return (await storage.get(key))[key]||null;
  },false);},
  remove(id){return serial(async()=>{
   if(typeof id!=='string'||!id)return false;
   const index=await readIndex();
   if(!index.some(row=>row.id===id))return false;
   await removeKeys([fullLogStorageKey(id)]);
   await storage.set({[LOG_FULL_INDEX_KEY]:index.filter(row=>row.id!==id)});
   const saved=await storage.get(LOG_KEY);
   await saveSummary((Array.isArray(saved[LOG_KEY])?saved[LOG_KEY]:[]).filter(row=>row.id!==id));
   return true;
  },false);},
  setLimit(value){return serial(async()=>{
   const n=Number(value);
   if(!Number.isSafeInteger(n)||n<1||n>MAX_FULL_RECORD_LIMIT)throw Error('日志保存条数必须是 1～500 的整数。');
   await storage.set({[LOG_FULL_LIMIT_KEY]:n});
   await retain(await readIndex(),n);
   return n;
  },false);},
  clear(){return serial(async()=>{
   const index=await readIndex();
   await removeKeys(index.map(row=>fullLogStorageKey(row.id)));
   await storage.set({[LOG_KEY]:[],[LOG_FULL_INDEX_KEY]:[],[LOG_FULL_KEY]:[]});
  },false);}
 };
}
export const requestLogger=createRequestLogger(globalThis.chrome?.storage?.local);

import {storage} from './browser-storage.js';
import {copyPlainText} from './clipboard.js';
let worker,hydrated=false,dictionaryAvailable=false,preloaded=false,number=0,pendingImports=0;const pending=new Map();let queue=Promise.resolve();
function resetWorker(){worker?.terminate();worker=null;hydrated=false;dictionaryAvailable=false;preloaded=false;for(const pair of pending.values())pair.reject(Error('Browser worker reset'));pending.clear();}
function getWorker(){
 if(worker)return worker;hydrated=false;worker=new Worker(new URL('./browser-worker.js',import.meta.url),{type:'module'});
 worker.onmessage=({data})=>{const pair=pending.get(data.id);if(!pair)return;if(data.progress){if(pair.progressId)reportProgress(pair.progressId,data.progress);return;}pending.delete(data.id);if(data.ok)pair.resolve(data.result);else pair.reject(Error(data.error));};
 worker.onerror=event=>{for(const pair of pending.values())pair.reject(Error(event.message||'Browser worker failed'));pending.clear();resetWorker();};return worker;
}
function work(request,transfer=[]){return new Promise((resolve,reject)=>{const id=++number;pending.set(id,{resolve,reject,progressId:request.progressId});try{getWorker().postMessage({id,request},transfer);}catch(error){pending.delete(id);reject(error);}});}
function reportProgress(progressId,progress){chrome.runtime.sendMessage({type:'BROWSER_ENGINE_PROGRESS',progressId,progress}).catch(()=>{});}
async function dispatch(request){
 if(request.action==='clear'){resetWorker();await storage('delete','dictionary');await storage('delete','dictionary-hash');return {ready:false,dictionary_loaded:false};}
 if(request.action==='warmup'&&pendingImports)return {ready:false,skipped:true,reason:'import-pending'};
 if(request.action==='warmup'&&preloaded)return {ready:true,preloaded:true};
 const missing='当前插件没有已保存的词典。请打开插件设置，选择 ZIP 或电脑预处理的 DB 文件并导入；重新安装插件或更换扩展身份后需要再次导入。';
 if(!hydrated&&request.action!=='import'){if(request.progressId)reportProgress(request.progressId,{stage:'dictionary'});const saved=await storage('get','dictionary');if(!saved&&request.action==='warmup')return {ready:false,skipped:true};if(!saved&&request.action==='analyze')throw Error(missing);const status=await work({action:'status',database:saved,progressId:request.progressId},saved?[saved]:[]);dictionaryAvailable=Boolean(saved&&status.ready);hydrated=true;if(request.action==='status')return status;}
 if(request.action==='warmup'&&!dictionaryAvailable)return {ready:false,skipped:true};
 if(request.action==='analyze'&&!dictionaryAvailable)throw Error(missing);
 if(request.action==='import'){
  preloaded=false;
  if(request.progressId)reportProgress(request.progressId,{stage:'import-read'});
  const upload=await storage('get',request.upload);if(!upload)throw Error('Dictionary upload expired');
  // Do not copy the old multi-hundred-MB database into a fresh worker
  // unless this ZIP actually matches its saved archive fingerprint.
  let sameArchive=false;
  if(upload.kind==='zip'){
   const storedHash=await storage('get','dictionary-hash');
   if(typeof storedHash==='string'&&/^[A-Fa-f0-9]{64}$/.test(storedHash)){
    if(request.progressId)reportProgress(request.progressId,{stage:'import-check'});
    const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',upload.bytes));
    const hash=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
    sameArchive=hash===storedHash.toUpperCase();
   }
  }
  const saved=sameArchive&&!hydrated?await storage('get','dictionary'):undefined;
  const isDatabase=upload.kind==='db';
  const workerRequest={action:isDatabase?'import-db':'import',filename:upload.name,bytes:upload.bytes,progressId:request.progressId,...(saved?{database:saved}:{})};
  // DB files are already validated in the worker by import_database().
  // Keep the ORIGINAL input ArrayBuffer here; copying/transferring a second
  // entire SQLite database back from Pyodide doubles peak memory pressure.
  // The worker receives a structured clone (not a transfer) for DB imports.
  const transferable=isDatabase?[]:[upload.bytes,...(saved?[saved]:[])];
  try{
   const result=await work(workerRequest,transferable);
   if(!result.reused){
    if(request.progressId)reportProgress(request.progressId,{stage:'import-save'});
    const databaseBytes=isDatabase?upload.bytes:result.database;
    if(!databaseBytes||!Number.isSafeInteger(databaseBytes.byteLength)||!databaseBytes.byteLength)throw Error('Imported dictionary is missing SQLite bytes');
    try{await storage('put','dictionary',databaseBytes);}
    catch(error){throw Error('浏览器存储数据库失败（可能是存储配额或内存不足）：'+(error.message||error));}
    if(typeof result.dictionary_fingerprint==='string')await storage('put','dictionary-hash',result.dictionary_fingerprint);
   }
   hydrated=true;dictionaryAvailable=true;delete result.database;
   if(request.progressId)reportProgress(request.progressId,{stage:'import-done',reused:result.reused===true});
   return result;
  }catch(error){resetWorker();throw error;}
 }
 try{const result=await work(request);if(['warmup','analyze'].includes(request.action))preloaded=true;return result;}catch(error){
  if(!['analyze','warmup'].includes(request.action)||!String(error.message).includes('Dictionary database not found'))throw error;
  const saved=await storage('get','dictionary');resetWorker();if(!saved)throw Error(missing);
  const status=await work({action:'status',database:saved},[saved]);
  if(!status.ready)throw Error('已保存的词典无法恢复，请在插件设置重新导入词典。');
  hydrated=true;dictionaryAvailable=true;
  try{return await work(request);}catch(retryError){if(String(retryError.message).includes('Dictionary database not found'))throw Error('词典自动恢复后仍无法读取，请在插件设置重新导入词典。');throw retryError;}
 }

}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message.type==='KRA_OFFSCREEN_COPY_TEXT'){
  if(sender.id!==chrome.runtime.id)return;
  try{copyPlainText(message.text);reply({ok:true});}catch(error){reply({ok:false,error:String(error.message||error)});}return;
 }
 if(message.type!=='BROWSER_ENGINE_WORK')return;if(sender.id!==chrome.runtime.id)return;
 if(message.request?.action==='import')pendingImports++;
 const next=queue.then(()=>dispatch(message.request));queue=next.catch(()=>{});
 next.then(result=>reply({ok:true,result}),error=>reply({ok:false,error:String(error.message||error)})).finally(()=>{if(message.request?.action==='import')pendingImports--;});return true;
});

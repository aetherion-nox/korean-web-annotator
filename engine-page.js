import {storage} from './browser-storage.js';
import {copyPlainText} from './clipboard.js';
let worker,hydrated=false,dictionaryAvailable=false,preloaded=false,number=0;const pending=new Map();let queue=Promise.resolve();
function resetWorker(){worker?.terminate();worker=null;hydrated=false;dictionaryAvailable=false;preloaded=false;for(const pair of pending.values())pair.reject(Error('Browser worker reset'));pending.clear();}
function getWorker(){
 if(worker)return worker;hydrated=false;worker=new Worker(new URL('./browser-worker.js',import.meta.url),{type:'module'});
 worker.onmessage=({data})=>{const pair=pending.get(data.id);if(!pair)return;if(data.progress){if(pair.progressId)reportProgress(pair.progressId,data.progress);return;}pending.delete(data.id);if(data.ok)pair.resolve(data.result);else pair.reject(Error(data.error));};
 const fail=(event,kind)=>{
  const reason=String(event?.message||'').trim();
  const url=event?.filename||'';
  const location=url?('（'+url.split('/').slice(-2).join('/')+(event?.lineno?':'+event.lineno:'')+'）'):'';
  const hint=reason||'浏览器未提供错误原因。请检查扩展详情页的「错误」、确认已完整解压安装包，并关闭旧版插件后重试。';
  const error=Error('KRA_WORKER_FATAL: '+kind+location+'：'+hint);
  for(const pair of pending.values())pair.reject(error);
  pending.clear();resetWorker();
 };
 worker.onerror=event=>fail(event,'模块加载或运行失败');
 worker.onmessageerror=event=>fail(event,'消息传输失败');
 return worker;
}
function work(request,transfer=[]){return new Promise((resolve,reject)=>{const id=++number;pending.set(id,{resolve,reject,progressId:request.progressId});try{getWorker().postMessage({id,request},transfer);}catch(error){pending.delete(id);reject(error);}});}
function reportProgress(progressId,progress){chrome.runtime.sendMessage({type:'BROWSER_ENGINE_PROGRESS',progressId,progress}).catch(()=>{});}
async function dispatch(request){
 if(request.action==='clear'){resetWorker();await storage('delete','dictionary');return {ready:false,dictionary_loaded:false};}
 if(request.action==='warmup'&&preloaded)return {ready:true,preloaded:true};
 const missing='当前插件没有已保存的词典。请打开插件设置，选择 ZIP 或电脑预处理的 DB 文件并导入；重新安装插件或更换扩展身份后需要再次导入。';
 if(!hydrated&&request.action!=='import'){if(request.progressId)reportProgress(request.progressId,{stage:'dictionary'});const saved=await storage('get','dictionary');if(!saved&&request.action==='warmup')return {ready:false,skipped:true};if(!saved&&request.action==='analyze')throw Error(missing);const status=await work({action:'status',database:saved,progressId:request.progressId},saved?[saved]:[]);dictionaryAvailable=Boolean(saved&&status.ready);hydrated=true;if(request.action==='status')return status;}
 if(request.action==='warmup'&&!dictionaryAvailable)return {ready:false,skipped:true};
 if(request.action==='analyze'&&!dictionaryAvailable)throw Error(missing);
 if(request.action==='import'){
  preloaded=false;
  // Import in a fresh worker to release the tokenizer and Python state
  // that may have been preloaded for the previous dictionary.
  resetWorker();
  for(let attempt=0;attempt<2;attempt++){
   // Re-read from IndexedDB: postMessage transfers and detaches the buffer.
   const upload=await storage('get',request.upload);
   if(!upload)throw Error('Dictionary upload expired');
   try{
    const result=await work({action:upload.kind==='db'?'import-db':'import',filename:upload.name,bytes:upload.bytes},[upload.bytes]);
    await storage('put','dictionary',result.database);
    hydrated=true;dictionaryAvailable=true;delete result.database;return result;
   }catch(error){
    const fatal=String(error.message||error).includes('KRA_WORKER_FATAL:');
    resetWorker();
    if(!fatal||attempt!==0)throw error;
    console.warn('[KRA dictionary import] Worker failed; retrying once with a clean worker:',error);
   }
  }
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
 const next=queue.then(()=>dispatch(message.request));queue=next.catch(()=>{});next.then(result=>reply({ok:true,result}),error=>reply({ok:false,error:String(error.message||error)}));return true;
});

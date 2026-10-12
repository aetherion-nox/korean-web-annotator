import {storage} from './browser-storage.js';
let worker,hydrated=false,dictionaryAvailable=false,number=0;const pending=new Map();let queue=Promise.resolve();
function resetWorker(){worker?.terminate();worker=null;hydrated=false;dictionaryAvailable=false;for(const pair of pending.values())pair.reject(Error('Browser worker reset'));pending.clear();}
function getWorker(){
 if(worker)return worker;hydrated=false;worker=new Worker(new URL('./browser-worker.js',import.meta.url),{type:'module'});
 worker.onmessage=({data})=>{const pair=pending.get(data.id);if(!pair)return;pending.delete(data.id);if(data.ok)pair.resolve(data.result);else pair.reject(Error(data.error));};
 worker.onerror=event=>{for(const pair of pending.values())pair.reject(Error(event.message||'Browser worker failed'));pending.clear();resetWorker();};return worker;
}
function work(request,transfer=[]){return new Promise((resolve,reject)=>{const id=++number;pending.set(id,{resolve,reject});try{getWorker().postMessage({id,request},transfer);}catch(error){pending.delete(id);reject(error);}});}
async function dispatch(request){
 if(request.action==='clear'){resetWorker();await storage('delete','dictionary');return {ready:false,dictionary_loaded:false};}
 const missing='当前插件没有已保存的词典。请打开插件设置，选择 ZIP 或电脑预处理的 DB 文件并导入；重新安装插件或更换扩展身份后需要再次导入。';
 if(!hydrated&&request.action!=='import'){const saved=await storage('get','dictionary');if(!saved&&request.action==='analyze')throw Error(missing);const status=await work({action:'status',database:saved},saved?[saved]:[]);dictionaryAvailable=Boolean(saved&&status.ready);hydrated=true;}
 if(request.action==='analyze'&&!dictionaryAvailable)throw Error(missing);
 if(request.action==='import'){
  const upload=await storage('get',request.upload);if(!upload)throw Error('Dictionary upload expired');
  try{const result=await work({action:upload.kind==='db'?'import-db':'import',filename:upload.name,bytes:upload.bytes},[upload.bytes]);await storage('put','dictionary',result.database);hydrated=true;dictionaryAvailable=true;delete result.database;return result;}catch(error){resetWorker();throw error;}
 }
 try{return await work(request);}catch(error){
  if(request.action!=='analyze'||!String(error.message).includes('Dictionary database not found'))throw error;
  const saved=await storage('get','dictionary');resetWorker();if(!saved)throw Error(missing);
  const status=await work({action:'status',database:saved},[saved]);
  if(!status.ready)throw Error('已保存的词典无法恢复，请在插件设置重新导入词典。');
  hydrated=true;dictionaryAvailable=true;
  try{return await work(request);}catch(retryError){if(String(retryError.message).includes('Dictionary database not found'))throw Error('词典自动恢复后仍无法读取，请在插件设置重新导入词典。');throw retryError;}
 }

}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message.type!=='BROWSER_ENGINE_WORK')return;if(sender.id!==chrome.runtime.id)return;
 const next=queue.then(()=>dispatch(message.request));queue=next.catch(()=>{});next.then(result=>reply({ok:true,result}),error=>reply({ok:false,error:String(error.message||error)}));return true;
});

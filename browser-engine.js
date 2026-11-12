import {storage} from './browser-storage.js';
// The background cannot send runtime messages back to its own context.
let backgroundHost;
export function configureBrowserEngineHost(host){backgroundHost=host;}
async function call(request,signal,onProgress){
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 const progressId=onProgress?crypto.randomUUID():undefined;
 const listener=(message,sender)=>{if(sender.id===chrome.runtime.id&&message.type==='BROWSER_ENGINE_PROGRESS'&&message.progressId===progressId&&!signal?.aborted)onProgress?.(message.progress);};
 if(progressId){request={...request,progressId};chrome.runtime.onMessage.addListener(listener);}
 let reply;try{reply=await (backgroundHost?backgroundHost(request):chrome.runtime.sendMessage({type:'BROWSER_ENGINE_CALL',request}));}finally{if(progressId)chrome.runtime.onMessage.removeListener(listener);}
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 if(!reply?.ok)throw Error(reply?.error||`浏览器引擎请求未收到回复（${request.action}）：后台消息转发失败。请重新加载插件后重试。`);return reply.result;
}
export function warmBrowserEngine(signal,onProgress){return call({action:'warmup'},signal,onProgress);}
export function browserEngineStatus(signal,onProgress,options={}){return call({action:'status',allowNoDictionary:options.allowNoDictionary===true},signal,onProgress);}
export function browserAnalyze(text,modes,signal,onProgress){return call({action:'analyze',text,modes},signal,onProgress);}
export async function importBrowserDictionary(file){
 if(!file)throw Error('请选择官方 JSON ZIP 或预处理词典数据库');
 const kind=/\.(db|sqlite|sqlite3)$/i.test(file.name)?'db':'zip';
 if(kind==='db'&&new TextDecoder().decode(await file.slice(0,16).arrayBuffer())!=='SQLite format 3\0')throw Error('不是有效的 SQLite 词典数据库。请选择电脑导入器生成的 hanja_dict.db。');
 const id=crypto.randomUUID();await storage('put',id,{name:file.name,kind,bytes:await file.arrayBuffer()});
 try{return await call({action:'import',upload:id});}finally{await storage('delete',id);}
}
export function clearBrowserDictionary(){return call({action:'clear'});}

// A key count reads saved state without loading the dictionary or WASM runtime.
export async function readDictionaryInfo(){return {imported:Boolean(await storage('has','dictionary'))};}

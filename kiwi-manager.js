import {storage} from './browser-storage.js';
import {latestMetadata,download,preparePackage} from './kiwi-package.js';
import {createKiwiSandbox,validTokens} from './kiwi-sandbox-client.js';
const STATE='kiwi-runtime-state-v1',PREFIX='kiwi-runtime-package:';
export function createKiwiManager({store=storage,bundled=async()=>{const r=await fetch(new URL('./runtime/assets.json',import.meta.url));return r.json();},latest=latestMetadata,prepare,sandbox=createKiwiSandbox,progress=()=>{}}={}){
 let runtime,busy=false,lastProgress=0;const leases=new Map();
 const read=async()=>await store('get',STATE)||{};
 const report=async(message,loaded=0,total=0)=>{const at=Date.now();if(loaded&&(!total||loaded<total)&&at-lastProgress<300)return;lastProgress=at;try{await progress({message,loaded,total,at});}catch{}};
 function idle(){const now=Date.now();for(const [key,until]of leases)if(until<now)leases.delete(key);if(leases.size)throw Error('标注或手动审核任务仍在进行，请先完成或取消任务再切换 Kiwi。');if(busy)throw Error('Kiwi 正在更新，请等待完成。');}
 function close(){runtime?.client.close();runtime=null;}
 async function status(){
  const state=await read(),base=await bundled();
  const current=state.active?{...state.active,source:'updated'}:{version:base.kiwi_version,modelVersion:base.kiwipiepy_model,source:'builtin'};
  const identity=current.source==='builtin'?`builtin-${current.version}-${current.modelVersion}`:`updated-${current.version}-${current.integrity}-${current.modelIntegrity}`;
  return {current,latest:state.latest,lastError:state.lastError||'',busy,identity};
 }
 async function check(){const data=await latest(),state=await read();await store('put',STATE,{...state,latest:data});return status();}
 async function lease(action,id){
  if(typeof id!=='string'||!id||id.length>150)throw Error('无效的 Kiwi 任务锁。');
  if(action==='unlock')leases.delete(id);
  else{
   if(busy)throw Error('Kiwi 正在更新，请稍后开始标注。');
   const fresh=!leases.has(id);leases.set(id,Date.now()+90000);
   // Recover a missing/broken saved engine before pipeline status captures its
   // identity. A later runtime crash still aborts rather than mixing engines.
   if(fresh)await tokenize('학교');
   if(leases.has(id))leases.set(id,Date.now()+90000);
  }
  return {ok:true};
 }
 async function install(){
  idle();busy=true;let candidateClient,key,activated=false;
  try{
   await report('正在检查最新 Kiwi 引擎和对应模型…');const metadata=await latest();const state=await read();
   if(state.active?.version===metadata.engine.version&&state.active?.modelIntegrity===metadata.model.integrity)return {...await status(),busy:false};
   let candidate;
   if(prepare)candidate=await prepare(metadata);
   else{
    await report('正在下载 Kiwi 引擎…');const engineBytes=await download(metadata.engine.url,(n,t)=>{void report('正在下载 Kiwi 引擎…',n,t);});
    await report('正在下载兼容模型…');const modelBytes=await download(metadata.model.url,(n,t)=>{void report('正在下载兼容模型…',n,t);});
    await report('正在校验并解压更新文件…');candidate=await preparePackage(metadata.engine,engineBytes,metadata.model,modelBytes);
   }
   key=PREFIX+crypto.randomUUID();await store('put',key,candidate);
   await report('正在加载新引擎并检查分词…');candidateClient=sandbox();await candidateClient.load(candidate);
   for(const text of ['학교에 갑니다.','2주 앞','😀 한국어'])validTokens(text,await candidateClient.tokenize(text));
   // Check again immediately before committing; staging never replaces active data.
   if(leases.size)throw Error('标注任务已开始，尚未切换引擎，请稍后重试。');
   const active={key,version:candidate.version,modelVersion:candidate.modelVersion,integrity:candidate.integrity,modelIntegrity:candidate.modelIntegrity,installedAt:Date.now()};
   await store('put',STATE,{...state,active,previous:state.active||null,latest:metadata,lastError:''});activated=true;
   close();runtime={key,client:candidateClient};candidateClient=null;
   if(state.previous?.key&&state.previous.key!==state.active?.key)await store('delete',state.previous.key).catch(()=>{});
   await report(`Kiwi ${active.version} 已启用。`);return {...await status(),busy:false};
  }catch(error){await report('更新失败：'+String(error.message||error));throw error;}
  finally{candidateClient?.close();if(key&&!activated)await store('delete',key).catch(()=>{});busy=false;}
 }
 async function restore(){idle();const state=await read();await store('put',STATE,{...state,previous:state.active||state.previous,active:null,lastError:''});close();await report('已恢复内置 Kiwi 引擎。');return status();}
 async function tokenize(text){
  const state=await read();if(!state.active)return null;
  try{
   if(runtime?.key!==state.active.key){close();const saved=await store('get',state.active.key);if(!saved)throw Error('已下载的引擎文件丢失');const client=sandbox();runtime={key:state.active.key,client};await client.load(saved);}
   return validTokens(text,await runtime.client.tokenize(text));
  }catch(error){
   close();await store('put',STATE,{...state,active:null,previous:state.active,lastError:'新版 Kiwi 运行失败，已恢复内置版：'+String(error.message||error)});
   await report('新版 Kiwi 运行失败，已恢复内置版。');return null;
  }
 }
 return {status,check,install,restore,tokenize,lease};
}

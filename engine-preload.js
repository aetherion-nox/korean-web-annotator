import {readDictionaryInfo,warmBrowserEngine} from './browser-engine.js';
// Initialization is shared by the offscreen worker; no page text or model calls.
export function createEnginePreloader({settings=chrome.storage.local,info=readDictionaryInfo,warm=warmBrowserEngine}={}){
 let pending;
 const enabled=async()=> (await settings.get('preloadEngineOnStartup')).preloadEngineOnStartup!==false;
 function run(){
  if(pending)return pending;
  pending=(async()=>{
   if(!await enabled())return {skipped:true};
   if(!(await info()).imported||!await enabled())return {skipped:true};
   return warm();
  })().finally(()=>{pending=null;});
  return pending;
 }
 return {run};
}

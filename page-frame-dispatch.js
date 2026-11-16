// Pure frame selection/dispatch contract. Chrome permissions and live DOM
// checks are injected by the service worker, so tests can exercise every
// outcome without granting broad third-party host access.
const BLOCKED_SCHEMES=/^(?:chrome|chrome-extension|devtools|view-source|javascript):/i;

export function frameKey(frame){
 if(typeof frame?.documentId==='string'&&frame.documentId)return frame.documentId;
 return String(frame?.frameId)+'|'+String(frame?.url||'');
}
export function frameIsCandidate(frame){
 return Number.isInteger(frame?.frameId)&&frame.frameId>0&&
   !BLOCKED_SCHEMES.test(String(frame.url||''))&&
   !/^about:(?:newtab|config|addons)/i.test(String(frame.url||''));
}
export async function dispatchChildFrameBatch(frames,{
 started=new Set(),ensure,probe,start,concurrency=3,
}={}){
 if(!Array.isArray(frames))throw Error('Frame list required');
 if(typeof ensure!=='function'||typeof probe!=='function'||typeof start!=='function')
   throw Error('Frame dispatch callbacks required');
 const stats={discovered:0,alreadyStarted:0,considered:0,started:0,
   empty:0,inaccessible:0,failed:0,skippedScheme:0};
 const checked=new Set();
 const tasks=[];
 for(const frame of frames){
  if(!frameIsCandidate(frame)){if(frame?.frameId!==0)stats.skippedScheme++;continue;}
  const key=frameKey(frame);
  if(checked.has(key))continue;
  checked.add(key);stats.discovered++;
  if(started.has(key)){stats.alreadyStarted++;continue;}
  tasks.push({frame,key});
 }
 let index=0;
 const failures=[];
 async function worker(){
  while(index<tasks.length){
   const {frame,key}=tasks[index++];
   stats.considered++;
   try{
    const ready=await ensure(frame);
    if(ready===false){stats.inaccessible++;continue;}
    const state=await probe(frame);
    if(!state?.ok||state.eligible!==true){stats.empty++;continue;}
    const result=await start(frame);
    if(!result?.ok){stats.failed++;failures.push({frameId:frame.frameId,reason:String(result?.error||'start rejected').slice(0,180)});continue;}
    // A successfully assessed frame with no remaining Hangul should also be
    // remembered; a later real navigation gets a new documentId and is retried.
    started.add(key);
    if(result.started!==false)stats.started++;
    else stats.empty++;
   }catch(error){
    const reason=String(error?.message||error).slice(0,180);
    if(/permission|access|not allowed|cannot access|host|cannot be scripted/i.test(reason))
      stats.inaccessible++;
    else stats.failed++;
    failures.push({frameId:frame.frameId,reason});
   }
  }
 }
 await Promise.all(Array.from({length:Math.max(1,Math.min(4,Math.floor(concurrency)||1,tasks.length||1))},()=>worker()));
 return {...stats,failures:failures.slice(0,8)};
}

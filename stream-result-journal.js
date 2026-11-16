// Chrome MV3 workers may be evicted between receiving complete API JSON
// and delivering its last result to the page. Checkpoint only validated
// per-frame model RESULTS, never raw SSE fragments, prompts, or API keys.
// Session storage survives service-worker restarts, but not browser restarts.
const PREFIX='kraAnnotationModelResultV1:';
const VALID_ID=/^[A-Za-z0-9_.:-]{1,150}$/;

function owner(part){
 if(!Number.isInteger(part?.tabId)||part.tabId<0||
    !Number.isInteger(part?.frameId)||part.frameId<0||
    typeof part.operationId!=='string'||!VALID_ID.test(part.operationId)||
    typeof part.url!=='string'||!part.url.startsWith('http'))return null;
 return PREFIX+part.tabId+':'+part.frameId+':'+part.operationId+':';
}
export function modelCheckpointWriter(storage,part){
 const prefix=owner(part);
 let sequence=0;
 return {
  async save(event){
   if(!prefix||event?.type!=='RESULTS'||event.source!=='model'||event.provisional===true)
    return false;
   const key=prefix+String(sequence++).padStart(7,'0');
   // Independent keys avoid quadratic rewriting on huge pages.
   const copy={...event,operationId:part.operationId};
   await storage.set({[key]:{url:part.url,event:copy}});
   return true;
  }
 };
}
export async function recoverModelCheckpoints(storage,part){
 const prefix=owner(part);
 if(!prefix)return [];
 const stored=await storage.get(null);
 return Object.keys(stored).filter(key=>key.startsWith(prefix))
  .sort().flatMap(key=>{
   const value=stored[key];
   if(value?.url!==part.url||value.event?.operationId!==part.operationId||
      value.event?.type!=='RESULTS'||value.event?.source!=='model'||
      value.event?.provisional===true||!Array.isArray(value.event.results))
     return [];
   return [value.event];
  });
}
export async function clearModelCheckpoints(storage,part){
 const prefix=owner(part);
 if(!prefix)return 0;
 const stored=await storage.get(null);
 const keys=Object.keys(stored).filter(key=>key.startsWith(prefix));
 if(keys.length)await storage.remove(keys);
 return keys.length;
}

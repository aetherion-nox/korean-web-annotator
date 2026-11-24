// Browser session storage survives service-worker suspension, not browser restart.
export async function prepareCacheSession(storage,key){
 const marker='kraCacheSession';
 if((await storage.session.get(marker))[marker])return;
 const {uiSettings={}}=await storage.local.get('uiSettings');
 if(uiSettings.clearCacheOnExit!==false)await storage.local.remove(key);
 await storage.session.set({[marker]:true});
}
export const CACHE_LIMIT_PER_KIND=1000;
function kind(key){
 if(typeof key!=='string')return 'legacy';
 if(key.startsWith('["paragraph-review-v1",'))return 'model';
 if(key.startsWith('["dictionary-v7-'))return 'local';
 return 'legacy';
}
export function cacheCounts(map){
 const counts={local:0,model:0,legacy:0};
 for(const key of map.keys())counts[kind(key)]++;
 return counts;
}
export function trimAnnotationCache(map,limit=CACHE_LIMIT_PER_KIND){
 const counts=cacheCounts(map);
 for(const key of map.keys()){
  const group=kind(key);
  // Legacy full-page review entries cannot be read by the new cache.
  if(group==='legacy'||counts[group]>limit){map.delete(key);counts[group]--;}
 }
 return counts;
}
export class AnnotationCache extends Map{
 get(key){
  if(!super.has(key))return undefined;
  const value=super.get(key);
  super.delete(key);super.set(key,value);
  return value;
 }
 set(key,value){
  super.delete(key);super.set(key,value);
  return this;
 }
}

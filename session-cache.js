// Browser session storage survives service-worker suspension, not browser restart.
export async function prepareCacheSession(storage,key){
 const marker='kraCacheSession';
 if((await storage.session.get(marker))[marker])return 'existing-session';
 const {uiSettings={}}=await storage.local.get('uiSettings');
 const clear=uiSettings.clearCacheOnExit===true;
 if(clear)await storage.local.remove(key);
 await storage.session.set({[marker]:true});
 return clear?'cleared-on-session-start':'retained-on-session-start';
}
// JSON property order is not a semantic part of a stored candidate.
export function stableCacheStringify(value){
 return JSON.stringify(value,(_key,v)=>{
  if(!v||typeof v!=='object'||Array.isArray(v))return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]]));
 });
}
export function canonicalStoredCacheKey(key){
 if(typeof key!=='string'||!key.startsWith('["paragraph-review-v1",'))return key;
 try{return stableCacheStringify(JSON.parse(key));}catch{return key;}
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

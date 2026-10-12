export async function prepareCacheSession(storage,key){
 const marker='kraCacheSession';
 if((await storage.session.get(marker))[marker])return;
 const {uiSettings={}}=await storage.local.get('uiSettings');
 if(uiSettings.clearCacheOnExit ?? true)await storage.local.remove(key);
 await storage.session.set({[marker]:true});
}

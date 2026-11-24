import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {prepareCacheSession,AnnotationCache,trimAnnotationCache,cacheCounts} from '../session-cache.js';
const key='cache';
function storage(clear){
 const local={uiSettings:{clearCacheOnExit:clear},[key]:[['a',1]]};
 const session={};
 const area=data=>({async get(k){return {[k]:data[k]};},async set(v){Object.assign(data,v);},async remove(k){delete data[k];}});
 return {local:area(local),session:area(session),data:local,marker:session};
}
test('disabled exit cleanup preserves data across browser restart; enabled clears only once per session',async()=>{
 const s=storage(false);
 await prepareCacheSession(s,key);assert.equal(s.data[key].length,1);
 delete s.marker.kraCacheSession;await prepareCacheSession(s,key);assert.equal(s.data[key].length,1);
 s.data.uiSettings.clearCacheOnExit=true;
 await prepareCacheSession(s,key);assert.equal(s.data[key].length,1);
 delete s.marker.kraCacheSession;await prepareCacheSession(s,key);assert.equal(s.data[key],undefined);
 s.data[key]=[['new',2]];await prepareCacheSession(s,key);assert.equal(s.data[key].length,1);
});
test('independent capacities and access-order eviction',()=>{
 const map=new AnnotationCache();
 const local=n=>JSON.stringify(['dictionary-v7-test',n]),model=n=>JSON.stringify(['paragraph-review-v1',n]);
 for(let i=0;i<3;i++){map.set(local(i),i);map.set(model(i),i);}
 map.get(local(0));map.get(model(0));map.set('old-full-context',1);
 trimAnnotationCache(map,2);
 assert.deepEqual(cacheCounts(map),{local:2,model:2,legacy:0});
 assert.ok(map.has(local(0))&&map.has(model(0)));
 assert.ok(!map.has(local(1))&&!map.has(model(1)));
});
test('background settings preserve false, persist before run and isolate old map after clearing',()=>{
 const src=fs.readFileSync(new URL('../service-worker.js',import.meta.url),'utf8');
 const snippet=src.slice(src.indexOf('function sanitizeUiSettings('),src.indexOf('function normalizeUiLocale('));
 const ctx={normalizeUiLocale:x=>x};
 vm.runInNewContext(snippet,ctx);
 assert.equal(ctx.sanitizeUiSettings({}).clearCacheOnExit,true);
 assert.equal(ctx.sanitizeUiSettings({clearCacheOnExit:false}).clearCacheOnExit,false);
 assert.match(src,/await chrome\.storage\.local\.set\(\{uiSettings:\{\.\.\.stored,\.\.\.uiSettings\}\}\);\s*return await startWholePageForTab/);
 assert.match(src,/cache=new AnnotationCache\(\);\s*await serializeCacheStorage/);
 assert.match(src,/if\(map!==cache\)return;/);
});

import test from 'node:test';import assert from 'node:assert/strict';
let createEnginePreloader;try{({createEnginePreloader}=await import('../engine-preload.js'));}catch{}
const tick=()=>new Promise(r=>setImmediate(r));
test('startup preload defaults on, deduplicates overlap, honors disable and skips absent dictionary',async()=>{
 assert.equal(typeof createEnginePreloader,'function');let enabled,imported=true,calls=0,finish;
 const preloader=createEnginePreloader({settings:{get:async()=>({preloadEngineOnStartup:enabled})},info:async()=>({imported}),warm:async()=>{calls++;await new Promise(r=>finish=r);return {ready:true};}});
 const first=preloader.run(),second=preloader.run();await tick();assert.equal(calls,1);finish();await Promise.all([first,second]);
 enabled=false;await preloader.run();assert.equal(calls,1);enabled=true;imported=false;await preloader.run();assert.equal(calls,1);
 imported=true;const later=preloader.run();await tick();assert.equal(calls,2);finish();await later;
});
test('failed preload can retry and turning off while checking dictionary prevents preload',async()=>{
 assert.equal(typeof createEnginePreloader,'function');let enabled=true,calls=0;
 const preloader=createEnginePreloader({settings:{get:async()=>({preloadEngineOnStartup:enabled})},info:async()=>({imported:true}),warm:async()=>{if(++calls===1)throw Error('worker reset');return {ready:true};}});
 await assert.rejects(preloader.run(),/worker reset/);await preloader.run();assert.equal(calls,2);
 const cancelled=createEnginePreloader({settings:{get:async()=>({preloadEngineOnStartup:enabled})},info:async()=>{enabled=false;return {imported:true};},warm:async()=>{calls++;}});await cancelled.run();assert.equal(calls,2);
});
test('background wires browser startup, extension reload and enabling the preference',async()=>{
 const fs=await import('node:fs/promises'),vm=await import('node:vm');const source=await fs.readFile(new URL('../service-worker.js',import.meta.url),'utf8');let installed,startup,changed,calls=0;const preference={preloadEngineOnStartup:false};
 const preloader=createEnginePreloader({settings:{get:async()=>preference},info:async()=>({imported:true}),warm:async()=>{calls++;return {ready:true};}});
 const c={createEnginePreloader:()=>preloader,console,initializeStorageAccess:async()=>{},migrateLegacyApiKeyStorage:async()=>{},ensureContextMenu:async()=>{},initializeExistingWebTabs:async()=>{},loadCache:async()=>{},chrome:{runtime:{onInstalled:{addListener:f=>installed=f},onStartup:{addListener:f=>startup=f}},storage:{onChanged:{addListener:f=>changed=f}}}};
 vm.runInNewContext(source.slice(source.indexOf('const enginePreloader='),source.indexOf('chrome.contextMenus.onClicked')),c);
 vm.runInNewContext(source.slice(source.indexOf('chrome.storage.onChanged.addListener'),source.indexOf('chrome.runtime.onMessage.addListener')),c);
 await tick();assert.equal(calls,0);startup();await tick();assert.equal(calls,0);
 preference.preloadEngineOnStartup=true;changed({preloadEngineOnStartup:{newValue:true}},'local');await tick();assert.equal(calls,1);installed();await tick();assert.equal(calls,2);
});

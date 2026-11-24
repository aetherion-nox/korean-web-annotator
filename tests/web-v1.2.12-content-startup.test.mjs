import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const manifest=JSON.parse(source('manifest.json'));
const pkg=JSON.parse(source('package.json'));
const contentSource=source('content.js');
const popupSource=source('popup.js');
const workerSource=source('service-worker.js');

const contentVersion=contentSource.match(/\bconst VERSION\s*=\s*'([^']+)'/)?.[1];
const popupVersion=popupSource.match(/\bconst CONTENT_SCRIPT_VERSION\s*=\s*'([^']+)'/)?.[1];
const workerVersion=workerSource.match(/\bconst CONTENT_SCRIPT_VERSION\s*=\s*'([^']+)'/)?.[1];

test('web manifest, popup, worker and injected content script agree on one current startup version',()=>{
 assert.equal(manifest.version,'1.1.10');
 assert.equal(pkg.version,manifest.version);
 assert.ok(contentVersion,'content script must have a versioned ping response');
 assert.equal(popupVersion,contentVersion);
 assert.equal(workerVersion,contentVersion);
 assert.ok(contentVersion.startsWith(manifest.version+'-'),
  'build identity must change when extension version changes');
 assert.match(contentSource,/case 'KRA_PING': respond\(\{ ok: true, version: VERSION \}\)/);
 assert.match(contentSource,/__KRA_CONTENT_SCRIPT_VERSION__ !== VERSION\) return false/);
});

function injectHarness(kind,initialVersion){
 const frames=new Map([[0,initialVersion],[2,initialVersion]]);
 const sent=[],injected=[],styles=[];
 const chrome={
  tabs:{sendMessage:async(_tabId,message,options={})=>{
   assert.equal(message.type,'KRA_PING');
   const id=options.frameId??0;
   sent.push({id,type:message.type});
   const version=frames.get(id);
   if(!version)throw Error('Could not establish connection. Receiving end does not exist');
   return {ok:true,version};
  }},
  scripting:{
   insertCSS:async({target,files})=>{
    assert.deepEqual(Array.from(files),['content.css']);
    styles.push(target.frameIds?.[0]??0);
   },
   executeScript:async({target,files})=>{
    assert.deepEqual(Array.from(files),['content.js']);
    const id=target.frameIds?.[0]??0;
    frames.set(id,contentVersion);
    injected.push(id);
   }
  }
 };
 // The snippet is evaluated without the extension's top-level lexical scope;
 // supply the exact declared constant, not an independently guessed value.
 const ctx={chrome,console,Error,Promise,
  CONTENT_SCRIPT_VERSION:kind==='popup'?popupVersion:workerVersion};
 vm.createContext(ctx);
 if(kind==='popup'){
  const start=popupSource.indexOf('async function ensureContentScript(tabId)');
  const end=popupSource.indexOf('\nfunction showError',start);
  assert.ok(start>0&&end>start);
  vm.runInContext(popupSource.slice(start,end)+'\nthis.ensure=ensureContentScript;',ctx);
 }else{
  const start=workerSource.indexOf('function actionablePageAccessError');
  const end=workerSource.indexOf('\nasync function handleSelectionContextMenu',start);
  assert.ok(start>0&&end>start);
  vm.runInContext(workerSource.slice(start,end)+'\nthis.ensure=ensureContentScriptInFrame;',ctx);
 }
 return {ensure:ctx.ensure,frames,sent,injected,styles};
}

for(const kind of ['popup','worker']){
 test(kind+': existing current content script replies to ping without unnecessary reinjection',async()=>{
  const x=injectHarness(kind,contentVersion);
  await x.ensure(77,kind==='worker'?0:undefined);
  assert.deepEqual(x.injected,[]);
  assert.equal(x.sent.length,1);
 });
 test(kind+': stale 1.2.10 content script is replaced and new ping succeeds',async()=>{
  const x=injectHarness(kind,'1.2.10-web-retry-feedback');
  await x.ensure(77,kind==='worker'?2:undefined);
  assert.deepEqual(x.injected,kind==='worker'?[2]:[0]);
  assert.equal(x.sent.length,2);
  assert.equal(x.frames.get(kind==='worker'?2:0),contentVersion);
 });
 test(kind+': missing content script is installed and recognized',async()=>{
  const x=injectHarness(kind,null);
  await x.ensure(77,kind==='worker'?0:undefined);
  assert.deepEqual(x.injected,[0]);
  assert.equal(x.sent.length,2);
  assert.equal(x.frames.get(0),contentVersion);
 });
}

test('content-script version handshake requires two matching components in packaged JavaScript',()=>{
 assert.equal((contentSource.match(/const VERSION = '/g)||[]).length,1);
 assert.equal((popupSource.match(/const CONTENT_SCRIPT_VERSION = '/g)||[]).length,1);
 assert.equal((workerSource.match(/const CONTENT_SCRIPT_VERSION='/g)||[]).length,1);
});

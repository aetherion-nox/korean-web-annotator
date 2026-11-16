import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
const root=new URL('../',import.meta.url);
test('preload initializes tokenizer once and subsequent real analyze reuses it',async()=>{
 let reply,builds=0;const payloads=[],globals=new Map();
 const python={loadPackage:async()=>{},FS:{mkdirTree(){},writeFile(){},analyzePath:()=>({exists:true})},globals:{set:(k,v)=>globals.set(k,v),delete:k=>globals.delete(k)},runPythonAsync:async code=>{if(code.includes('browser_bridge.request')){const payload=JSON.parse(globals.get('browser_payload'));payloads.push(payload);return JSON.stringify({ready:true});}}};
 const source=(await fs.readFile(new URL('browser-worker.js',root),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(root.href));
 const context={URL,Map,Promise,Error,String,JSON,Uint8Array,loadPyodide:async()=>python,fetch:async()=>({json:async()=>({kiwi_version:'fixture',model_files:[]})}),KiwiBuilder:{create:async()=>({version:()=> 'fixture',build:async()=>{builds++;return {tokenize:()=>[]};}})},Match:{all:0},self:{postMessage:e=>{if(e.ok!==undefined)reply(e);}}};vm.runInNewContext(source,context);
 const send=(id,request)=>new Promise(resolve=>{reply=resolve;context.self.onmessage({data:{id,request}});});
 assert.equal((await send(1,{action:'warmup'})).ok,true);assert.equal(builds,1);assert.equal(payloads[0].action,'warmup');assert.equal(payloads.some(p=>p.action==='analyze'),false);
 await send(2,{action:'analyze',text:'학교'});assert.equal(builds,1);
});

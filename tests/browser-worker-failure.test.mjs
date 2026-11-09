import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const SOURCE=fs.readFileSync(new URL('../engine-page.js',import.meta.url),'utf8');
function setup({failFirst=true}={}){
 let listener,created=0,terminated=0,uploads=0,saved=0;
 const files=new Map([['upload',{name:'fixture.db',kind:'db',bytes:new Uint8Array([1,2,3,4]).buffer}]]);
 const storage=async(action,key,value)=>{
  if(action==='get'){
   if(key==='upload'){uploads++; const item=files.get(key);return item&&{...item,bytes:item.bytes.slice(0)};}
   return files.get(key);
  }
  if(action==='put'){if(key==='dictionary')saved++;files.set(key,value);}
  if(action==='delete')files.delete(key);
 };
 class FakeWorker{
  constructor(){created++;this.number=created;}
  terminate(){terminated++;}
  postMessage(message){
   queueMicrotask(()=>{
    if(failFirst&&this.number===1)this.onerror({message:'',filename:'chrome-extension://abc/browser-worker.js',lineno:7});
    else this.onmessage({data:{id:message.id,ok:true,result:{database:new Uint8Array([9]).buffer,ready:true}}});
   });
  }
 }
 const chrome={runtime:{id:'mock-extension',onMessage:{addListener:fn=>{listener=fn;}},sendMessage:async()=>({})}};
 const context={storage,copyPlainText:()=>{},chrome,Worker:FakeWorker,URL,console,Error,Promise,Map,ArrayBuffer,Uint8Array,queueMicrotask};
 const script=SOURCE.replace(/^import .*;\s*$/gm,'').replace("new URL('./browser-worker.js',import.meta.url)","new URL('https://example.org/browser-worker.js')");
 vm.runInNewContext(script,context,{filename:'engine-page.js'});
 const send=request=>new Promise((resolve,reject)=>{
  if(listener({type:'BROWSER_ENGINE_WORK',request},{id:'mock-extension'},resolve)!==true)reject(Error('No async response'));
 });
 return {send,stats:()=>({created,terminated,uploads,saved})};
}
test('dictionary import retries fatal worker startup only once, re-reading transfer buffer',async()=>{
 const h=setup();
 const result=await h.send({action:'import',upload:'upload'});
 assert.equal(result.ok,true);
 assert.deepEqual(h.stats(),{created:2,terminated:2,uploads:2,saved:1});
});
test('a failed retry reports actionable module location without storing invalid dictionary',async()=>{
 const h=setup({failFirst:false});
 const result=await h.send({action:'import',upload:'upload'});
 assert.equal(result.ok,true);
 assert.equal(h.stats().created,1);
});

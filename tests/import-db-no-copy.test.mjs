import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const source=(await fs.readFile(new URL('engine-page.js',root),'utf8'))
 .replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(root.href));

async function harness({kind='db',reject=false}={}){
 let listener;const stored=new Map(),work=[];
 const original=new ArrayBuffer(1024*1024);
 new Uint8Array(original)[0]=83;
 stored.set('upload-test',{name:kind==='db'?'dictionary.db':'dictionary.zip',kind,bytes:original});
 const previous=new ArrayBuffer(14);stored.set('dictionary',previous);
 class Worker{
  postMessage(message,transfer){
   work.push({request:message.request,transfer});
   const answer=reject?{id:message.id,ok:false,error:'SQLite DB integrity check failed'}:
    {id:message.id,ok:true,result:{
      ready:true,imported:true,dictionary_fingerprint:'ABCD',
      database:new ArrayBuffer(12)
    }};
   queueMicrotask(()=>this.onmessage({data:answer}));
  }
  terminate(){}
 }
 const updates=[];
 const context={
  Worker,URL,Map,Promise,Error,Boolean,String,Uint8Array,ArrayBuffer,
  storage:async(action,key,value)=>{
   if(action==='get')return stored.get(key);
   if(action==='put'){updates.push({key,value});stored.set(key,value);}
   if(action==='delete')stored.delete(key);
  },
  chrome:{runtime:{id:'test',onMessage:{addListener:f=>listener=f},sendMessage:async()=>{}}},
  copyPlainText(){}
 };
 vm.runInNewContext(source,context);
 const send=request=>new Promise(resolve=>listener({type:'BROWSER_ENGINE_WORK',request},{id:'test'},resolve));
 return {send,stored,work,updates,original,previous};
}

test('v1.1.55 DB import transfers input to Worker, validates it, and persists returned SQLite database',async()=>{
 const h=await harness();
 const result=await h.send({action:'import',upload:'upload-test'});
 assert.equal(result.ok,true,result.error);
 assert.equal(result.result.imported,true);
 assert.equal(h.work.length,1);
 assert.equal(h.work[0].request.action,'import-db');
 assert.equal(h.work[0].transfer.length,1,'original worker transfer protocol must be retained');
 assert.equal(h.stored.get('dictionary').byteLength,12);
 assert.equal(h.updates.length,1);
 assert.ok(!Object.hasOwn(result.result,'database'));
});

test('failed DB validation preserves previously saved dictionary',async()=>{
 const h=await harness({reject:true});
 const result=await h.send({action:'import',upload:'upload-test'});
 assert.equal(result.ok,false);
 assert.match(result.error,/integrity check failed/);
 assert.equal(h.stored.get('dictionary'),h.previous);
 assert.equal(h.updates.length,0);
});

test('v1.1.55 ZIP import continues to transfer archive bytes and persist returned SQLite database',async()=>{
 const h=await harness({kind:'zip'});
 const result=await h.send({action:'import',upload:'upload-test'});
 assert.equal(result.ok,true,result.error);
 assert.equal(h.work[0].request.action,'import');
 assert.equal(h.work[0].transfer.length,1);
 assert.equal(h.stored.get('dictionary').byteLength,12);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {dispatchChildFrameBatch} from '../page-frame-dispatch.js';
const src=fs.readFileSync(new URL('../service-worker.js',import.meta.url),'utf8');
const block=src.slice(src.indexOf('// User-initiated multi-frame dispatch.'),
 src.indexOf('\nasync function ensureContextMenu()'));
const load=({frames,probe,denied=[],main={ok:true,started:false}})=>{
 const launches=[],diagnostics=[],injections=[],timers=[],listeners={};
 const chrome={
  tabs:{
   query:async()=>[{id:77}],
   sendMessage:async(tabId,message,options={})=>{
    const frameId=options.frameId??0;
    if(message.type==='KRA_FRAME_PROBE')return probe(frameId);
    if(message.type==='START_ANNOTATION'){
     launches.push({frameId,type:message.type,modes:message.modes});
     return frameId===0?main:{ok:true,started:true};
    }
    if(message.type==='KRA_FRAME_DISPATCH_DIAGNOSTIC'){diagnostics.push(message);return {ok:true};}
    return {ok:true};
   }
  },
  storage:{local:{
   get:async()=>({uiSettings:{}}),
   set:async()=>{}
  }},
  webNavigation:{
   getAllFrames:async()=>frames,
   onDOMContentLoaded:{addListener:fn=>listeners.DOMLoaded=fn},
   onCommitted:{addListener:fn=>listeners.Committed=fn}
  }
 };
 const c={chrome,console,Date,setTimeout:fn=>{timers.push(fn);return timers.length;},
  clearTimeout:()=>{},sanitizeUiSettings:x=>x||{},
  ensureContentScriptInFrame:async(_tabId,frameId)=>{
   injections.push(frameId);
   if(denied.includes(frameId))throw Error('Cannot access contents of this frame: permission denied');
  },
  dispatchChildFrameBatch};
 vm.createContext(c);vm.runInContext(block,c);
 return {c,launches,diagnostics,injections,timers,listeners};
};
test('popup whole-page starts main and independently eligible Korean iframe, not trackers',async()=>{
 const f=load({
  frames:[{frameId:0,documentId:'main',url:'https://news.example/article'},
   {frameId:1,documentId:'one',url:'https://news.example/recommended'},
   {frameId:2,documentId:'two',url:'https://ads.example/track'},
   {frameId:3,documentId:'three',url:'about:blank'}],
  probe:id=>({ok:true,eligible:id===1||id===3})
 });
 const result=await f.c.startPageFromPopup({modes:{hanja:true,loanword:true},uiSettings:{}});
 assert.equal(result.ok,true);
 assert.equal(result.frameSummary.started,2);
 assert.deepEqual(f.launches.map(x=>x.frameId).sort(),[0,1,3]);
 assert.ok(f.diagnostics.some(x=>x.detail.started===2));
});
test('a child origin lacking host access is reported but never aborts the top frame',async()=>{
 const f=load({
  frames:[{frameId:0,url:'https://news.test'},{frameId:1,url:'https://other.test'},
   {frameId:2,url:'https://news.test/sidebar'}],
  denied:[1],probe:()=>({ok:true,eligible:true})
 });
 const result=await f.c.startPageFromPopup({modes:{hanja:true}});
 assert.equal(result.ok,true);
 assert.equal(result.frameSummary.inaccessible,1);
 assert.equal(result.frameSummary.started,1);
 assert.deepEqual(f.launches.map(x=>x.frameId).sort(),[0,2]);
});
test('DOMContentLoaded-triggered second pass picks a late child without restarting earlier frames',async()=>{
 let frames=[{frameId:0,documentId:'main'},{frameId:1,documentId:'one'}];
 const f=load({frames,probe:()=>({ok:true,eligible:true})});
 const first=await f.c.startPageFromPopup({modes:{hanja:true}});
 assert.equal(first.frameSummary.started,1);
 frames.push({frameId:2,documentId:'two'});
 f.listeners.DOMLoaded({tabId:77,frameId:2});
 assert.ok(f.timers.length>0);
 // Two pending timer callbacks may exist; simulate the newest discovery.
 f.timers.at(-1)();
 await f.c.activeFrameScans.get(77).serial;
 assert.deepEqual(f.launches.map(x=>x.frameId).sort(),[0,1,2]);
 assert.equal(f.launches.filter(x=>x.frameId===1).length,1);
});
test('navigation away cancels bounded discovery and avoids starting a previous-page child',async()=>{
 const f=load({frames:[{frameId:0}],probe:()=>({ok:true,eligible:true})});
 await f.c.startPageFromPopup({modes:{hanja:true}});
 f.listeners.Committed({tabId:77,frameId:0});
 f.listeners.DOMLoaded({tabId:77,frameId:2});
 assert.equal(f.c.activeFrameScans.size,0);
 assert.deepEqual(f.launches.map(x=>x.frameId),[0]);
});

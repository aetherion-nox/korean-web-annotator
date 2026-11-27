import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {dispatchChildFrameBatch} from '../page-frame-dispatch.js';
import {FRAME_COLLECTION_MAX_MS,FRAME_NAVIGATION_DEBOUNCE_MS,nextFrameCollectionDelay} from '../page-frame-collection.js';
import {createMergedFrameReviewCoordinator} from '../merged-frame-review.js';
const src=fs.readFileSync(new URL('../service-worker.js',import.meta.url),'utf8');
const block=src.slice(src.indexOf('// User-initiated multi-frame dispatch.'),
 src.indexOf('\nasync function ensureContextMenu()'));
const toolbarHandler=src.slice(src.indexOf("  if(message?.type==='KRA_START_PAGE_FROM_TOOLBAR')"),
 src.indexOf("  if(message?.type==='KRA_CONTEXT_UPDATE')"));
const load=({frames,probe,session={},local={},denied=[],main={ok:true,started:false}})=>{
 const launches=[],diagnostics=[],injections=[],timers=[],listeners={},merged=[];
 const chrome={
  tabs:{
   query:async()=>[{id:77}],
   sendMessage:async(tabId,message,options={})=>{
    const frameId=options.frameId??0;
    if(message.type==='KRA_FRAME_PROBE')return probe(frameId,message.forceRegenerate);
    if(message.type==='START_ANNOTATION'){
     launches.push({frameId,type:message.type,modes:message.modes,
       mergeGroupId:message.mergeGroupId,mergeHost:message.mergeHost,forceRegenerate:message.forceRegenerate});
     return frameId===0?main:{ok:true,started:true};
    }
    if(message.type==='KRA_FRAME_DISPATCH_DIAGNOSTIC'){diagnostics.push(message);return {ok:true};}
    return {ok:true};
   }
  },
  runtime:{id:'annotator'},
  storage:{
   session:{get:async key=>({[key]:session[key]})},
   local:{get:async key=>({uiSettings:{},[key]:local[key]}),set:async()=>{}}
  },
  webNavigation:{
   getAllFrames:async()=>frames,
   onDOMContentLoaded:{addListener:fn=>listeners.DOMLoaded=fn},
   onCommitted:{addListener:fn=>listeners.Committed=fn}
  }
 };
 const c={chrome,console,Date,crypto:{randomUUID:()=>String(Math.random()).slice(2)},
  setTimeout:fn=>{timers.push(fn);return timers.length;},
  clearTimeout:()=>{},sanitizeUiSettings:x=>x||{},
  createMergedFrameReviewCoordinator,
  runStreamingAnnotation:async message=>{merged.push(message);},
  createManualReviewSession:()=>({submit:()=>true}),
  ensureContentScriptInFrame:async(_tabId,frameId)=>{
   injections.push(frameId);
   if(denied.includes(frameId))throw Error('Cannot access contents of this frame: permission denied');
  },
  dispatchChildFrameBatch,FRAME_COLLECTION_MAX_MS,FRAME_NAVIGATION_DEBOUNCE_MS,nextFrameCollectionDelay};
 vm.createContext(c);vm.runInContext(block,c);
 vm.runInContext('function toolbarMessage(message,sender,sendResponse){'+toolbarHandler+'}',c);
 const toolbar=(message={})=>new Promise(resolve=>c.toolbarMessage(
  {type:'KRA_START_PAGE_FROM_TOOLBAR',...message},{id:'annotator',frameId:0,tab:{id:77}},resolve));
 return {c,launches,diagnostics,injections,timers,listeners,merged,toolbar};
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
 assert.equal(new Set(f.launches.map(x=>x.mergeGroupId)).size,1);
 assert.equal(f.launches.filter(x=>x.mergeHost).length,1);
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
 // The newest timer represents a frame-discovery debounce.
 f.timers.at(-1)();
 await vm.runInContext('activeFrameScans.get(77).serial',f.c);
 assert.deepEqual(f.launches.map(x=>x.frameId).sort(),[0,1,2]);
 assert.equal(f.launches.filter(x=>x.frameId===1).length,1);
 const groupId=f.launches[0].mergeGroupId;
 assert.equal(vm.runInContext('mergedFrameReviews.state('+JSON.stringify(groupId)+')?.joined',f.c),0,
   'the test simulates frame starts, not connected stream Ports');
});
test('navigation away cancels bounded discovery and avoids starting a previous-page child',async()=>{
 const f=load({frames:[{frameId:0}],probe:()=>({ok:true,eligible:true})});
 await f.c.startPageFromPopup({modes:{hanja:true}});
 f.listeners.Committed({tabId:77,frameId:0});
 f.listeners.DOMLoaded({tabId:77,frameId:2});
 assert.equal(vm.runInContext('activeFrameScans.size',f.c),0);
 assert.deepEqual(f.launches.map(x=>x.frameId),[0]);
});

test('toolbar applies session and persistent bypass to existing Korean annotations in child frames',async()=>{
 const session={},local={};
 const f=load({frames:[{frameId:0},{frameId:1}],session,local,
  probe:(_id,force)=>({ok:true,eligible:force})});
 assert.equal((await f.toolbar()).frameSummary.started,0);
 session.sessionForceRegenerate=true;
 assert.equal((await f.toolbar()).frameSummary.started,1);
 assert.deepEqual(f.launches.slice(-2).map(x=>x.forceRegenerate),[true,true]);
 delete session.sessionForceRegenerate;
 local.persistentForceRegenerate=true;
 assert.equal((await f.toolbar()).frameSummary.started,1);
 assert.deepEqual(f.launches.slice(-2).map(x=>x.forceRegenerate),[true,true]);
 assert.equal((await f.toolbar({autoResume:true})).frameSummary.started,0);
 assert.equal(f.launches.at(-1).forceRegenerate,false);
});

test('merged analysis keeps the bypass decision used for scanning, independent of frame messages',async()=>{
 const session={sessionForceRegenerate:true};
 const f=load({frames:[{frameId:0},{frameId:1}],session,
  probe:(_id,force)=>({ok:true,eligible:force})});
 assert.equal((await f.toolbar()).frameSummary.started,1);
 delete session.sessionForceRegenerate;
 const coordinator=vm.runInContext('mergedFrameReviews',f.c);
 const groupId=f.launches[0].mergeGroupId;
 // The forced task can finish collection after the user turns off the setting.
 coordinator.join(groupId,{tabId:77,frameId:1,operationId:'child',port:{postMessage(){}},
  message:{modes:{hanja:true,loanword:true},sentences:[{id:'p0',text:'한국어'}],forceRegenerate:false}});
 await coordinator.finalize(groupId);
 assert.equal(f.merged[0].forceRegenerate,true);
});

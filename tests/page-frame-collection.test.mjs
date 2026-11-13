import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
 FRAME_COLLECTION_MAX_MS,FRAME_COLLECTION_SINGLE_QUIET_MS,
 FRAME_COLLECTION_MULTI_QUIET_MS,FRAME_NAVIGATION_DEBOUNCE_MS,
 nextFrameCollectionDelay
} from '../page-frame-collection.js';
import {dispatchChildFrameBatch} from '../page-frame-dispatch.js';

test('warm single-frame page does not wait the former fixed 4.8 seconds',()=>{
 assert.equal(FRAME_COLLECTION_MAX_MS,4800);
 assert.equal(nextFrameCollectionDelay({deadline:5800,now:1000,discovered:0}),FRAME_COLLECTION_SINGLE_QUIET_MS);
 assert.ok(FRAME_COLLECTION_SINGLE_QUIET_MS<500);
});

test('already visible child frames get a short quiet window rather than the entire cap',()=>{
 assert.equal(nextFrameCollectionDelay({deadline:5800,now:1000,discovered:3}),FRAME_COLLECTION_MULTI_QUIET_MS);
 assert.ok(FRAME_COLLECTION_MULTI_QUIET_MS<1200);
});

test('recent child navigation extends the settling interval, with a 4.8 second hard limit',()=>{
 assert.equal(nextFrameCollectionDelay({
   deadline:5800,now:1350,discovered:0,lastEventAt:1300
 }),FRAME_COLLECTION_MULTI_QUIET_MS-50);
 assert.equal(nextFrameCollectionDelay({
   deadline:5800,now:5700,discovered:5,lastEventAt:5680
 }),100);
 assert.equal(nextFrameCollectionDelay({
   deadline:5800,now:5900,discovered:0,lastEventAt:5880
 }),0);
});

test('unavailable frame inventory retains the original full safe wait',()=>{
 assert.equal(nextFrameCollectionDelay({
   deadline:5800,now:1100,unavailable:true
 }),4700);
});

function fixture(initialFrames=[{frameId:0,url:'https://fixture.test/a',documentId:'main'}]){
 const source=fs.readFileSync(new URL('../service-worker.js',import.meta.url),'utf8');
 const start=source.indexOf('function scheduleFrameCollectionFinalization(');
 const end=source.indexOf('async function startPageFromPopup(',start);
 assert.ok(start>0&&end>start);
 const callbacks={},timers=new Map(),runs=[],starts=[],clock={now:1000};
 let nextId=0,frames=initialFrames;
 const config={
  getAllFrames:async()=>frames,
  onDOMContentLoaded:{addListener:cb=>callbacks.loaded=cb},
  onCommitted:{addListener:cb=>callbacks.committed=cb}
 };
 const activeFrameScans=new Map();
 const coordinator={
  open:(id,tabId)=>runs.push({type:'open',id,tabId}),
  finalize:id=>{runs.push({type:'finalize',id});return Promise.resolve();},
  abort:(id,message)=>{runs.push({type:'abort',id,message});}
 };
 const chrome={webNavigation:config,tabs:{
  sendMessage:async(tabId,message,{frameId}={})=>{
   if(message.type==='START_ANNOTATION'){
    starts.push({frameId,group:message.mergeGroupId,host:message.mergeHost});
    return {ok:true,started:true};
   }
   if(message.type==='KRA_FRAME_PROBE')return {ok:true,eligible:true};
   return {ok:true};
  }
 }};
 const ctx={
  activeFrameScans,FRAME_DISCOVERY_GRACE_MS:15000,
  FRAME_COLLECTION_MAX_MS,FRAME_NAVIGATION_DEBOUNCE_MS,nextFrameCollectionDelay,
  mergedFrameReviews:coordinator,chrome,
  dispatchChildFrameBatch,ensureContentScriptInFrame:async()=>{},
  sanitizeUiSettings:settings=>settings||{},
  Date:{now:()=>clock.now},
  crypto:{randomUUID:()=>'uuid'},
  setTimeout:(fn,delay)=>{const id=++nextId;timers.set(id,{at:clock.now+delay,fn});return id;},
  clearTimeout:id=>timers.delete(id),console
 };
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 async function flush(){for(let k=0;k<14;k++)await Promise.resolve();}
 async function advance(ms){
  const until=clock.now+ms;
  for(let n=0;n<50;n++){
   let earliest;
   for(const [id,t]of timers){
    if(t.at>until)continue;
    if(!earliest||t.at<earliest.timer.at)earliest={id,timer:t};
   }
   if(!earliest)break;
   clock.now=earliest.timer.at;
   timers.delete(earliest.id);
   earliest.timer.fn();
   await flush();
  }
  clock.now=until;await flush();
 }
 return {ctx,clock,callbacks,timers,runs,starts,advance,flush,
  setFrames(next){frames=next;},
  getFrameIds(){return starts.map(x=>x.frameId);},
  async begin(){const result=await ctx.startWholePageForTab(10,{
   modes:{hanja:true,loanword:true},uiSettings:{},trigger:'toolbar'
  });await flush();return result;}
 };
}

test('single-frame full-page operation finalizes early, once, without duplicate model groups',async()=>{
 const f=fixture();
 const result=await f.begin();
 assert.equal(result.ok,true);
 assert.deepEqual(f.getFrameIds(),[0]);
 assert.equal(f.runs.filter(x=>x.type==='finalize').length,0);
 assert.equal(f.timers.size,1);
 const timer=[...f.timers.values()][0];
 assert.equal(timer.at-f.clock.now,FRAME_COLLECTION_SINGLE_QUIET_MS);
 await f.advance(FRAME_COLLECTION_SINGLE_QUIET_MS-1);
 assert.equal(f.runs.filter(x=>x.type==='finalize').length,0);
 await f.advance(1);
 assert.equal(f.runs.filter(x=>x.type==='finalize').length,1);
 assert.equal(f.ctx.activeFrameScans.size,0);
});

test('initially present iframe is registered into the SAME group before settling',async()=>{
 const f=fixture([
  {frameId:0,url:'https://fixture.test/a',documentId:'main'},
  {frameId:4,url:'https://fixture.test/frame',documentId:'child-1'}
 ]);
 await f.begin();
 assert.deepEqual(f.getFrameIds(),[0,4]);
 assert.equal(f.starts[0].group,f.starts[1].group);
 assert.equal(f.starts[0].host,true);
 assert.equal(f.starts[1].host,false);
 assert.equal([...f.timers.values()][0].at-f.clock.now,FRAME_COLLECTION_MULTI_QUIET_MS);
 await f.advance(FRAME_COLLECTION_MULTI_QUIET_MS);
 assert.equal(f.runs.filter(x=>x.type==='finalize').length,1);
});

test('child frame navigation shortly after launch joins existing model group before finalization',async()=>{
 const f=fixture();
 await f.begin();
 await f.advance(150);
 f.setFrames([
  {frameId:0,url:'https://fixture.test/a',documentId:'main'},
  {frameId:4,url:'https://fixture.test/frame',documentId:'late-child'}
 ]);
 f.callbacks.committed({tabId:10,frameId:4});
 assert.ok([...f.timers.values()].some(t=>t.at>f.clock.now+FRAME_COLLECTION_SINGLE_QUIET_MS));
 await f.advance(FRAME_NAVIGATION_DEBOUNCE_MS);
 assert.deepEqual(f.getFrameIds(),[0,4]);
 assert.equal(f.runs.filter(x=>x.type==='finalize').length,0);
 await f.advance(FRAME_COLLECTION_MULTI_QUIET_MS+100);
 assert.equal(f.runs.filter(x=>x.type==='finalize').length,1);
 assert.equal(new Set(f.starts.map(x=>x.group)).size,1);
 assert.deepEqual(f.getFrameIds(),[0,4],'do not start the same child twice during final safety pass');
});

test('navigation of the main page aborts collection and prevents stale result application',async()=>{
 const f=fixture();
 await f.begin();
 f.callbacks.committed({tabId:10,frameId:0});
 await f.advance(5000);
 assert.equal(f.runs.filter(x=>x.type==='finalize').length,0);
 assert.equal(f.runs.filter(x=>x.type==='abort').length,1);
 assert.equal(f.ctx.activeFrameScans.size,0);
});

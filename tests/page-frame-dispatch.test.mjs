import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchChildFrameBatch,frameKey,frameIsCandidate} from '../page-frame-dispatch.js';

const frame=(frameId,url='https://news.test/card',documentId='doc'+frameId)=>({frameId,url,documentId});
test('enumeration excludes top/privileged frames, keeps related about/blob and ordinary iframes',()=>{
 assert.equal(frameIsCandidate(frame(0)),false);
 for(const url of ['chrome://settings/','devtools://devtools','chrome-extension://abcd/panel.html'])
   assert.equal(frameIsCandidate(frame(2,url)),false);
 for(const url of ['about:blank','about:srcdoc','blob:https://news.test/id','https://news.test/side'])
   assert.equal(frameIsCandidate(frame(2,url)),true);
 assert.equal(frameKey(frame(2,'about:blank','different')),'different');
});
test('normal full-page dispatch starts all eligible Korean child frames once, even if main has none',async()=>{
 const inspected=[],probed=[],started=[],seen=new Set();
 const frames=[frame(0),frame(1),frame(2),frame(3),frame(4,'about:blank')];
 const callbacks={
  started:seen,
  ensure:async item=>{inspected.push(item.frameId);},
  probe:async item=>{probed.push(item.frameId);return {ok:true,eligible:item.frameId===1||item.frameId===4};},
  start:async item=>{started.push(item.frameId);return {ok:true,started:true};}
 };
 const run=await dispatchChildFrameBatch(frames,callbacks);
 assert.equal(run.started,2);
 assert.equal(run.discovered,4);
 assert.equal(run.empty,2);
 assert.deepEqual(started.sort(),[1,4]);
 const repeat=await dispatchChildFrameBatch(frames,callbacks);
 assert.equal(repeat.started,0);
 assert.equal(repeat.alreadyStarted,2);
 assert.deepEqual(started.sort(),[1,4]);
});
test('permission denied or failing iframe does not stop valid siblings or main frame',async()=>{
 const starts=[],candidates=[frame(0),frame(1),frame(2),frame(3),frame(4)];
 const res=await dispatchChildFrameBatch(candidates,{
  ensure:async f=>{if(f.frameId===2)throw Error('Cannot access contents of the page: permissions');},
  probe:async f=>({ok:true,eligible:true}),
  start:async f=>{starts.push(f.frameId);return f.frameId===3?{ok:false,error:'blocked by CSP'}:{ok:true,started:true};}
 });
 assert.equal(res.started,2);
 assert.equal(res.inaccessible,1);
 assert.equal(res.failed,1);
 assert.deepEqual(starts.sort(),[1,3,4]);
});
test('newly created or navigated iframe is included on a later bounded pass',async()=>{
 const sent=[],seen=new Set(),opts={
  started:seen,ensure:async()=>{},probe:async()=>({ok:true,eligible:true}),
  start:async item=>{sent.push(item.documentId);return {ok:true,started:true};}
 };
 await dispatchChildFrameBatch([frame(0),frame(1,'https://a','d1')],opts);
 await dispatchChildFrameBatch([frame(0),frame(1,'https://a','d1'),frame(2,'https://a','d2')],opts);
 await dispatchChildFrameBatch([frame(0),frame(1,'https://a','d3'),frame(2,'https://a','d2')],opts);
 assert.deepEqual(sent,['d1','d2','d3']);
});
test('duplicate frame metadata is not submitted twice in a single run',async()=>{
 let count=0;
 const result=await dispatchChildFrameBatch([frame(1),frame(1),frame(1)],{
  ensure:async()=>{},probe:async()=>({ok:true,eligible:true}),
  start:async()=>{count++;return {ok:true,started:true}}
 });
 assert.equal(count,1);
 assert.equal(result.started,1);
});

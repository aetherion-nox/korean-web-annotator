import test from 'node:test';
import assert from 'node:assert/strict';
import {undoTabAnnotations,restoreTabAnnotations} from '../tab-annotation-history.js';

function fixture(){
 const states=new Map([
  [0,[{groupId:'whole-page-1',startedAt:100,depth:1}]],
  [1,[{groupId:'whole-page-1',startedAt:101,depth:1}]],
  [3,[{groupId:'selection-2',startedAt:200,depth:1}]]
 ]);
 const messages=[],changed=new Map();
 const chrome={
  webNavigation:{getAllFrames:async()=>[
   {frameId:0},{frameId:1},{frameId:3},{frameId:4}
  ]},
  tabs:{sendMessage:async(tabId,message,{frameId})=>{
   messages.push({tabId,frameId,...message});
   if(frameId===4)throw Error('restricted frame');
   const history=states.get(frameId)||[];
   if(message.type==='KRA_HISTORY_STATE')return {ok:true,...(history.at(-1)||{
    groupId:null,startedAt:0,depth:0})};
   if(message.type==='UNDO_LAST_ANNOTATION'){
    const last=history.at(-1);
    if(!last||last.groupId!==message.groupId)return {ok:false,skipped:true};
    history.pop();changed.set(frameId,(changed.get(frameId)||0)+1);
    return {ok:true,changed:1};
   }
   if(message.type==='RESTORE_ANNOTATION'){
    history.length=0;changed.set(frameId,(changed.get(frameId)||0)+10);
    return {ok:true,removed:10};
   }
   return null;
  }}
 };
 return {chrome,messages,changed,states};
}
test('one undo reverses only the most recent selection, not older whole-page frames',async()=>{
 const x=fixture();
 const undo=await undoTabAnnotations(x.chrome,77);
 assert.equal(undo.ok,true);
 assert.equal(undo.undoneFrames,1);
 assert.equal(undo.groupId,'selection-2');
 assert.deepEqual([...x.changed.keys()],[3]);
 assert.equal(x.states.get(0).length,1);
 assert.equal(x.states.get(1).length,1);
});

test('one previous whole-page undo atomically targets main and child frame histories',async()=>{
 const x=fixture();
 await undoTabAnnotations(x.chrome,77);
 const undo=await undoTabAnnotations(x.chrome,77);
 assert.equal(undo.ok,true);
 assert.equal(undo.groupId,'whole-page-1');
 assert.equal(undo.undoneFrames,2);
 assert.equal(x.states.get(0).length,0);
 assert.equal(x.states.get(1).length,0);
 assert.equal(x.states.get(3).length,0);
 assert.equal((await undoTabAnnotations(x.chrome,77)).ok,false);
});

test('restore all operates on top, subframes and ignores unavailable frames safely',async()=>{
 const x=fixture();
 const restored=await restoreTabAnnotations(x.chrome,77);
 assert.equal(restored.ok,true);
 assert.equal(restored.restoredFrames,3);
 assert.equal(restored.removed,30);
 assert.deepEqual(restored.inaccessibleFrames,[4]);
 assert.equal(x.states.get(0).length,0);
 assert.equal(x.states.get(1).length,0);
 assert.equal(x.states.get(3).length,0);
});

test('undo does not consume older unrelated operations when a selected frame has navigated',async()=>{
 const x=fixture();
 x.states.get(3)[0].groupId='another-group';
 // A frame that fails when a popup attempts Undo must not cause other
 // frames to independently consume their top history records.
 x.chrome.tabs.sendMessage=async(_,message,{frameId})=>{
  if(message.type==='KRA_HISTORY_STATE')return frameId===0?
   {ok:true,groupId:'G',startedAt:100,depth:1}:
   {ok:true,groupId:null,startedAt:0,depth:0};
  if(message.type==='UNDO_LAST_ANNOTATION')return {ok:false,skipped:true};
 };
 const result=await undoTabAnnotations(x.chrome,77);
 assert.equal(result.ok,false);
});

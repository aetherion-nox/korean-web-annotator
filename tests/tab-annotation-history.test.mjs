import test from 'node:test';
import assert from 'node:assert/strict';
import {undoTabAnnotations,redoTabAnnotations,tabAnnotationHistoryState,invalidateRedoInTab,restoreTabAnnotations} from '../tab-annotation-history.js';

function fixture(){
 const states=new Map([
  [0,[{groupId:'whole-page-1',startedAt:100,depth:1}]],
  [1,[{groupId:'whole-page-1',startedAt:101,depth:1}]],
  [3,[{groupId:'selection-2',startedAt:200,depth:1}]]
 ]);
 const messages=[],changed=new Map(),redos=new Map([...states.keys()].map(k=>[k,[]]));
 const chrome={
  webNavigation:{getAllFrames:async()=>[
   {frameId:0},{frameId:1},{frameId:3},{frameId:4}
  ]},
  tabs:{sendMessage:async(tabId,message,{frameId})=>{
   messages.push({tabId,frameId,...message});
   if(frameId===4)throw Error('restricted frame');
   const history=states.get(frameId)||[];
   if(message.type==='KRA_HISTORY_STATE'){
    const undone=redos.get(frameId)||[];
    return {ok:true,...(history.at(-1)||{groupId:null,startedAt:0,depth:0}),
      depth:history.length,redoGroupId:undone.at(-1)?.groupId||null,
      redoStartedAt:undone.at(-1)?.startedAt||0,redoDepth:undone.length,
      undoGroups:history.map(x=>({groupId:x.groupId,startedAt:x.startedAt})),
      redoGroups:undone.map(x=>({groupId:x.groupId,startedAt:x.startedAt}))};
   }
   if(message.type==='UNDO_LAST_ANNOTATION'){
    const last=history.at(-1);
    if(!last||last.groupId!==message.groupId)return {ok:false,skipped:true};
    redos.get(frameId).push(history.pop());changed.set(frameId,(changed.get(frameId)||0)+1);
    return {ok:true,changed:1};
   }
   if(message.type==='REDO_LAST_ANNOTATION'){
    const stack=redos.get(frameId),last=stack.at(-1);
    if(!last||last.groupId!==message.groupId)return {ok:false,skipped:true};
    history.push(stack.pop());changed.set(frameId,(changed.get(frameId)||0)+1);
    return {ok:true,changed:1};
   }
   if(message.type==='KRA_INVALIDATE_REDO'){
    redos.get(frameId).length=0;return {ok:true};
   }
   if(message.type==='RESTORE_ANNOTATION'){
    history.length=0;redos.get(frameId).length=0;
    changed.set(frameId,(changed.get(frameId)||0)+10);
    return {ok:true,removed:10};
   }
   return null;
  }}
 };
 return {chrome,messages,changed,states,redos};
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

test('global Word timeline undoes latest selection then grouped whole page and redoes in chronological order',async()=>{
 const x=fixture();
 let state=await tabAnnotationHistoryState(x.chrome,77);
 assert.equal(state.undoDepth,2,'two logical actions, not three frame records');
 assert.equal(state.redoDepth,0);
 await undoTabAnnotations(x.chrome,77);await undoTabAnnotations(x.chrome,77);
 state=await tabAnnotationHistoryState(x.chrome,77);
 assert.equal(state.undoDepth,0);assert.equal(state.redoDepth,2);
 const redo1=await redoTabAnnotations(x.chrome,77);
 assert.equal(redo1.ok,true);
 assert.equal(redo1.groupId,'whole-page-1');
 assert.equal(redo1.redoneFrames,2);
 const redo2=await redoTabAnnotations(x.chrome,77);
 assert.equal(redo2.ok,true);
 assert.equal(redo2.groupId,'selection-2');
 state=await tabAnnotationHistoryState(x.chrome,77);
 assert.equal(state.undoDepth,2);assert.equal(state.redoDepth,0);
});

test('new action in another iframe invalidates abandoned redo steps across the tab',async()=>{
 const x=fixture();
 await undoTabAnnotations(x.chrome,77);
 assert.equal((await tabAnnotationHistoryState(x.chrome,77)).redoDepth,1);
 const response=await invalidateRedoInTab(x.chrome,77,0);
 assert.equal(response.ok,true);
 assert.equal(response.invalidatedFrames,2);
 assert.equal((await tabAnnotationHistoryState(x.chrome,77)).redoDepth,0);
 assert.equal((await redoTabAnnotations(x.chrome,77)).ok,false);
});

test('redo rejects when no prior Undo and never reaches an unrelated frame history',async()=>{
 const x=fixture();
 assert.equal((await redoTabAnnotations(x.chrome,77)).ok,false);
 const redoMessages=x.messages.filter(m=>m.type==='REDO_LAST_ANNOTATION');
 assert.equal(redoMessages.length,0);
});

// Undo is one logical user action across every frame that participated in it.
// Only live frames with a matching top history record are touched: never fall
// back to a previous unrelated selection in a different frame.
async function activeFrames(chrome,tabId){
 if(!Number.isInteger(tabId))throw Error('无效的网页标签页。');
 let found=[];
 try{found=await chrome.webNavigation?.getAllFrames?.({tabId})||[];}catch{}
 return [...new Set([0,...found.map(x=>x.frameId).filter(Number.isInteger)])];
}
async function frameMessage(chrome,tabId,frameId,message){
 try{return await chrome.tabs.sendMessage(tabId,message,{frameId});}
 catch{return null;}
}
export async function undoTabAnnotations(chrome,tabId){
 const frames=await activeFrames(chrome,tabId);
 const states=await Promise.all(frames.map(async frameId=>({
  frameId,result:await frameMessage(chrome,tabId,frameId,{type:'KRA_HISTORY_STATE'})
 })));
 const candidates=states.filter(s=>s.result?.ok&&typeof s.result.groupId==='string'&&
  Number.isFinite(s.result.startedAt)&&s.result.groupId&&s.result.depth>0);
 if(!candidates.length)return {ok:false,error:'当前页面和可访问的子框架都没有可以撤销的标注。'};
 const mostRecent=candidates.reduce((a,b)=>b.result.startedAt>a.result.startedAt?b:a);
 const groupId=mostRecent.result.groupId;
 const targets=candidates.filter(s=>s.result.groupId===groupId);
 const results=await Promise.all(targets.map(async s=>({
  frameId:s.frameId,result:await frameMessage(chrome,tabId,s.frameId,{type:'UNDO_LAST_ANNOTATION',groupId})
 })));
 const count=results.filter(s=>s.result?.ok).length;
 if(!count)return {ok:false,error:'最近一轮标注所在框架已经变化，未撤销任何过期记录。'};
 return {ok:true,groupId,undoneFrames:count,
  changed:results.reduce((n,s)=>n+(s.result?.changed||0),0),
  skipped:results.filter(s=>!s.result?.ok).map(s=>s.frameId)};
}
export async function redoTabAnnotations(chrome,tabId){
 const frames=await activeFrames(chrome,tabId);
 const states=await Promise.all(frames.map(async frameId=>({
  frameId,result:await frameMessage(chrome,tabId,frameId,{type:'KRA_HISTORY_STATE'})
 })));
 const candidates=states.filter(s=>s.result?.ok&&
  typeof s.result.redoGroupId==='string'&&s.result.redoGroupId&&
  Number.isFinite(s.result.redoStartedAt)&&s.result.redoDepth>0);
 if(!candidates.length)return {ok:false,error:'当前页面和可访问子框架都没有可以重做的步骤。'};
 // After undo C, B, A, the next redo must be A, not the last-removed C.
 const earliest=candidates.reduce((a,b)=>b.result.redoStartedAt<a.result.redoStartedAt?b:a);
 const groupId=earliest.result.redoGroupId;
 const targets=candidates.filter(s=>s.result.redoGroupId===groupId);
 const results=await Promise.all(targets.map(async s=>({
  frameId:s.frameId,result:await frameMessage(chrome,tabId,s.frameId,{
   type:'REDO_LAST_ANNOTATION',groupId})
 })));
 const redoneFrames=results.filter(s=>s.result?.ok).length;
 if(!redoneFrames)return {ok:false,error:'重做所需的原始网页节点已经变化，未执行不安全的重做。'};
 return {ok:true,groupId,redoneFrames,
  changed:results.reduce((n,s)=>n+(s.result?.changed||0),0),
  skipped:results.filter(s=>!s.result?.ok).map(s=>s.frameId)};
}

export async function tabAnnotationHistoryState(chrome,tabId){
 const frames=await activeFrames(chrome,tabId);
 const states=await Promise.all(frames.map(async frameId=>({
  frameId,result:await frameMessage(chrome,tabId,frameId,{type:'KRA_HISTORY_STATE'})
 })));
 const unique=(key,legacyId,legacyDepth)=>{
  const groups=new Set();
  for(const {frameId,result} of states){
   if(!result?.ok)continue;
   if(Array.isArray(result[key])){
    for(const row of result[key])if(typeof row?.groupId==='string'&&row.groupId)
     groups.add(row.groupId);
   }else if(result[legacyDepth]>0&&result[legacyId])
    groups.add(result[legacyId]);
  }
  return groups.size;
 };
 return {ok:true,undoDepth:unique('undoGroups','groupId','depth'),
  redoDepth:unique('redoGroups','redoGroupId','redoDepth'),
  inspectedFrames:states.filter(s=>s.result?.ok).length,
  inaccessibleFrames:states.filter(s=>!s.result?.ok).map(s=>s.frameId)};
}

export async function invalidateRedoInTab(chrome,tabId,exceptFrameId=null){
 const frames=await activeFrames(chrome,tabId);
 const results=await Promise.all(frames.filter(id=>id!==exceptFrameId).map(async frameId=>({
  frameId,result:await frameMessage(chrome,tabId,frameId,{type:'KRA_INVALIDATE_REDO'})
 })));
 return {ok:true,invalidatedFrames:results.filter(s=>s.result?.ok).length};
}

export async function restoreTabAnnotations(chrome,tabId){
 const frames=await activeFrames(chrome,tabId);
 const results=await Promise.all(frames.map(async frameId=>({
  frameId,result:await frameMessage(chrome,tabId,frameId,{type:'RESTORE_ANNOTATION'})
 })));
 const restoredFrames=results.filter(s=>s.result?.ok).length;
 if(!restoredFrames)return {ok:false,error:'当前页面及可访问子框架均未响应还原操作。'};
 return {ok:true,restoredFrames,
  removed:results.reduce((n,s)=>n+(s.result?.removed||0),0),
  inaccessibleFrames:results.filter(s=>!s.result?.ok).map(s=>s.frameId)};
}

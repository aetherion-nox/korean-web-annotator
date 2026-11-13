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

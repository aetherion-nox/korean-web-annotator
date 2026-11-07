import {buildManualPrompt} from './review-payload.js';
export {buildManualPrompt} from './review-payload.js';
import {validateChoices} from './choice-review.js';
import {describeBatchBudget} from './batch-budget.js';

// Split occurrences, including a long sentence, while retaining the actual owners.
// Keep an oversized single dictionary entry intact rather than losing senses.
export function manualReviewBatches(items,context='',{maxTargets=48,maxChars=60000,reviewPosFilter=true}={}){
 const groups=[];let rows=[];
 const ownContext=group=>[...new Set(group.map(r=>r.target.context))].join('\n');
 const prompt=(context,group)=>buildManualPrompt(context,group.map((r,i)=>({...r.target,target_id:'t'+i})),'00000000',{reviewPosFilter});
 const size=group=>prompt(ownContext(group),group).length;
 for(const item of items)for(const target of item.result.unresolved){
  const row={item,target};
  if(rows.length&&(rows.length>=maxTargets||size([...rows,row])>maxChars)){groups.push(rows);rows=[];}
  rows.push(row);
 }
 if(rows.length)groups.push(rows);
 return groups.map(group=>({rows:group,items:[...new Set(group.map(r=>r.item))],context:context&&context.length<=maxChars&&prompt(context,group).length<=maxChars?context:ownContext(group)}));
}

function parseAnswer(text){
 if(typeof text!=='string'||!text.trim())throw Error('请先粘贴模型返回的完整 JSON。');
 if(text.length>5*1024*1024)throw Error('结果超过 5 MiB，请仅粘贴本批的 JSON 结果。');
 let source=text.trim();
 const fence=/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(source);if(fence)source=fence[1].trim();
 let response;try{response=JSON.parse(source);}catch{throw Error('JSON 格式无效。请复制完整结果或完整的 ```json 代码块，不要包含解释文字。');}
 if(!response||!Array.isArray(response.results))throw Error('结果需要包含 results 数组。请按导出提示词规定的格式返回。');
 return response;
}

export function prepareManualRequest(config,targets){
 const requestId=Array.from(crypto.getRandomValues(new Uint8Array(8)),byte=>'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'[byte & 63]).join('');
 const wireTargets=targets.map((target,i)=>({...target,target_id:'t'+i}));
 const bindings=config.manualBindings?.map((binding,i)=>{if(binding.target_id!==targets[i]?.target_id)throw Error('Invalid manual recovery binding');return {...binding,target_id:wireTargets[i].target_id};});
 return {requestId,bindings,batchNumber:config.batchNumber,batchTotal:config.batchTotal,targetCount:targets.length,text:buildManualPrompt(config.context,wireTargets,requestId,config),budget:{...describeBatchBudget(config.context,wireTargets,{tier:config.batchContextTier,manual:true,wireIds:true,batchId:requestId,reviewPosFilter:config.reviewPosFilter}),limitReason:config.batchBudget?.limitReason}};
}

export function createManualReviewSession({operationId,post,signal}={}){
 let pending=null,batchNumber=0;
 const notify=(type,extra)=>post({type,operationId,...extra});
 const session={
  request(config,targets,requestSignal=signal){
   const activeSignal=requestSignal||signal;activeSignal?.throwIfAborted();
   if(pending)throw Error('已有一批手动审核正在等待结果。');
   const prepared=config.manualPrepared||prepareManualRequest({...config,batchNumber:config.batchNumber||++batchNumber},targets);
   const {requestId}=prepared,wireTargets=targets.map((target,i)=>({...target,target_id:'t'+i}));
   return new Promise((resolve,reject)=>{
    const clear=()=>{activeSignal?.removeEventListener('abort',abort);if(pending?.requestId===requestId)pending=null;};
    const abort=()=>{clear();reject(activeSignal.reason||new DOMException('Operation aborted','AbortError'));};
    pending={requestId,targets,wireTargets,reviewPosFilter:config.reviewPosFilter,resolve:response=>{clear();resolve(response);}};
    activeSignal?.addEventListener('abort',abort,{once:true});
    try{notify('MANUAL_REVIEW_REQUEST',prepared);}catch(error){clear();reject(error);}
   });
  },
  submit(message){
   if(!pending||message?.operationId!==operationId||message.requestId!==pending.requestId){
    if(message?.operationId===operationId&&typeof message.requestId==='string')notify('MANUAL_REVIEW_ERROR',{requestId:message.requestId,error:'后台已不在等待此批次；当前批次可使用页面保留的数据恢复，或重新开始标注。',recoverable:true});
    return false;
   }
   const current=pending;
   try{
    const response=parseAnswer(message.text);
    if(response.batch_id!==current.requestId)throw Error('batch_id 缺失或不属于当前批次，请保留提示词中的 batch_id 原样。');
    const result=validateChoices(current.wireTargets,response,{reviewPosFilter:current.reviewPosFilter});
    if(result.unresolved.length||response.results.length!==current.wireTargets.length)throw Error('本批结果不完整，或包含重复/其他批次的 target_id、无效 choice_id。请完整复制本批结果，保留 ID 原样。');
    const mapped={results:result.accepted.map(({target,option})=>({target_id:current.targets[current.wireTargets.indexOf(target)].target_id,choice_id:option.choice_id}))};
    notify('MANUAL_REVIEW_ACCEPTED',{requestId:current.requestId,targetCount:result.accepted.length});current.resolve(mapped);return true;
   }catch(error){notify('MANUAL_REVIEW_ERROR',{requestId:current.requestId,error:error.message});return false;}
  }
 };
 return session;
}

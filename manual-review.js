import {buildManualPrompt} from './review-payload.js';
export {buildManualPrompt} from './review-payload.js';
import {validateChoices} from './choice-review.js';
import {describeBatchBudget} from './batch-budget.js';

// Split occurrences, including a long sentence, while retaining the actual owners.
// Keep an oversized single dictionary entry intact rather than losing senses.
export function manualReviewBatches(items,context='',{maxTargets=48,maxChars=60000,reviewPosFilter=true,allowModelHanja=false,allowModelLoanword=false,allowModelSegmentation=false}={}){
 const groups=[];let rows=[];
 const ownContext=group=>[...new Set(group.map(r=>r.target.context))].join('\n');
 const prompt=(context,group)=>buildManualPrompt(context,group.map((r,i)=>({...r.target,target_id:'t'+i})),'00000000',{reviewPosFilter,allowModelHanja,allowModelLoanword,allowModelSegmentation});
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

function explainRejectedManualResult(targets,rows,config){
 const known=new Map(targets.map(t=>[t.target_id,t])),seen=new Set();
 for(const row of rows){
  if(!row||!known.has(row.target_id))return '包含不属于当前批次的 target_id：'+String(row?.target_id??'(缺失)');
  if(seen.has(row.target_id))return '重复的 target_id：'+row.target_id;
  seen.add(row.target_id);
 }
 for(const target of targets){
  if(!seen.has(target.target_id))return '缺少 target_id：'+target.target_id+'（'+target.surface+'）';
  const row=rows.find(r=>r.target_id===target.target_id);
  if(validateChoices([target],{results:[row]},config).accepted.length)return null;
  const preface='目标 '+target.target_id+'（'+target.surface+'）的 '+String(row.choice_id)+' 无效：';
  if(row.choice_id==='GEN_SEGMENTS'){
   if(!Array.isArray(row.segments)||!row.segments.length||row.segments.length>8)return preface+'segments 必须包含 1–8 个子词段。';
   for(let i=0;i<row.segments.length;i++){
    const p=row.segments[i],prev=row.segments[i-1],next=row.segments[i+1];
    if(!p||!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.start<0||p.end>target.surface.length||p.start>=p.end)
     return preface+'第 '+(i+1)+' 段的 start/end 不在目标原文范围内。';
    if(p.surface!==target.surface.slice(p.start,p.end))
     return preface+'第 '+(i+1)+' 段 surface 与原文偏移不一致，应为 '+target.surface.slice(p.start,p.end)+'。';
    if(p.start<(prev?.end??0))
     return preface+'第 '+(i+1)+' 段与上一个词段重叠。';
    if(p.end-p.start===1&&!((prev?.type==='hanja'&&prev.end===p.start&&p.type==='hanja')||
       (next?.type==='hanja'&&p.end===next.start&&p.type==='hanja')))
     return preface+'第 '+(i+1)+' 段为孤立单音节；单音节汉字语素仅在同一连续复合词内允许。';
    if(p.type==='hanja'&&typeof p.replacement==='string'&&Array.from(p.replacement).length!==Array.from(p.surface||'').length)
     return preface+'第 '+(i+1)+' 段的汉字数量与韩文字音节数不一致。';
   }
   return preface+'词源字符、模式开关、高置信度、字段或子词段结构未通过校验。';
  }
  if(row.choice_id==='GEN_HANJA'||row.choice_id==='GEN_LOANWORD')
   return preface+'生成的 replacement、confidence、evidence 或模式开关未通过本地校验。';
  return preface+'不是该目标当前允许的词典选项，或已被词性过滤排除。';
 }
 return '本批的结果数量或候选校验不通过。';
}

export function prepareManualRequest(config,targets){
 const requestId=Array.from(crypto.getRandomValues(new Uint8Array(8)),byte=>'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'[byte & 63]).join('');
 const wireTargets=targets.map((target,i)=>({...target,target_id:'t'+i}));
 const bindings=config.manualBindings?.map((binding,i)=>{if(binding.target_id!==targets[i]?.target_id)throw Error('Invalid manual recovery binding');return {...binding,target_id:wireTargets[i].target_id};});
 return {requestId,bindings,batchNumber:config.batchNumber,batchTotal:config.batchTotal,targetCount:targets.length,text:buildManualPrompt(config.context,wireTargets,requestId,config),budget:{...describeBatchBudget(config.context,wireTargets,{tier:config.batchContextTier,manual:true,wireIds:true,batchId:requestId,reviewPosFilter:config.reviewPosFilter,allowModelHanja:config.allowModelHanja,allowModelLoanword:config.allowModelLoanword,allowModelSegmentation:config.allowModelSegmentation}),limitReason:config.batchBudget?.limitReason}};
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
    pending={requestId,targets,wireTargets,reviewPosFilter:config.reviewPosFilter,allowModelHanja:config.allowModelHanja,allowModelLoanword:config.allowModelLoanword,allowModelSegmentation:config.allowModelSegmentation,resolve:response=>{clear();resolve(response);}};
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
    const result=validateChoices(current.wireTargets,response,{reviewPosFilter:current.reviewPosFilter,allowModelHanja:current.allowModelHanja,allowModelLoanword:current.allowModelLoanword,allowModelSegmentation:current.allowModelSegmentation});
    if(result.unresolved.length||response.results.length!==current.wireTargets.length)throw Error('本批结果未应用：'+(explainRejectedManualResult(current.wireTargets,response.results,{reviewPosFilter:current.reviewPosFilter,allowModelHanja:current.allowModelHanja,allowModelLoanword:current.allowModelLoanword,allowModelSegmentation:current.allowModelSegmentation})||'校验失败')+'。其余已正确的答案无需重新生成，修正该条后重新提交本批 JSON。');
    const mapped={results:result.accepted.map(({target,option})=>({target_id:current.targets[current.wireTargets.indexOf(target)].target_id,choice_id:option.choice_id,...(option.generated?{replacement:option.replacement,confidence:option.confidence,evidence:option.evidence,...(option.segmentationGenerated?{segments:option.segments}:{})}:{})}))};
    notify('MANUAL_REVIEW_ACCEPTED',{requestId:current.requestId,targetCount:result.accepted.length});current.resolve(mapped);return true;
   }catch(error){notify('MANUAL_REVIEW_ERROR',{requestId:current.requestId,error:error.message});return false;}
  }
 };
 return session;
}

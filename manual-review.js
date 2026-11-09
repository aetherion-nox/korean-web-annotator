import {buildManualPrompt} from './review-payload.js';
export {buildManualPrompt} from './review-payload.js';
import {validateChoices} from './choice-review.js';
import {diagnoseGeneratedRow} from './model-origin.js';
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
  if(validateChoices([target],{results:[row]},config).accepted.length)continue;
  const preface='目标 '+target.target_id+'（'+target.surface+'）的 '+String(row.choice_id)+' 无效：';
  if(row.choice_id==='GEN_SEGMENTS'){
   const reason=diagnoseGeneratedRow(target,row,config);
   if(!reason.ok)return preface+reason.message+'（'+reason.code+'）';
   if(!Array.isArray(row.segments)||!row.segments.length||row.segments.length>8)return preface+'segments 必须包含 1–8 个子词段。';
   for(let i=0;i<row.segments.length;i++){
    const p=row.segments[i],prev=row.segments[i-1],next=row.segments[i+1];
    if(!p||!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.start<0||p.end>target.surface.length||p.start>=p.end)
     return preface+'第 '+(i+1)+' 段的 start/end 不在目标原文范围内。';
    if(p.surface!==target.surface.slice(p.start,p.end))
     return preface+'第 '+(i+1)+' 段 surface 与原文偏移不一致，应为 '+target.surface.slice(p.start,p.end)+'。';
    if(p.start<(prev?.end??0))
     return preface+'第 '+(i+1)+' 段与上一个词段重叠。';
    if(p.end-p.start===1&&!((prev&&prev.end===p.start)||(next&&p.end===next.start)))
     return preface+'第 '+(i+1)+' 段为孤立单音节；单音节片段仅允许位于一个连续的复合词内部。';
    if(p.type==='hanja'&&typeof p.replacement==='string'&&Array.from(p.replacement).length!==Array.from(p.surface||'').length)
     return preface+'第 '+(i+1)+' 段的汉字数量与韩文字音节数不一致。';
   }
   return preface+'词源字符、模式开关、高置信度、字段或子词段结构未通过校验。';
  }
  if(row.choice_id==='GEN_HANJA'||row.choice_id==='GEN_LOANWORD'){
   const reason=diagnoseGeneratedRow(target,row,config);
   return preface+(reason.ok?'目标的其他限制未通过校验':reason.message+'（'+reason.code+'）');
  }
  return preface+'不是该目标当前允许的词典选项，或已被词性过滤排除。';
 }
 return '本批的结果数量或候选校验不通过。';
}

export function prepareManualRequest(config,targets){
 const requestId=Array.from(crypto.getRandomValues(new Uint8Array(8)),byte=>'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'[byte & 63]).join('');
 const wireTargets=targets.map((target,i)=>({...target,target_id:'t'+i}));
 const bindings=config.manualBindings?.map((binding,i)=>{if(binding.target_id!==targets[i]?.target_id)throw Error('Invalid manual recovery binding');return {...binding,target_id:wireTargets[i].target_id};});
 return {requestId,bindings,batchNumber:config.batchNumber,batchTotal:config.batchTotal,targetCount:targets.length,text:buildManualPrompt(config.context,wireTargets,requestId,config),budget:{...describeBatchBudget(config.context,wireTargets,{tier:config.batchContextTier,manual:true,wireIds:true,batchId:requestId,reviewPosFilter:config.reviewPosFilter,allowModelHanja:config.allowModelHanja,allowModelLoanword:config.allowModelLoanword,allowModelSegmentation:config.allowModelSegmentation,manualOutputTokens:config.manualOutputTokens}),limitReason:config.batchBudget?.limitReason}};
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
    pending={requestId,targets,wireTargets,config:{...config,manualPrepared:undefined,manualBindings:undefined},
     acceptedRows:new Map(),
     reviewPosFilter:config.reviewPosFilter,allowModelHanja:config.allowModelHanja,allowModelLoanword:config.allowModelLoanword,allowModelSegmentation:config.allowModelSegmentation,resolve:response=>{clear();resolve(response);}};
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
    const validationConfig={reviewPosFilter:current.reviewPosFilter,allowModelHanja:current.allowModelHanja,
     allowModelLoanword:current.allowModelLoanword,allowModelSegmentation:current.allowModelSegmentation};
    const known=new Map(current.wireTargets.map(t=>[t.target_id,t]));
    const grouped=new Map(),failures=[];
    for(const row of response.results){
     if(!row||!known.has(row.target_id)){
      failures.push('跨批或未知 target_id：'+String(row?.target_id??'(缺失)'));
      continue;
     }
     if(!grouped.has(row.target_id))grouped.set(row.target_id,[]);
     grouped.get(row.target_id).push(row);
    }
    for(const [id,rows] of grouped){
     if(rows.length!==1){
      failures.push('重复 target_id：'+id+'（本次 '+rows.length+' 条，已忽略）');
      continue;
     }
     // Never overwrite a decision accepted in an earlier submission.
     if(current.acceptedRows.has(id))continue;
     const row=rows[0],target=known.get(id);
     const outcome=validateChoices([target],{results:[row]},validationConfig);
     if(outcome.accepted.length!==1){
      failures.push(explainRejectedManualResult([target],[row],validationConfig));
      continue;
     }
     const option=outcome.accepted[0].option;
     current.acceptedRows.set(id,{
      target_id:id,choice_id:option.choice_id,
      ...(option.generated?{confidence:option.confidence,evidence:option.evidence,
       ...(option.segmentationGenerated?{segments:option.segments}:{replacement:option.replacement})}:{})
     });
    }
    const remaining=current.wireTargets.filter(t=>!current.acceptedRows.has(t.target_id));
    if(remaining.length){
     const ids=remaining.map(t=>t.target_id);
     const repairPrompt='只修复以下 '+remaining.length+' 个未通过校验的 target_id。之前已通过的 '+current.acceptedRows.size+
      ' 条答案已保存，无需重新生成。必须保留原 batch_id '+current.requestId+
      '；results 只包含下列目标，严格检查 GEN_SEGMENTS 的 surface 与 UTF-16 start/end。\n\n'+
      buildManualPrompt(current.config.context,remaining,current.requestId,current.config);
     notify('MANUAL_REVIEW_ERROR',{requestId:current.requestId,
      error:'已保存 '+current.acceptedRows.size+'/'+current.wireTargets.length+' 条有效答案；还有 '+remaining.length+
       ' 条需修复：'+ids.slice(0,24).join('、')+(ids.length>24?'…':'')+'。'+(failures[0]||'')+
       ' 可直接复制上方新的纠错提示词，下一次只提交这些 ID。',
      invalidTargetIds:ids,acceptedCount:current.acceptedRows.size,
      acceptedRows:[...current.acceptedRows.values()],repairPrompt});
     return false;
    }
    const mapped={results:current.wireTargets.map((target,i)=>({
     ...current.acceptedRows.get(target.target_id),target_id:current.targets[i].target_id
    }))};
    notify('MANUAL_REVIEW_ACCEPTED',{requestId:current.requestId,targetCount:current.wireTargets.length,
     acceptedRows:[...current.acceptedRows.values()]});
    current.resolve(mapped);return true;
   }catch(error){notify('MANUAL_REVIEW_ERROR',{requestId:current.requestId,error:error.message});return false;}
  }
 };
 return session;
}

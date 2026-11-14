import {buildManualPrompt} from './review-payload.js';
export {buildManualPrompt} from './review-payload.js';
import {validateChoices,validateExperimentalChoices} from './choice-review.js';
import {filterReviewTarget} from './review-pos.js';
import {explainLiteralOriginRejection} from './experimental-options.js';
import {describeBatchBudget} from './batch-budget.js';
import {validateSegmentationRepairs} from './segmentation-repairs.js';
import {normalizeManualAnswer} from './manual-answer-format.js';

// Split occurrences, including a long sentence, while retaining the actual owners.
// Keep an oversized single dictionary entry intact rather than losing senses.
export function manualReviewBatches(items,context='',{maxTargets=48,maxChars=60000,reviewPosFilter=true,experimentalHanja=false,experimentalLoanword=false,dictionaryFree=false,smartSegmentation=false}={}){
 const groups=[];let rows=[];
 const ownContext=group=>[...new Set(group.map(r=>r.target.context))].join('\n');
 const prompt=(context,group)=>buildManualPrompt(context,group.map((r,i)=>({...r.target,target_id:'t'+i})),'00000000',{reviewPosFilter,experimentalHanja,experimentalLoanword,dictionaryFree,smartSegmentation});
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
 if(text.length>16*1024*1024)throw Error('结果超过 16 MiB，请仅粘贴本批的 JSON 结果。');
 let source=text.trim();
 const fence=/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(source);if(fence)source=fence[1].trim();
 let response;try{response=JSON.parse(source);}catch{throw Error('JSON 格式无效。请复制完整结果或完整的 ```json 代码块，不要包含解释文字。');}
 // The active request, not the model's wrapper, determines the batch identity.
 return response;
}

export function prepareManualRequest(config,targets){
 const requestId=Array.from(crypto.getRandomValues(new Uint8Array(8)),byte=>'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'[byte & 63]).join('');
 const wireTargets=targets.map((target,i)=>({...target,target_id:'t'+i,original_target_id:target.original_target_id||target.target_id}));
 const bindings=config.manualBindings?.map((binding,i)=>{if(binding.target_id!==targets[i]?.target_id)throw Error('Invalid manual recovery binding');return {...binding,target_id:wireTargets[i].target_id};});
 // Compact, source-bound safety snapshot for disconnected manual repairs.
 // Deduplicate scopes by original sentence, rather than copying them per word.
 const repairValidation=config.smartSegmentation===true?(()=>{
  const scopes=new Map();
  targets.forEach(t=>{if(!scopes.has(t.repair_sentence_key))
   scopes.set(t.repair_sentence_key,config.repairScopes?.get(t.target_id)||null);});
  return {targets:wireTargets.map(t=>({
   target_id:t.target_id,original_target_id:t.original_target_id,
   repair_sentence_key:t.repair_sentence_key,start:t.start,end:t.end,
   surface:t.surface,scan_only:t.scan_only===true,
   proper_noun:t.proper_noun===true,suspected_person_name:t.suspected_person_name===true,
   dictionary_person_name:t.dictionary_person_name===true,dictionary_name_homograph:t.dictionary_name_homograph===true
  })),scopes:[...scopes]};
 })():undefined;
 return {requestId,bindings,repairValidation,smartSegmentation:config.smartSegmentation===true,hanjaReadingCheck:config.hanjaReadingCheck!==false,batchNumber:config.batchNumber,batchTotal:config.batchTotal,targetCount:wireTargets.filter(t=>!(config.smartSegmentation===true&&t.scan_only===true)).length,text:buildManualPrompt(config.context,wireTargets,requestId,config),budget:{...describeBatchBudget(config.context,wireTargets,{tier:config.batchContextTier,manual:true,wireIds:true,batchId:requestId,reviewPosFilter:config.reviewPosFilter,experimentalHanja:config.experimentalHanja,experimentalLoanword:config.experimentalLoanword,dictionaryFree:config.dictionaryFree,smartSegmentation:config.smartSegmentation,manualOutputTokenLimit:config.manualOutputTokenLimit,apiOutputTokenLimit:config.apiOutputTokenLimit}),limitReason:config.batchBudget?.limitReason}};
}

// Preserve the original shared pools and restrict retry work to unsolved IDs.
function manualRetryPrompt(original,batchId,remaining,reasons,acceptedCount){
 const ids=new Set(remaining.map(t=>t.target_id));
 const lead='此前已验证并保存 '+acceptedCount+' 条答案。本次只回答以下 '+remaining.length+
   ' 个目标（用 t 字段指定）；不要重发已完成目标。逐条核对原句、候选释义与词性；不能确定时 c 为 JSON null。'+
   ' 保留请求中的 target_id 作为 t 的值；复制 batch_id '+batchId+'；只输出 JSON 对象（batch_id、results，必要时 repairs），'+
   '不要复制 format、sentences、candidates 或 targets。\n错误原因：\n'+
   remaining.map(t=>t.target_id+'：'+(reasons.get(t.target_id)||'该目标未返回有效答案')).join('\n')+'\n\n';
 const begin=original.indexOf('{"format":"shared-pools-v4"');
 if(begin<0)return lead+original;
 try{
   const old=JSON.parse(original.slice(begin));
   const selected=(old.targets||[]).filter(t=>ids.has(t.target_id));
   if(selected.length!==remaining.length)return lead+original;
   const candidateIds=new Set(selected.flatMap(t=>Object.values(t.options||{})).filter(x=>typeof x==='string'));
   const sentenceIds=new Set(selected.map(t=>t.sentence_id));
   const payload={...old,
     sentences:(old.sentences||[]).filter(s=>sentenceIds.has(s.sentence_id)),
     candidates:(old.candidates||[]).filter(c=>candidateIds.has(c.candidate_id)),
     targets:selected,batch_id:batchId};
   return lead+original.slice(0,begin)+JSON.stringify(payload);
 }catch{return lead+original;}
}

export function createManualReviewSession({operationId,post,signal}={}){
 let pending=null,batchNumber=0;
 const notify=(type,extra)=>post({type,operationId,...extra});
 const session={
  request(config,targets,requestSignal=signal){
   const activeSignal=requestSignal||signal;activeSignal?.throwIfAborted();
   if(pending)throw Error('已有一批手动审核正在等待结果。');
   const prepared=config.manualPrepared||prepareManualRequest({...config,batchNumber:config.batchNumber||++batchNumber},targets);
   const {requestId}=prepared,wireTargets=targets.map((target,i)=>({...target,target_id:'t'+i,original_target_id:target.original_target_id||target.target_id}));
   return new Promise((resolve,reject)=>{
    const clear=()=>{activeSignal?.removeEventListener('abort',abort);if(pending?.requestId===requestId)pending=null;};
    const abort=()=>{clear();reject(activeSignal.reason||new DOMException('Operation aborted','AbortError'));};
    pending={requestId,targets,wireTargets,originalPrompt:prepared.text,acceptedRows:new Map(),savedRepairs:[],
      experimentalHanja:config.experimentalHanja===true,experimentalLoanword:config.experimentalLoanword===true,hanjaReadingCheck:config.hanjaReadingCheck!==false,
      reviewPosFilter:config.reviewPosFilter,smartSegmentation:config.smartSegmentation===true,
      repairContext:config.context,repairModes:config.repairModes,
      repairScopes:new Map(targets.map((target,i)=>[wireTargets[i].target_id,config.repairScopes?.get(target.target_id)])),
      resolve:response=>{clear();resolve(response);}};
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
    const response=normalizeManualAnswer(parseAnswer(message.text),{
      requestId:current.requestId,knownTargetIds:new Set(current.wireTargets.map(t=>t.target_id))
    });
    if(Object.prototype.hasOwnProperty.call(response,'experimental_options'))
      throw Error('新版协议只需要 results；请不要包含 experimental_options。');
    const experimental=current.experimentalHanja||current.experimentalLoanword;
    const choicesConfig={reviewPosFilter:current.reviewPosFilter,
      experimentalHanja:current.experimentalHanja,experimentalLoanword:current.experimentalLoanword,hanjaReadingCheck:current.hanjaReadingCheck};
    const known=new Map(current.wireTargets.map(t=>[t.target_id,t]));
    const incoming=new Map(),reasons=new Map(),unknown=[];
    for(const row of response.results){
      if(!row||typeof row!=='object'||Array.isArray(row)||
         Object.keys(row).sort().join(',')!=='c,t'||
         typeof row.t!=='string'||!known.has(row.t)||
         !(row.c===null||(typeof row.c==='string'&&row.c.length>0))){
        unknown.push(String(row?.t??'(无效)'));continue;
      }
      if(!incoming.has(row.t))incoming.set(row.t,[]);
      incoming.get(row.t).push(row);
    }
    // Repair validation must happen before missing-result detection. The same
    // original sentence scopes, names, selections and conflict rules used by
    // the worker determine whether an old target is genuinely superseded.
    let validRepairs=[];
    if(current.smartSegmentation){
      const check=rows=>validateSegmentationRepairs(current.wireTargets,{repairs:rows},{
        smartSegmentation:true,context:current.repairContext,repairModes:current.repairModes,
        hanjaReadingCheck:current.hanjaReadingCheck,repairScopes:current.repairScopes,
        reviewPosFilter:current.reviewPosFilter,
        experimentalHanja:current.experimentalHanja,experimentalLoanword:current.experimentalLoanword
      });
      const seen=new Set(current.savedRepairs.map(r=>JSON.stringify(r)));
      const additions=Array.isArray(response.repairs)?response.repairs.filter(r=>{
        const str=JSON.stringify(r);
        if(!str||seen.has(str))return false;
        seen.add(str);return true;
      }):[];
      // Previous valid repairs cannot be revoked by a new conflicting retry.
      const previous=check(current.savedRepairs);
      const stable=previous.accepted.map(r=>current.savedRepairs[r.index]);
      const nonconflicting=additions.filter(row=>!stable.some(old=>
        row?.sentence_id===old.sentence_id&&(
          Number.isInteger(row.start)&&Number.isInteger(row.end)&&
            row.start<old.end&&old.start<row.end||
          Array.isArray(row.old_target_ids)&&
            row.old_target_ids.some(id=>old.old_target_ids.includes(id))
        )));
      const proposed=[...stable,...nonconflicting];
      const checked=check(proposed);
      validRepairs=checked.accepted;
      current.savedRepairs=validRepairs.map(r=>({
        sentence_id:r.sentence_id,op:r.op,old_target_ids:r.old_target_ids,
        start:r.start,end:r.end,surface:r.surface,choice_id:r.choice_id
      }));
      if(checked.rejected.length)for(const issue of checked.rejected){
        for(const id of issue.old_target_ids||[])reasons.set(id,'修复未通过安全校验：'+issue.reason);
      }
    }
    const retired=new Set(validRepairs.flatMap(r=>r.old_target_ids));
    for(const [id,rows] of incoming){
      if(current.acceptedRows.has(id)||retired.has(id))continue; // Old answers never override a verified repair.
      if(rows.length!==1){
        reasons.set(id,'重复 target_id（本次 '+rows.length+' 条），请只返回一条');continue;
      }
      const target=known.get(id),row=rows[0];
      if(current.smartSegmentation&&target.scan_only===true)continue; // Review-only placeholders need no answer.
      const selected=experimental?
        validateExperimentalChoices([target],{results:[row]},choicesConfig):
        validateChoices([target],{results:[row]},choicesConfig);
      if(selected.accepted.length!==1){
        const candidate=filterReviewTarget(target,choicesConfig).options.find(o=>o.type!=='keep'&&o.choice_id===row.c);
        reasons.set(id,candidate?'字段不符合当前协议':'无效 c：'+String(row.c??'(null)')+
          '；原因 '+explainLiteralOriginRejection(target,row.c,choicesConfig));continue;
      }
      const selectedOption=selected.accepted[0].option;
      current.acceptedRows.set(id,{t:id,c:selectedOption.type==='keep'?null:selectedOption.choice_id});
    }
    const required=current.wireTargets.filter(t=>!(current.smartSegmentation&&t.scan_only===true));
    const missing=required.filter(t=>!current.acceptedRows.has(t.target_id)&&!retired.has(t.target_id));
    const completedCount=required.filter(t=>current.acceptedRows.has(t.target_id)||retired.has(t.target_id)).length;
    if(missing.length){
      const retry=manualRetryPrompt(current.originalPrompt,current.requestId,missing,reasons,completedCount);
      const detail=missing.slice(0,12).map(t=>t.target_id+'（'+(reasons.get(t.target_id)||'未提交')+'）').join('；');
      notify('MANUAL_REVIEW_ERROR',{requestId:current.requestId,
        error:'本批已保留 '+completedCount+'/'+required.length+
          ' 条有效答案，剩余 '+missing.length+' 条待补交：'+detail+
          (missing.length>12?'；其余见补交提示词':'')+
          (unknown.length?'。已忽略 '+unknown.length+' 条未知或跨批 target_id':'')+
          '。请复制新的补交提示词，只回答剩余目标。',
        acceptedCount:completedCount,
        acceptedRows:[...current.acceptedRows.values()].filter(row=>!retired.has(row.t)),
        acceptedRepairs:current.savedRepairs,retiredTargetIds:[...retired],
        invalidTargetIds:missing.map(t=>t.target_id),
        repairPrompt:retry});
      return false;
    }
    const ids=new Map(current.wireTargets.map((t,i)=>[t.target_id,current.targets[i].target_id]));
    const proposed=current.smartSegmentation&&current.savedRepairs.length?{
      repairs:current.savedRepairs.map(row=>({...row,
        old_target_ids:row.old_target_ids.map(id=>ids.get(id)||id)}))
    }:{};
    const mapped={results:[...current.acceptedRows.values()].filter(row=>!retired.has(row.t)).map(row=>({
      t:ids.get(row.t),c:row.c
    })),...proposed};
    notify('MANUAL_REVIEW_ACCEPTED',{requestId:current.requestId,
      targetCount:required.length,
      acceptedRows:[...current.acceptedRows.values()].filter(row=>!retired.has(row.t)),
      acceptedRepairs:current.savedRepairs,retiredTargetIds:[...retired]});
    current.resolve(mapped);return true;
   }catch(error){notify('MANUAL_REVIEW_ERROR',{requestId:current.requestId,error:error.message});return false;}
  }
 };
 return session;
}

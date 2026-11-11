// Validation in the disconnected page uses the same modules as the worker.
// This module is imported lazily only when an offline answer needs model-authored
// spellings or tokenizer repairs. It never contacts the service worker.
import {literalOriginOption} from './experimental-options.js';
import {projectAnnotation} from './local-engine.js';
import {validateSegmentationRepairs} from './segmentation-repairs.js';

function sourceTarget(binding,recovery,sentences){
 const snapshot=recovery.targets?.find(t=>t.target_id===binding.target_id);
 const entry=sentences.get(binding.sentenceId);
 if(!snapshot||!entry||!Number.isInteger(binding.start)||!Number.isInteger(binding.end)||
    entry.text.slice(binding.start,binding.end)!==binding.surface||
    snapshot.start!==binding.start||snapshot.end!==binding.end||snapshot.surface!==binding.surface)
  throw Error('断线备份中的目标原文或校验信息已经失效，请重新开始当前审核。');
 return {...snapshot,context:entry.text};
}

export function validateOfflineManualAnswer(backup,response,sentences,priorRepairs=new Map()){
 const recovery=backup?.recovery;
 if(!recovery||!Array.isArray(recovery.targets)||!Array.isArray(backup.bindings))
  throw Error('断线备份缺少模型词源及分词校验资料，请用新版本重新生成手动批次。');
 const bindings=new Map(backup.bindings.map(b=>[b.target_id,b]));
 const rows=response?.results,accepted=[],seen=new Set();
 if(!Array.isArray(rows)||rows.length!==bindings.size)
  throw Error('本批结果不完整，请使用当前批次的全部 target_id。');
 if(Object.hasOwn(response,'experimental_options'))
  throw Error('新版协议只需要 results，不支持 experimental_options。');
 for(const row of rows){
  if(!row||typeof row!=='object'||Array.isArray(row)||
     typeof row.target_id!=='string'||typeof row.choice_id!=='string')
   throw Error('结果需要有效的 target_id 和 choice_id。');
  const binding=bindings.get(row.target_id);
  if(!binding||seen.has(row.target_id))
   throw Error('本批包含重复或其他批次的 target_id。');
  seen.add(row.target_id);
  if((recovery.experimentalHanja||recovery.experimentalLoanword)&&
     Object.keys(row).sort().join(',')!=='choice_id,target_id')
   throw Error('实验性结果只能包含 target_id 与 choice_id。');
  let choice=binding.choices.find(o=>o.choice_id===row.choice_id);
  if(!choice){
   const target=sourceTarget(binding,recovery,sentences);
   const origin=literalOriginOption(target,row.choice_id,{
    experimentalHanja:recovery.experimentalHanja===true,
    experimentalLoanword:recovery.experimentalLoanword===true
   });
   if(!origin)
    throw Error('目标 '+row.target_id+'（'+binding.surface+'）的模型词源未通过字形、词界、人名或字音校验：'+row.choice_id);
   let projected;
   try{projected=projectAnnotation(target.context,{...target,...origin});}
   catch{throw Error('目标 '+row.target_id+' 的模型词源无法与原文对齐。');}
   choice={choice_id:row.choice_id,annotations:projected.map(({start,end,surface,type,replacement})=>({start,end,surface,type,replacement}))};
  }
  accepted.push({binding,choice});
 }
 const repairs=[];
 let rejectedRepairs=[];
 if(recovery.smartSegmentation===true&&response.repairs!==undefined){
  const targets=recovery.targets.map(t=>{
   const binding=bindings.get(t.target_id);
   if(!binding)throw Error('断线分词校验目标缺失。');
   return sourceTarget(binding,recovery,sentences);
  });
  const groupScopes=new Map((recovery.scopeGroups||[]).map(g=>[g.sentenceKey,g.scope]));
  const scopes=new Map(targets.map(t=>{
   const scope=groupScopes.get(t.repair_sentence_key);
   const previous=priorRepairs.get(t.repair_sentence_key)||[];
   return [t.target_id,scope?{...scope,existingRepairs:[...(scope.existingRepairs||[]),...previous]}:undefined];
  }));
  const checked=validateSegmentationRepairs(targets,response,{
   smartSegmentation:true,
   reviewPosFilter:recovery.reviewPosFilter!==false,
   repairScopes:scopes,
   repairModes:recovery.repairModes||{hanja:false,loanword:false},
   context:''
  });
  repairs.push(...checked.accepted);
  rejectedRepairs=checked.rejected;
 }
 return {accepted,repairs,rejectedRepairs};
}

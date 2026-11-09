import {analyzeLocal,engineStatus,projectAnnotation,validateAnalysis} from './local-engine.js';
import {filterReviewTarget} from './review-pos.js';
import {generatedChoices} from './model-origin.js';
import {segmentationTargets} from './segmentation-rescue.js';
import {mergeResegmentationTargets} from './review-merge.js';
import {reviewTargets,validateChoices,safeDetail} from './choice-review.js';
import {manualReviewBatches,prepareManualRequest} from './manual-review.js';
import {contextReviewBatches,normalizeBatchContextTier} from './batch-budget.js';
function annotationsFromAccepted(text,accepted){
 const projected=a=>projectAnnotation(text,{...a.target,...a.option,start:a.target.start,end:a.target.end,surface:a.target.surface,context:a.target.context});
 const segmented=accepted.filter(a=>a.option.segmentationGenerated===true).flatMap(projected);
 const others=accepted.filter(a=>a.option.type!=='keep'&&!a.option.segmentationGenerated).flatMap(projected);
 const clean=[];
 for(const a of [...segmented].sort((a,b)=>a.start-b.start||a.end-b.end))if(!clean.some(x=>a.start<x.end&&x.start<a.end))clean.push(a);
 return [...others.filter(a=>!clean.some(b=>a.start<b.end&&b.start<a.end)),...clean].sort((a,b)=>a.start-b.start||a.end-b.end);
}
export const CACHE_KEY='kraDictionaryReviewCacheV1Alignment3';
export async function runSentencePipeline(message,post,{signal,analyze=analyzeLocal,status=engineStatus,modelConfig,enabled=false,cache=new Map(),persist=async()=>{}}={}){
 const sentences=message.sentences;
 const selectionReview=message.reviewAll===true;
 const reviewAll=selectionReview || message.reviewAllCandidates===true;
 const bypassCache=selectionReview || message.forceRegenerate;
 enabled=enabled || reviewAll;
 if(typeof message.operationId!=='string'||!message.operationId||!Array.isArray(sentences)||!sentences.length||sentences.length>5000||sentences.some(s=>typeof s.id!=='string'||!s.id||typeof s.text!=='string'||!s.text||s.text.length>20000)||new Set(sentences.map(s=>s.id)).size!==sentences.length)throw Error('Invalid sentence operation');
 const modes={hanja:!!message.modes?.hanja,loanword:!!message.modes?.loanword,nameProtection:message.nameProtection!==false,singleHangulLocalGuard:message.singleHangulLocalGuard!==false,uniqueCandidateRiskReview:message.uniqueCandidateRiskReview!==false};if(!modes.hanja&&!modes.loanword)throw Error('Enable an annotation mode');
 const stats={local_determined:0,pending:0,model_resolved:0,model_generated_hanja:0,model_generated_loanword:0,model_resegmented:0,unresolved:0,structural_rejections:0,rejected_options:0,skipped_mixed:0,protected_names:0,boundary_suspicions:0,unique_risk_reviews:0,cacheHits:0,upstream_converted:0,upstream_ambiguous:0,upstream_no_match:0,upstream_kept:0};
 const totalSentences=sentences.length;let completedSentences=0;let identity;
 const emit=(type,extra={})=>{signal?.throwIfAborted();post({type,operationId:message.operationId,engine_version:identity?.engine_version,dictionary_fingerprint:identity?.dictionary_fingerprint,dictionary_metadata:identity?.dictionary_metadata,...extra,stats:{...stats},completedSentences,totalSentences,percent:Math.round(completedSentences/totalSentences*100)});};
 const loading=progress=>emit('LOCAL_PROGRESS',progress);
 loading({stage:'dictionary'});
 identity=await status(signal,loading);const work=[];
 const diagnostic=d=>emit('DIAGNOSTIC',{diagnostic:d});
 const dictionary=identity.dictionary_metadata||{};
 diagnostic({stage:'dictionary',level:'info',message:'当前使用的本机词典与引擎。',detail:JSON.stringify({source_filename:dictionary.source_filename||'未知',data_version:dictionary.data_version||'未知',total_entries:dictionary.total_entries??'未知',total_senses:dictionary.total_senses??'未知',engine_version:identity.engine_version,dictionary_fingerprint:identity.dictionary_fingerprint})});
 let hasOriginalCounts=false;
 for(const sentence of sentences){
  signal?.throwIfAborted();
  const currentSentence=completedSentences+1;
  const progress=detail=>loading({...detail,currentSentence,sentenceCharacters:sentence.text.length});
  progress({stage:'analysis'});
  const localKey=JSON.stringify(['dictionary-v3-alignment',reviewAll,identity.engine_version,identity.dictionary_fingerprint,modes,sentence.text]);
  let analysis=!bypassCache&&cache.get(localKey);
  if(analysis){analysis=validateAnalysis(sentence.text,analysis);stats.cacheHits++;}else {analysis=validateAnalysis(sentence.text,await analyze(sentence.text,reviewAll?{...modes,reviewAll:true}:modes,signal,progress));if(analysis.engine_version!==identity.engine_version||analysis.dictionary_fingerprint!==identity.dictionary_fingerprint)throw Error('Dictionary changed during operation');cache.set(localKey,analysis);}
  if(modes.singleHangulLocalGuard&&analysis.annotations.length){
   const forbidden=a=>typeof a.surface==='string'&&/^[가-힣]$/u.test(a.surface);
   const removed=analysis.annotations.filter(forbidden);
   if(removed.length){
    analysis={...analysis,annotations:analysis.annotations.filter(a=>!forbidden(a)),
      stats:{...analysis.stats,local_determined:Math.max(0,Number(analysis.stats.local_determined||0)-removed.length)}};
    diagnostic({stage:'single-hangul',level:'warning',message:'已阻止 '+removed.length+' 个单音节谚文词的本地直接标注；未校验的词保持韩文。'});
   }
  }
  if(reviewAll){
   if(analysis.annotations.length)throw Error('模型重审不允许使用本地直接标注结果。');
   if(selectionReview){
    if(!Array.isArray(sentence.selected))throw Error('模型重审需要有效选区。');
    analysis={...analysis,targets:analysis.targets.filter(t=>sentence.selected.some(r=>Number.isInteger(r.start)&&Number.isInteger(r.end)&&t.start>=r.start&&t.end<=r.end))};
   }
   analysis.stats={...analysis.stats,pending:analysis.targets.length};
  }
  if(message.restrictToSelection===true){
   if(!Array.isArray(sentence.selected)||sentence.selected.some(r=>!Number.isInteger(r.start)||!Number.isInteger(r.end)||r.start<0||r.end<=r.start||r.end>sentence.text.length))throw Error('Invalid paragraph selection');
   const selected=a=>sentence.selected.some(r=>a.start>=r.start&&a.end<=r.end);
   analysis={...analysis,annotations:analysis.annotations.filter(selected),targets:analysis.targets.filter(selected)};
   analysis.stats={...analysis.stats,local_determined:analysis.annotations.length,pending:analysis.targets.length};
  }
  for(const warning of analysis.diagnostics||[])diagnostic(warning);
  for(const name of ['local_determined','pending','structural_rejections','rejected_options','skipped_mixed','protected_names','boundary_suspicions','unique_risk_reviews','upstream_converted','upstream_ambiguous','upstream_no_match','upstream_kept'])stats[name]+=Number(analysis.stats[name]||0);
  hasOriginalCounts ||= Number.isInteger(analysis.stats.upstream_converted);
  completedSentences++;emit('RESULTS',{source:'local',results:[{id:sentence.id,annotations:analysis.annotations}]});
  // Supplemental text never enters local analysis or changes source offsets.
  if(sentence.adjacentContext){
   const {before,after}=sentence.adjacentContext;
   if(typeof before!=='string'||typeof after!=='string'||before.length>1000||after.length>1000)throw Error('Invalid adjacent context');
   if(before||after)analysis={...analysis,targets:analysis.targets.map(t=>({...t,adjacent_context:{before,after}}))};
  }
  work.push({sentence,analysis,localKey});
 }
 if(stats.boundary_suspicions||stats.unique_risk_reviews)diagnostic({stage:'risk-review',level:'info',message:`风险复核：暂缓 ${stats.boundary_suspicions} 处可疑词边界，${stats.unique_risk_reviews} 处弱证据唯一候选进入模型审核。`});
  if(stats.protected_names)diagnostic({stage:'rules',level:'info',message:`已按完整名称范围保留 ${stats.protected_names} 处疑似姓名，未使用内部普通词义替换。`,detail:JSON.stringify({protected_names:stats.protected_names})});
 if(hasOriginalCounts)diagnostic({stage:'rules',level:'info',message:`原作者规则：自动转换 ${stats.upstream_converted}，歧义 ${stats.upstream_ambiguous}，未匹配 ${stats.upstream_no_match}；本地标注 ${stats.local_determined}，待审核 ${stats.pending}。`,detail:JSON.stringify({upstream_converted:stats.upstream_converted,upstream_ambiguous:stats.upstream_ambiguous,upstream_no_match:stats.upstream_no_match,upstream_kept:stats.upstream_kept,local_determined:stats.local_determined,pending:stats.pending,structural_rejections:stats.structural_rejections,rejected_options:stats.rejected_options,skipped_mixed:stats.skipped_mixed})});
 let config;
 if(enabled && (work.some(w=>w.analysis.targets.length)||message.experimentalSegmentation===true)){
  try{config=await modelConfig();if(!config)throw Error('没有可用模型配置');}
  catch(error){config=null;diagnostic({stage:'configuration',level:'error',message:`模型配置不可用：${error.message}`});}
 }else diagnostic({stage:'skipped',level:'info',message:enabled?'没有待审核候选，本次无需调用模型。':'模型审核开关关闭，仅使用本地词典规则。'});
 if(config){const upstreamDiagnostic=config.onDiagnostic;config={...config,onDiagnostic:d=>{upstreamDiagnostic?.(d);diagnostic({...d,message:safeDetail(d.message,config),detail:safeDetail(d.detail,config)});}};}
 if(config?.allowModelSegmentation===true){
  let added=0,removed=0;
  for(const item of work){
   if((message.restrictToSelection===true||selectionReview)&&!item.sentence.selected?.length)continue;
   const extra=segmentationTargets(item.sentence.text,item.analysis,
      message.restrictToSelection===true||selectionReview?item.sentence.selected:[]);
   if(!extra.length)continue;
   const combined=mergeResegmentationTargets(item.analysis,extra);
   item.analysis={...item.analysis,targets:combined.targets};
   added+=combined.added;removed+=combined.removed;
  }
  stats.pending+=added-removed;
  diagnostic({stage:'segmentation',level:'warning',message:'实验性模型重新分词：追加 '+added+' 个原文词段，合并 '+removed+' 个与之重叠的词典审核目标。按现有上下文预算拆分批次；每个原文范围只审核一次。'});
 }

 const context=message.context || sentences.map(s=>s.text).join('\n');
 const progressive=message.progressiveAnnotation===true;
 const lastPublished=new Map();
 const publishModel=(item,preview=[],provisional=false)=>{
  const accepted=[...item.result.accepted,...preview];
  const additions=annotationsFromAccepted(item.sentence.text,accepted);
  const signature=JSON.stringify([additions,accepted.map(a=>a.target.target_id),provisional]);
  if(lastPublished.get(item)===signature||(!accepted.length&&!lastPublished.has(item)))return;lastPublished.set(item,signature);
  emit('RESULTS',{source:'model',replaceModel:true,provisional,results:[{id:item.sentence.id,annotations:additions,reviewed:accepted.map(a=>({start:a.target.start,end:a.target.end,surface:a.target.surface}))}]});
 };
 const pending=[];
 const progress={modelCompleted:0,modelTotal:0};
 const reportProgress=()=>emit('MODEL_PROGRESS',{...progress,modelPercent:progress.modelTotal?Math.round(100*progress.modelCompleted/progress.modelTotal):100});
 for(const item of work){
  const {analysis,localKey}=item;
  item.result={accepted:[],unresolved:analysis.targets};
  if(config && analysis.targets.length){
   const fingerprint=JSON.stringify(['id-review-v18-experimental-origins',config.endpoint,config.model,config.provider,config.reviewPosFilter!==false,config.allowModelHanja===true,config.allowModelLoanword===true,config.allowModelSegmentation===true,!!config.disableThinking,config.reasoningEffort]);
   item.reviewFingerprint=fingerprint;
   item.reviewKey=JSON.stringify([localKey,fingerprint,analysis.targets,context]);
   const cached=!bypassCache&&!config.manualReview&&cache.get(item.reviewKey);
   if(cached){item.result=validateChoices(analysis.targets,cached,config);if(progressive)publishModel(item);stats.cacheHits++;diagnostic({stage:'cache',level:'info',message:'使用已验证的模型审核缓存；无需重复请求。'});}
   if(item.result.unresolved.length){pending.push(item);progress.modelTotal+=item.result.unresolved.length;}
  }
 }
 reportProgress();
 const tier=normalizeBatchContextTier(config?.batchContextTier);
 const batches=tier!=='current'?contextReviewBatches(pending,context,{tier,manual:config?.manualReview===true,reviewPosFilter:config?.reviewPosFilter,allowModelHanja:config?.allowModelHanja,allowModelLoanword:config?.allowModelLoanword,allowModelSegmentation:config?.allowModelSegmentation}):config?.manualReview?manualReviewBatches(pending,context,{reviewPosFilter:config?.reviewPosFilter,allowModelHanja:config?.allowModelHanja,allowModelLoanword:config?.allowModelLoanword,allowModelSegmentation:config?.allowModelSegmentation}):sentenceReviewBatches(pending,context);
 const preparedBatches=batches.map((batch,batchIndex)=>{
  const owners=new Map();
  const targets=batch.rows?batch.rows.map(({item,target},i)=>{const id=`b0t${i}`;owners.set(id,{item,target});return {...target,target_id:id};}):batch.items.flatMap((item,i)=>item.result.unresolved.map((target,j)=>{
   const id=`b${i}t${j}`;owners.set(id,{item,target});return {...target,target_id:id};
  }));
  const manualBindings=config.manualReview?targets.map(t=>{const {item,target}=owners.get(t.target_id);return {target_id:t.target_id,sentenceId:item.sentence.id,start:target.start,end:target.end,surface:target.surface,segmentationReview:target.segmentation_review===true,generatedChoices:generatedChoices(target,config),choices:filterReviewTarget(target,config).options.map(option=>({choice_id:option.choice_id,annotations:option.type==='keep'?[]:projectAnnotation(item.sentence.text,{...target,...option,start:target.start,end:target.end,surface:target.surface}).map(({start,end,surface,replacement,type})=>({start,end,surface,replacement,type}))}))};}):undefined;
  const manualPrepared=config.manualReview?prepareManualRequest({...config,manualBindings,batchNumber:batchIndex+1,batchTotal:batches.length,context:batch.context,batchBudget:batch.budget},targets):undefined;
  return {owners,targets,manualBindings,manualPrepared};
 });
 if(config?.manualReview)emit('MANUAL_REVIEW_PLAN',{batches:preparedBatches.map(b=>b.manualPrepared)});
 for(const [batchIndex,batch] of batches.entries()){
  if(batch.budget)diagnostic({stage:'batch-budget',level:'info',message:`${batch.budget.label} 档批次：预估输入 ${batch.budget.inputTokens}、答案 ${batch.budget.outputTokens}、安全余量 ${batch.budget.safetyTokens} tokens。${batch.budget.limitReason==='output'?'本批受答案长度预算限制。':''}`,detail:JSON.stringify(batch.budget)});
  const {owners,targets,manualBindings,manualPrepared}=preparedBatches[batchIndex];
  await reviewTargets({...config,manualBindings,manualPrepared,batchNumber:batchIndex+1,batchTotal:batches.length,batchBudget:batch.budget,operationId:message.operationId,stream:progressive?true:config.stream,timeoutMs:config.timeoutMs||120000,enableModelReview:true,context:batch.context,
   ...(progressive?{onPreview:accepted=>{for(const item of batch.items){const previews=accepted.flatMap(a=>{const owner=owners.get(a.target.target_id);return owner?.item===item?[{target:owner.target,option:a.option}]:[];});publishModel(item,previews,previews.length>0);}}}:{}),
   onAccepted:accepted=>{for(const a of accepted){const owner=owners.get(a.target.target_id);owner.item.result.accepted.push({target:owner.target,option:a.option});}progress.modelCompleted+=accepted.length;reportProgress();for(const item of batch.items)if(progressive)publishModel(item);}
  },targets,signal);
  for(const item of batch.items){
   const answered=new Set(item.result.accepted.map(a=>a.target.target_id));
   item.result.unresolved=item.analysis.targets.filter(t=>!answered.has(t.target_id));
   const effectiveReviewKey=JSON.stringify([item.localKey,item.reviewFingerprint,item.analysis.targets,batch.context]);
   if(!config.manualReview&&item.result.accepted.length)cache.set(effectiveReviewKey,{results:item.result.accepted.map(a=>({target_id:a.target.target_id,choice_id:a.option.choice_id,...(a.option.generated?{replacement:a.option.replacement,confidence:a.option.confidence,evidence:a.option.evidence,...(a.option.segmentationGenerated?{segments:a.option.segments}:{})}:{})}))});
  }
  await persist(cache);
 }
 for(const {sentence,analysis,result} of work){
  const additions=annotationsFromAccepted(sentence.text,result.accepted);
  stats.model_resolved+=result.accepted.filter(a=>a.option.type!=='keep').length;
  stats.model_generated_hanja+=result.accepted.filter(a=>a.option.generated&&a.option.type==='hanja').length+result.accepted.filter(a=>a.option.segmentationGenerated).flatMap(a=>a.option.segments).filter(s=>s.type==='hanja').length;
  stats.model_generated_loanword+=result.accepted.filter(a=>a.option.generated&&a.option.type==='loanword').length+result.accepted.filter(a=>a.option.segmentationGenerated).flatMap(a=>a.option.segments).filter(s=>s.type==='loanword').length;
  stats.model_resegmented+=result.accepted.filter(a=>a.option.segmentationGenerated).length;
  stats.unresolved+=result.unresolved.length+result.accepted.filter(a=>a.option.type==='keep').length;
  if(enabled)emit('RESULTS',{source:'model',replaceModel:true,results:[{id:sentence.id,annotations:additions,reviewed:result.accepted.map(a=>({start:a.target.start,end:a.target.end,surface:a.target.surface}))}]});
 }
 if(stats.model_generated_hanja||stats.model_generated_loanword)diagnostic({stage:'experimental-generation',level:'warning',message:`实验性模型自拟词源：汉字词 ${stats.model_generated_hanja}，外来语 ${stats.model_generated_loanword}。已通过格式和对齐校验，但词源真实性仍需人工核查。`});
 while(cache.size>300)cache.delete(cache.keys().next().value);await persist(cache);
 emit('DONE');return stats;
}

export function sentenceReviewBatches(items,context,{inputBytes=900000,maxTargets=512}={}){
 const bytes=value=>new TextEncoder().encode(value).length;
 const groups=[];let current=[],count=0;
 for(const item of items){
  const n=item.result.unresolved.length;
  if(n>maxTargets)throw Error('单句待审核候选超过单次输出预算；请缩小选区。');
  const trial=[...current,item];
  const ownContext=trial.map(i=>i.sentence.text).join('\n');
  const payload=JSON.stringify(trial.flatMap(i=>i.result.unresolved));
  if(current.length&&(count+n>maxTargets||bytes(payload)+bytes(ownContext)>inputBytes)){groups.push(current);current=[];count=0;}
  current.push(item);count+=n;
 }
 if(current.length)groups.push(current);
 return groups.map(group=>{
  const payload=JSON.stringify(group.flatMap(i=>i.result.unresolved));
  const ownContext=group.map(i=>i.sentence.text).join('\n');
  if(bytes(payload)+bytes(ownContext)>inputBytes)throw Error('单句审核内容超过上下文预算；请缩小选区。');
  return {items:group,context:bytes(payload)+bytes(context)<=inputBytes?context:ownContext};
 });
}

import {analyzeLocal,engineStatus,projectAnnotation,validateAnalysis} from './local-engine.js';
import {filterReviewTarget} from './review-pos.js';
import {canProposeExperimentalOption} from './experimental-options.js';
import {reviewTargets,validateChoices,safeDetail} from './choice-review.js';
import {manualReviewBatches,prepareManualRequest} from './manual-review.js';
import {contextReviewBatches,normalizeBatchContextTier} from './batch-budget.js';
export const CACHE_KEY='kraDictionaryReviewCacheV1Alignment3';
export async function runSentencePipeline(message,post,{signal,analyze=analyzeLocal,status=engineStatus,modelConfig,enabled=false,cache=new Map(),persist=async()=>{}}={}){
 const sentences=message.sentences;
 const selectionReview=message.reviewAll===true;
 const reviewAll=selectionReview || message.reviewAllCandidates===true;
 const smartSegmentation=message.smartSegmentation===true && enabled;
 const reviewLocalConversions=!reviewAll&&(message.reviewLocalConversions===true||smartSegmentation);
 const bypassCache=selectionReview || message.forceRegenerate;
 enabled=enabled || reviewAll || smartSegmentation;
 if(typeof message.operationId!=='string'||!message.operationId||!Array.isArray(sentences)||!sentences.length||sentences.length>20000||sentences.some(s=>typeof s.id!=='string'||!s.id||typeof s.text!=='string'||!s.text||s.text.length>20000)||new Set(sentences.map(s=>s.id)).size!==sentences.length)throw Error('Invalid sentence operation');
 const modes={hanja:!!message.modes?.hanja,loanword:!!message.modes?.loanword,nameProtection:message.nameProtection!==false,filterDictionaryPeople:message.filterDictionaryPeople!==false,experimentalLoanwordAudit:message.experimentalLoanwordAudit===true&&enabled&&!!message.modes?.loanword,experimentalHanjaAudit:message.experimentalHanjaAudit===true&&enabled&&!!message.modes?.hanja};if(!modes.hanja&&!modes.loanword)throw Error('Enable an annotation mode');
 const stats={model_accepted:0,model_keep:0,model_literal_origins:0,repair_applied:0,repair_rejected:0,repair_offset_corrected:0,local_determined:0,pending:0,model_resolved:0,unresolved:0,structural_rejections:0,rejected_options:0,skipped_mixed:0,protected_names:0,cacheHits:0,upstream_converted:0,upstream_ambiguous:0,upstream_no_match:0,upstream_kept:0};
 const totalSentences=sentences.length;let completedSentences=0;let identity;
 const emit=(type,extra={})=>{signal?.throwIfAborted();post({type,operationId:message.operationId,...(smartSegmentation?{smartSegmentation:true}:{}),engine_version:identity?.engine_version,dictionary_fingerprint:identity?.dictionary_fingerprint,dictionary_metadata:identity?.dictionary_metadata,...extra,stats:{...stats},completedSentences,totalSentences,percent:Math.round(completedSentences/totalSentences*100)});};
 const loading=progress=>emit('LOCAL_PROGRESS',progress);
 // Only the engine may report a dictionary initialization event.
 // A cached or already-warm status lookup must not impersonate a full reload.
 identity=await status(signal,loading);
 const dictionaryFree=identity.dictionary_free===true;
 if(dictionaryFree&&!enabled)throw Error('无词典模式必须启用模型审核与实验性汉字词或外来语补全。');
 const work=[];
 const diagnostic=d=>emit('DIAGNOSTIC',{diagnostic:d});
 const dictionary=identity.dictionary_metadata||{};
 diagnostic({stage:'dictionary',level:'info',message:dictionaryFree?'未导入外部词典：Kiwi 生成待审核词，由实验性 LLM 补全词源；本地不自动转换。':'当前使用的本机词典与引擎。',detail:JSON.stringify({source_filename:dictionary.source_filename||'未知',data_version:dictionary.data_version||'未知',total_entries:dictionary.total_entries??'未知',total_senses:dictionary.total_senses??'未知',engine_version:identity.engine_version,dictionary_fingerprint:identity.dictionary_fingerprint})});
 let hasOriginalCounts=false;
 for(const sentence of sentences){
  signal?.throwIfAborted();
  const currentSentence=completedSentences+1;
  const progress=detail=>loading({...detail,currentSentence,sentenceCharacters:sentence.text.length});
  progress({stage:'analysis'});
  const localKey=JSON.stringify([...(smartSegmentation?['dictionary-v6-smart-segmentation-person-filter',true]:['dictionary-v5-strict-person-filter']),
   reviewAll,identity.engine_version,identity.dictionary_fingerprint,modes,sentence.text,...(reviewLocalConversions?['review-local-conversions-v1']:[])]);
  let analysis=!bypassCache&&cache.get(localKey);
  if(analysis){analysis=validateAnalysis(sentence.text,analysis);stats.cacheHits++;}else {analysis=validateAnalysis(sentence.text,await analyze(sentence.text,reviewAll?{...modes,reviewAll:true,smartSegmentation}:reviewLocalConversions?{...modes,reviewLocalConversions:true,smartSegmentation}: {...modes,smartSegmentation},signal,progress));if(analysis.engine_version!==identity.engine_version||analysis.dictionary_fingerprint!==identity.dictionary_fingerprint)throw Error('Dictionary changed during operation');cache.set(localKey,analysis);}
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
  for(const name of ['local_determined','pending','structural_rejections','rejected_options','skipped_mixed','protected_names','upstream_converted','upstream_ambiguous','upstream_no_match','upstream_kept'])stats[name]+=Number(analysis.stats[name]||0);
  hasOriginalCounts ||= Number.isInteger(analysis.stats.upstream_converted);
  completedSentences++;emit('RESULTS',{source:'local',results:[{id:sentence.id,annotations:analysis.annotations}]});
  // Supplemental text never enters local analysis or changes source offsets.
  if(sentence.adjacentContext){
   const {before,after}=sentence.adjacentContext;
   if(typeof before!=='string'||typeof after!=='string'||before.length>1000||after.length>1000)throw Error('Invalid adjacent context');
   if(before||after)analysis={...analysis,targets:analysis.targets.map(t=>({...t,adjacent_context:{before,after}}))};
  }
  if(smartSegmentation&&analysis.targets.length===0&&/[가-힣]/u.test(sentence.text)&&
    (message.restrictToSelection!==true||sentence.selected?.some(r=>r.start<r.end))){
   const scan={target_id:'scan-only',start:0,end:sentence.text.length,
    surface:sentence.text,context:sentence.text,scan_only:true,
    options:[{choice_id:'KEEP',type:'keep',replacement:sentence.text,entry_id:null,definitions:[]}]};
   analysis={...analysis,targets:[scan]};
  }
  if(smartSegmentation)analysis={...analysis,targets:analysis.targets.map(t=>({...t,repair_sentence_key:sentence.id,
   repair_context:analysis.repair_context||{kiwi_tokens:[],protected_ranges:[]}}))};
  work.push({sentence,analysis,localKey,repairs:[]});
 }
 if(stats.protected_names)diagnostic({stage:'rules',level:'info',message:`已按完整名称范围保留 ${stats.protected_names} 处疑似姓名，未使用内部普通词义替换。`,detail:JSON.stringify({protected_names:stats.protected_names})});
 if(hasOriginalCounts)diagnostic({stage:'rules',level:'info',message:`原作者规则：自动转换 ${stats.upstream_converted}，歧义 ${stats.upstream_ambiguous}，未匹配 ${stats.upstream_no_match}；本地标注 ${stats.local_determined}，待审核 ${stats.pending}。`,detail:JSON.stringify({upstream_converted:stats.upstream_converted,upstream_ambiguous:stats.upstream_ambiguous,upstream_no_match:stats.upstream_no_match,upstream_kept:stats.upstream_kept,local_determined:stats.local_determined,pending:stats.pending,structural_rejections:stats.structural_rejections,rejected_options:stats.rejected_options,skipped_mixed:stats.skipped_mixed})});
 let config;
 if(enabled && work.some(w=>w.analysis.targets.length)){
  try{config=await modelConfig();if(!config)throw Error('没有可用模型配置');}
  catch(error){config=null;diagnostic({stage:'configuration',level:'error',message:`模型配置不可用：${error.message}`});}
 }else diagnostic({stage:'skipped',level:'info',message:enabled?'没有待审核候选，本次无需调用模型。':'模型审核开关关闭，仅使用本地词典规则。'});
 if(config){const upstreamDiagnostic=config.onDiagnostic;config={...config,onDiagnostic:d=>{upstreamDiagnostic?.(d);diagnostic({...d,message:safeDetail(d.message,config),detail:safeDetail(d.detail,config)});}};}

 const experimental=!!(config?.experimentalHanja&&modes.hanja||config?.experimentalLoanword&&modes.loanword);
 if(config)config={...config,smartSegmentation:smartSegmentation&&config.smartSegmentation===true,experimentalHanja:experimental&&config.experimentalHanja===true&&modes.hanja,experimentalLoanword:experimental&&config.experimentalLoanword===true&&modes.loanword,hanjaReadingCheck:config.hanjaReadingCheck!==false,dictionaryFree,repairModes:{hanja:modes.hanja,loanword:modes.loanword}};
 const context=message.context || sentences.map(s=>s.text).join('\n');
 const progressive=message.progressiveAnnotation===true;
 const lastPublished=new Map();
 const publishModel=(item,preview=[],provisional=false)=>{
  const suppressed=new Set((item.repairs||[]).flatMap(r=>r.source_target_ids));
  const accepted=[...item.result.accepted,...preview].filter(a=>!a.target.scan_only&&!suppressed.has(a.target.target_id));
  const additions=[...accepted.filter(a=>a.option.type!=='keep').flatMap(a=>projectAnnotation(item.sentence.text,{...a.target,...a.option,start:a.target.start,end:a.target.end,surface:a.target.surface,context:a.target.context})),...(item.repairs||[]).flatMap(r=>r.annotations)];
  const reviewed=[...accepted.map(a=>({start:a.target.start,end:a.target.end,surface:a.target.surface})),
   ...(item.repairs||[]).flatMap(r=>[
    ...r.source_target_ids.flatMap(id=>item.analysis.targets.filter(t=>t.target_id===id).map(t=>({start:t.start,end:t.end,surface:t.surface}))),
    {start:r.start,end:r.end,surface:r.surface}
   ])];
  const signature=JSON.stringify([additions,reviewed,provisional]);
  if(lastPublished.get(item)===signature||(!accepted.length&&!item.repairs?.length&&!lastPublished.has(item)))return;lastPublished.set(item,signature);
  emit('RESULTS',{source:'model',replaceModel:true,provisional,results:[{id:item.sentence.id,annotations:additions,reviewed}]});
 };
 const pending=[];
 const progress={modelCompleted:0,modelTotal:0};
 const reportProgress=()=>emit('MODEL_PROGRESS',{...progress,modelPercent:progress.modelTotal?Math.round(100*progress.modelCompleted/progress.modelTotal):100});
 for(const item of work){
  const {analysis,localKey}=item;
  item.result={accepted:[],unresolved:analysis.targets};
  if(config && analysis.targets.length){
   const fingerprint=JSON.stringify([config.hanjaReadingCheck!==false,smartSegmentation?'id-review-v21-single-pass-segmentation-repair':experimental?'id-review-v20-literal-origin-choice':'id-review-v17-chunk-context',config.endpoint,config.model,config.provider,config.reviewPosFilter!==false,!!config.disableThinking,config.reasoningEffort,...(experimental?[!!config.experimentalHanja,!!config.experimentalLoanword]:[])]);
   item.reviewFingerprint=fingerprint;
   item.reviewKey=JSON.stringify([localKey,fingerprint,analysis.targets,context]);
   const cached=!experimental&&!smartSegmentation&&!bypassCache&&!config.manualReview&&cache.get(item.reviewKey);
   if(cached){item.result=validateChoices(analysis.targets,cached,config);if(progressive)publishModel(item);stats.cacheHits++;diagnostic({stage:'cache',level:'info',message:'使用已验证的模型审核缓存；无需重复请求。'});}
   if(item.result.unresolved.length){pending.push(item);progress.modelTotal+=item.result.unresolved.length;}
  }
 }
 reportProgress();
 const tier=normalizeBatchContextTier(config?.batchContextTier);
 const batches=tier!=='current'?contextReviewBatches(pending,context,{tier,manual:config?.manualReview===true,reviewPosFilter:config?.reviewPosFilter,experimentalHanja:config?.experimentalHanja,experimentalLoanword:config?.experimentalLoanword,dictionaryFree,smartSegmentation:config?.smartSegmentation,manualOutputTokenLimit:config?.manualOutputTokenLimit,apiOutputTokenLimit:config?.apiOutputTokenLimit}):config?.manualReview?manualReviewBatches(pending,context,{reviewPosFilter:config?.reviewPosFilter,experimentalHanja:config?.experimentalHanja,experimentalLoanword:config?.experimentalLoanword,dictionaryFree,smartSegmentation:config?.smartSegmentation}):sentenceReviewBatches(pending,context);
 const preparedBatches=batches.map((batch,batchIndex)=>{
  const owners=new Map();
  const targetWire=(id,item,target)=>{
   owners.set(id,{item,target});
   return {...target,target_id:id,
    ...(smartSegmentation?{
     original_target_id:target.target_id,
     repair_sentence_key:item.sentence.id,
     repair_context:item.analysis.repair_context||{kiwi_tokens:[],protected_ranges:[]}
    }:{})};
  };
  const targets=batch.rows?batch.rows.map(({item,target},i)=>targetWire(`b0t${i}`,item,target)):
   batch.items.flatMap((item,i)=>item.result.unresolved.map((target,j)=>targetWire(`b${i}t${j}`,item,target)));
  const repairScopes=new Map();
  if(smartSegmentation)for(const [id,{item}] of owners){
   repairScopes.set(id,{
    text:item.sentence.text,
    allTargets:item.analysis.targets.filter(t=>!t.scan_only),
    localAnnotations:item.analysis.annotations,
    protected_ranges:item.analysis.repair_context?.protected_ranges||[],
    selected:message.restrictToSelection===true?item.sentence.selected||[]:null,
    existingRepairs:item.repairs
   });
  }
  const manualBindings=config.manualReview?targets.map(t=>{
   const {item,target}=owners.get(t.target_id);
   const options=filterReviewTarget(target,config).options;
   return {target_id:t.target_id,sentenceId:item.sentence.id,start:target.start,end:target.end,surface:target.surface,
    choices:options.map(option=>({choice_id:option.choice_id,annotations:option.type==='keep'?[]:projectAnnotation(item.sentence.text,{...target,...option,start:target.start,end:target.end,surface:target.surface}).map(({start,end,surface,replacement,type})=>({start,end,surface,replacement,type}))})),
    ...(target.dictionary_person_name===true&&target.verified_person_hanja?.length?{dictionaryPersonHanja:[...target.verified_person_hanja]}:{}),
    ...((config.experimentalHanja===true||config.experimentalLoanword===true)?{literalOrigin:{
     hanja:config.experimentalHanja===true,loanword:config.experimentalLoanword===true,
     eligible:(config.experimentalHanja===true&&canProposeExperimentalOption(target,'hanja'))||(config.experimentalLoanword===true&&canProposeExperimentalOption(target,'loanword')),
     hanjaEligible:config.experimentalHanja===true&&canProposeExperimentalOption(target,'hanja'),
     loanwordEligible:config.experimentalLoanword===true&&canProposeExperimentalOption(target,'loanword'),
     known:options.filter(o=>o.type==='hanja'||o.type==='loanword').map(o=>({type:o.type,replacement:o.replacement})),
      morphology:target.morphology||[]
    }}:{})};
  }):undefined;
  const manualPrepared=config.manualReview?prepareManualRequest({...config,manualBindings,batchNumber:batchIndex+1,batchTotal:batches.length,context:batch.context,batchBudget:batch.budget},targets):undefined;
  return {owners,targets,repairScopes,manualBindings,manualPrepared};
 });
 if(config?.manualReview)emit('MANUAL_REVIEW_PLAN',{batches:preparedBatches.map(b=>b.manualPrepared)});
 for(const [batchIndex,batch] of batches.entries()){
  if(batch.budget)diagnostic({stage:'batch-budget',level:'info',message:`${batch.budget.label} 档批次：预估输入 ${batch.budget.inputTokens}、答案 ${batch.budget.outputTokens}、输出上限 ${batch.budget.outputLimit}、安全余量 ${batch.budget.safetyTokens} tokens。${batch.budget.limitReason==='output'?'本批受答案长度预算限制。':''}`,detail:JSON.stringify(batch.budget)});
  const {owners,targets,repairScopes,manualBindings,manualPrepared}=preparedBatches[batchIndex];
  const firstReview=await reviewTargets({...config,repairScopes,manualBindings,manualPrepared,batchNumber:batchIndex+1,batchTotal:batches.length,batchBudget:batch.budget,operationId:message.operationId,stream:progressive?true:config.stream,timeoutMs:config.timeoutMs||120000,enableModelReview:true,context:batch.context,
   ...(progressive&&!smartSegmentation?{onPreview:accepted=>{for(const item of batch.items){const previews=accepted.flatMap(a=>{const owner=owners.get(a.target.target_id);return owner?.item===item?[{target:owner.target,option:a.option}]:[];});publishModel(item,previews,previews.length>0);}}}:{}),
   onAccepted:accepted=>{
    for(const a of accepted){
     const owner=owners.get(a.target.target_id);
     if(owner)owner.item.result.accepted.push({target:owner.target,option:a.option});
    }
    stats.model_accepted+=accepted.length;
     stats.model_keep+=accepted.filter(a=>a.option.type==='keep').length;
     stats.model_literal_origins+=accepted.filter(a=>String(a.option.entry_id||'').startsWith('experimental:')).length;
     progress.modelCompleted+=accepted.length;reportProgress();
    if(!smartSegmentation)for(const item of batch.items)if(progressive)publishModel(item);
   },
   ...(smartSegmentation?{onRepairRejected:count=>{stats.repair_rejected+=count;},onRepairOffsetCorrected:count=>{stats.repair_offset_corrected+=count;},onRepairs:repairs=>{
    for(const repair of repairs){
     const owner=[...owners.values()].find(({item})=>item.sentence.id===repair.sentenceKey);
     if(owner){owner.item.repairs.push(repair);stats.repair_applied++;}
     else{stats.repair_rejected++;diagnostic({stage:'segmentation',level:'warning',message:'修复对应的原文段落已变化，安全跳过。'});}
    }
    if(progressive)for(const item of batch.items)publishModel(item);
   }}:{})
  },targets,signal);

  for(const item of batch.items){
   const answered=new Set(item.result.accepted.map(a=>a.target.target_id));
   const retired=new Set((item.repairs||[]).flatMap(r=>r.source_target_ids));
   item.result.unresolved=item.analysis.targets.filter(t=>
     !answered.has(t.target_id)&&!retired.has(t.target_id)&&!t.scan_only);
   const effectiveReviewKey=JSON.stringify([item.localKey,item.reviewFingerprint,item.analysis.targets,batch.context]);
   if(!experimental&&!smartSegmentation&&!config.manualReview&&item.result.accepted.length)cache.set(effectiveReviewKey,{results:item.result.accepted.map(a=>({t:a.target.target_id,c:a.option.type==='keep'?null:a.option.choice_id}))});
  }
  await persist(cache);
 }
 for(const item of work){
  const {sentence,analysis,result}=item;
  const replaced=new Set((item.repairs||[]).flatMap(r=>r.source_target_ids));
  const valid=result.accepted.filter(a=>!a.target.scan_only&&!replaced.has(a.target.target_id));
  const additions=[...valid.filter(a=>a.option.type!=='keep').flatMap(a=>projectAnnotation(sentence.text,{...a.target,...a.option,start:a.target.start,end:a.target.end,surface:a.target.surface,context:a.target.context})),
   ...(item.repairs||[]).flatMap(r=>r.annotations)];
  const reviewed=[...valid.map(a=>({start:a.target.start,end:a.target.end,surface:a.target.surface})),
   ...(item.repairs||[]).flatMap(r=>[
    ...r.source_target_ids.flatMap(id=>analysis.targets.filter(t=>t.target_id===id).map(t=>({start:t.start,end:t.end,surface:t.surface}))),
    {start:r.start,end:r.end,surface:r.surface}
   ])];
  stats.model_resolved+=valid.filter(a=>a.option.type!=='keep').length+(item.repairs||[]).filter(r=>r.annotations.length).length;
  stats.unresolved+=result.unresolved.filter(t=>!t.scan_only&&!replaced.has(t.target_id)).length+valid.filter(a=>a.option.type==='keep').length;
  if(enabled)emit('RESULTS',{source:'model',replaceModel:true,results:[{id:sentence.id,annotations:additions,reviewed}]});
 }
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

import {analyzeLocal,engineStatus,projectAnnotation,validateAnalysis} from './local-engine.js';
import {reviewTargets,validateChoices,safeDetail} from './choice-review.js';
export const CACHE_KEY='kraDictionaryReviewCacheV1';
export async function runSentencePipeline(message,post,{signal,analyze=analyzeLocal,status=engineStatus,modelConfig,enabled=false,cache=new Map(),persist=async()=>{}}={}){
 const sentences=message.sentences;
 const reviewAll=message.reviewAll===true;
 const bypassCache=reviewAll || message.forceRegenerate;
 enabled=enabled || reviewAll;
 if(typeof message.operationId!=='string'||!message.operationId||!Array.isArray(sentences)||!sentences.length||sentences.length>5000||sentences.some(s=>typeof s.id!=='string'||!s.id||typeof s.text!=='string'||!s.text||s.text.length>20000)||new Set(sentences.map(s=>s.id)).size!==sentences.length)throw Error('Invalid sentence operation');
 const modes={hanja:!!message.modes?.hanja,loanword:!!message.modes?.loanword};if(!modes.hanja&&!modes.loanword)throw Error('Enable an annotation mode');
 const stats={local_determined:0,pending:0,model_resolved:0,unresolved:0,structural_rejections:0,skipped_mixed:0,cacheHits:0,upstream_converted:0,upstream_ambiguous:0,upstream_no_match:0,upstream_kept:0};
 const totalSentences=sentences.length;let completedSentences=0;let identity;
 const emit=(type,extra={})=>{signal?.throwIfAborted();post({type,operationId:message.operationId,engine_version:identity?.engine_version,dictionary_fingerprint:identity?.dictionary_fingerprint,dictionary_metadata:identity?.dictionary_metadata,...extra,stats:{...stats},completedSentences,totalSentences,percent:Math.round(completedSentences/totalSentences*100)});};
 identity=await status(signal);const work=[];
 const diagnostic=d=>emit('DIAGNOSTIC',{diagnostic:d});
 const dictionary=identity.dictionary_metadata||{};
 diagnostic({stage:'dictionary',level:'info',message:'当前使用的本机词典与引擎。',detail:JSON.stringify({source_filename:dictionary.source_filename||'未知',data_version:dictionary.data_version||'未知',total_entries:dictionary.total_entries??'未知',total_senses:dictionary.total_senses??'未知',engine_version:identity.engine_version,dictionary_fingerprint:identity.dictionary_fingerprint})});
 let hasOriginalCounts=false;
 for(const sentence of sentences){
  signal?.throwIfAborted();
  const localKey=JSON.stringify(['dictionary-v2',reviewAll,identity.engine_version,identity.dictionary_fingerprint,modes,sentence.text]);
  let analysis=!bypassCache&&cache.get(localKey);
  if(analysis){analysis=validateAnalysis(sentence.text,analysis);stats.cacheHits++;}else {analysis=validateAnalysis(sentence.text,await analyze(sentence.text,reviewAll?{...modes,reviewAll:true}:modes,signal));if(analysis.engine_version!==identity.engine_version||analysis.dictionary_fingerprint!==identity.dictionary_fingerprint)throw Error('Dictionary changed during operation');cache.set(localKey,analysis);}
  if(reviewAll){
   if(analysis.annotations.length)throw Error('模型重审不允许使用本地直接标注结果。');
   if(!Array.isArray(sentence.selected))throw Error('模型重审需要有效选区。');
   analysis={...analysis,targets:analysis.targets.filter(t=>sentence.selected.some(r=>Number.isInteger(r.start)&&Number.isInteger(r.end)&&t.start>=r.start&&t.end<=r.end))};
   analysis.stats={...analysis.stats,pending:analysis.targets.length};
  }
  for(const warning of analysis.diagnostics||[])diagnostic(warning);
  for(const name of ['local_determined','pending','structural_rejections','skipped_mixed','upstream_converted','upstream_ambiguous','upstream_no_match','upstream_kept'])stats[name]+=Number(analysis.stats[name]||0);
  hasOriginalCounts ||= Number.isInteger(analysis.stats.upstream_converted);
  completedSentences++;emit('RESULTS',{source:'local',results:[{id:sentence.id,annotations:analysis.annotations}]});
  work.push({sentence,analysis,localKey});
 }
 if(hasOriginalCounts)diagnostic({stage:'rules',level:'info',message:`原作者规则：自动转换 ${stats.upstream_converted}，歧义 ${stats.upstream_ambiguous}，未匹配 ${stats.upstream_no_match}；本地标注 ${stats.local_determined}，待审核 ${stats.pending}。`,detail:JSON.stringify({upstream_converted:stats.upstream_converted,upstream_ambiguous:stats.upstream_ambiguous,upstream_no_match:stats.upstream_no_match,upstream_kept:stats.upstream_kept,local_determined:stats.local_determined,pending:stats.pending,structural_rejections:stats.structural_rejections,skipped_mixed:stats.skipped_mixed})});
 let config;
 if(enabled && work.some(w=>w.analysis.targets.length)){
  try{config=await modelConfig();if(!config)throw Error('没有可用模型配置');}
  catch(error){config=null;diagnostic({stage:'configuration',level:'error',message:`模型配置不可用：${error.message}`});}
 }else diagnostic({stage:'skipped',level:'info',message:enabled?'没有待审核候选，本次无需调用模型。':'模型审核开关关闭，仅使用本地词典规则。'});
 if(config){const upstreamDiagnostic=config.onDiagnostic;config={...config,onDiagnostic:d=>{upstreamDiagnostic?.(d);diagnostic({...d,message:safeDetail(d.message,config),detail:safeDetail(d.detail,config)});}};}

 const context=message.context || sentences.map(s=>s.text).join('\n');
 const pending=[];
 const progress={modelCompleted:0,modelTotal:0};
 const reportProgress=()=>emit('MODEL_PROGRESS',{...progress,modelPercent:progress.modelTotal?Math.round(100*progress.modelCompleted/progress.modelTotal):100});
 for(const item of work){
  const {analysis,localKey}=item;
  item.result={accepted:[],unresolved:analysis.targets};
  if(config && analysis.targets.length){
   const fingerprint=JSON.stringify(['id-review-v4',config.endpoint,config.model,config.provider,!!config.disableThinking,config.reasoningEffort]);
   item.reviewFingerprint=fingerprint;
   item.reviewKey=JSON.stringify([localKey,fingerprint,analysis.targets,context]);
   const cached=!bypassCache&&cache.get(item.reviewKey);
   if(cached){item.result=validateChoices(analysis.targets,cached);stats.cacheHits++;diagnostic({stage:'cache',level:'info',message:'使用已验证的模型审核缓存；无需重复请求。'});}
   if(item.result.unresolved.length){pending.push(item);progress.modelTotal+=item.result.unresolved.length;}
  }
 }
 reportProgress();
 // Keep all targets of a sentence together. Byte count is a conservative input
 // bound for the assumed 1M-token context; reserve capacity for output.
 for(const batch of sentenceReviewBatches(pending,context)){
  const owners=new Map();
  const targets=batch.items.flatMap((item,i)=>item.result.unresolved.map((target,j)=>{
   const id=`b${i}t${j}`;owners.set(id,{item,target});return {...target,target_id:id};
  }));
  const result=await reviewTargets({...config,timeoutMs:config.timeoutMs||120000,enableModelReview:true,context:batch.context,onAccepted:accepted=>{progress.modelCompleted+=accepted.length;reportProgress();}},targets,signal);
  for(const accepted of result.accepted){const owner=owners.get(accepted.target.target_id);owner.item.result.accepted.push({target:owner.target,option:accepted.option});}
  for(const item of batch.items){
   const answered=new Set(item.result.accepted.map(a=>a.target.target_id));
   item.result.unresolved=item.analysis.targets.filter(t=>!answered.has(t.target_id));
   const effectiveReviewKey=JSON.stringify([item.localKey,item.reviewFingerprint,item.analysis.targets,batch.context]);
   if(item.result.accepted.length)cache.set(effectiveReviewKey,{results:item.result.accepted.map(a=>({target_id:a.target.target_id,choice_id:a.option.choice_id}))});
  }
  await persist(cache);
 }
 for(const {sentence,analysis,result} of work){
  const additions=result.accepted.filter(a=>a.option.type!=='keep').flatMap(a=>projectAnnotation(sentence.text,{...a.target,...a.option,start:a.target.start,end:a.target.end,surface:a.target.surface,context:a.target.context}));
  stats.model_resolved+=result.accepted.filter(a=>a.option.type!=='keep').length;
  stats.unresolved+=result.unresolved.length+result.accepted.filter(a=>a.option.type==='keep').length;
  if(enabled)emit('RESULTS',{source:'model',results:[{id:sentence.id,annotations:additions,...(reviewAll?{reviewed:result.accepted.map(a=>({start:a.target.start,end:a.target.end,surface:a.target.surface}))}:{})}]});
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

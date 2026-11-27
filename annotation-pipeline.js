import {analyzeLocal,engineStatus,projectAnnotation,validateAnalysis} from './local-engine.js';
import {extractInlineHanjaPairs,applyInlineHanjaAnnotations} from './inline-hanja-evidence.js';
import {createSessionHanjaGlossary,learnSessionHanjaGlossary,applySessionHanjaGlossary} from './session-hanja-glossary.js';
import {protectRepeatedArticleNames} from './article-name-consistency.js';
import {filterReviewTarget} from './review-pos.js';
import {canProposeExperimentalOption} from './experimental-options.js';
import {reviewTargets,safeDetail} from './choice-review.js';
import {articleCacheScope,createArticleReviewLookup,paragraphReviewKey,snapshotParagraphReview,restoreParagraphReview} from './review-cache.js';
import {manualReviewBatches,prepareManualRequest} from './manual-review.js';
import {contextReviewBatches,normalizeBatchContextTier} from './batch-budget.js';
import {compactDomAnnotations,shouldPublishPreview,createOrderedResultRelay} from './annotation-event.js';
export const CACHE_KEY='kraDictionaryReviewCacheV1Alignment4';
export async function runSentencePipeline(message,post,{signal,analyze=analyzeLocal,analyzeBatch=null,status=engineStatus,modelConfig,enabled=false,cache=new Map(),persist=async()=>{},waitForUnfinishedReview=null,continuationModelConfig=null}={}){
 const sentences=message.sentences;
 const selectionReview=message.reviewAll===true;
 const reviewAll=selectionReview || message.reviewAllCandidates===true;
 const smartSegmentation=message.smartSegmentation===true && enabled;
 const reviewLocalConversions=!reviewAll&&(message.reviewLocalConversions===true||smartSegmentation);
 const bypassCache=selectionReview || message.forceRegenerate;
 enabled=enabled || reviewAll || smartSegmentation;
 if(typeof message.operationId!=='string'||!message.operationId||!Array.isArray(sentences)||!sentences.length||sentences.length>20000||sentences.some(s=>typeof s.id!=='string'||!s.id||typeof s.text!=='string'||!s.text||s.text.length>20000)||new Set(sentences.map(s=>s.id)).size!==sentences.length)throw Error('Invalid sentence operation');
 const modes={hanja:!!message.modes?.hanja,loanword:!!message.modes?.loanword,nameProtection:message.nameProtection!==false,filterDictionaryPeople:message.filterDictionaryPeople!==false,reviewPosFilter:message.reviewPosFilter!==false,experimentalLoanwordAudit:message.experimentalLoanwordAudit===true&&enabled&&!!message.modes?.loanword,experimentalHanjaAudit:message.experimentalHanjaAudit===true&&enabled&&!!message.modes?.hanja};if(!modes.hanja&&!modes.loanword)throw Error('Enable an annotation mode');
 const outcomeSamples={nonconversion:[],invalidChoiceFallback:[],zeroProjection:[]};
 const hanjaRejectionReasons={},hanjaRejectionSamples=[],hanjaSentIds=new Set();
 const stats={model_accepted:0,model_keep:0,model_nonconversion:0,model_invalid_choice_fallback:0,model_conversion_choices:0,model_projected_fragments:0,model_zero_projection:0,session_hanja_glossary_terms:0,session_hanja_glossary_variants:0,session_hanja_glossary_conflicts:0,session_hanja_new_targets:0,session_hanja_new_choices:0,session_hanja_enhanced_choices:0,session_hanja_skipped:0,inline_hanja_pairs_found:0,inline_hanja_local_converted:0,inline_hanja_reused:0,inline_hanja_removed_targets:0,inline_hanja_pairs_skipped:0,model_literal_origins:0,experimental_hanja_audit_generated:0,experimental_hanja_audit_retained:0,experimental_hanja_audit_filtered:0,experimental_loanword_audit_generated:0,experimental_loanword_audit_retained:0,experimental_hanja_audit_reviewable:0,experimental_hanja_audit_sent:0,experimental_hanja_audit_request_occurrences:0,model_direct_hanja_proposed:0,model_direct_hanja_accepted:0,model_direct_hanja_rejected:0,model_direct_hanja_reading_rejected:0,model_direct_hanja_boundary_rejected:0,model_direct_hanja_name_rejected:0,model_direct_hanja_conflict_rejected:0,repair_applied:0,repair_rejected:0,repair_offset_corrected:0,local_determined:0,pending:0,model_resolved:0,unresolved:0,model_unanswered:0,structural_rejections:0,rejected_options:0,upstream_alignment_pruned:0,skipped_mixed:0,protected_names:0,cacheHits:0,localCacheHits:0,modelCacheHits:0,modelCachedTargets:0,upstream_converted:0,upstream_ambiguous:0,upstream_no_match:0,upstream_kept:0};
 const totalSentences=sentences.length;let completedSentences=0;let identity;
 const sendResult=createOrderedResultRelay(post);
 const emit=(type,extra={})=>{signal?.throwIfAborted();return sendResult({type,operationId:message.operationId,...(smartSegmentation?{smartSegmentation:true}:{}),engine_version:identity?.engine_version,dictionary_fingerprint:identity?.dictionary_fingerprint,dictionary_metadata:identity?.dictionary_metadata,...extra,stats:{...stats},completedSentences,totalSentences,percent:Math.round(completedSentences/totalSentences*100)});};
 const loading=progress=>emit('LOCAL_PROGRESS',progress);
 // Only the engine may report a dictionary initialization event.
 // A cached or already-warm status lookup must not impersonate a full reload.
 identity=await status(signal,loading);
 const dictionaryFree=identity.dictionary_free===true;
 if(dictionaryFree&&!enabled)throw Error('无词典模式必须启用模型审核与实验性汉字词或外来语补全。');
 // Start with no learned source pairs. A pair is acquired ONLY after its
 // original paragraph is analyzed; earlier paragraphs never see it.
 // Keep full context for the ordinary model, but do NOT mine it for Hanja.
 const context=message.context||sentences.map(s=>s.text).join('\n');
 const sessionGlossary=enabled&&modes.hanja?createSessionHanjaGlossary():null;
 const work=[];
 const diagnostic=d=>emit('DIAGNOSTIC',{diagnostic:d});
 const dictionary=identity.dictionary_metadata||{};
 diagnostic({stage:'dictionary',level:'info',message:dictionaryFree?'未导入外部词典：Kiwi 生成待审核词，由实验性 LLM 补全词源；本地不自动转换。':'当前使用的本机词典与引擎。',detail:JSON.stringify({source_filename:dictionary.source_filename||'未知',data_version:dictionary.data_version||'未知',total_entries:dictionary.total_entries??'未知',total_senses:dictionary.total_senses??'未知',engine_version:identity.engine_version,dictionary_fingerprint:identity.dictionary_fingerprint})});
 let hasOriginalCounts=false;
 const localStageStarted=Date.now();let slowestSentenceMs=0,slowestSentenceId='',slowestSentenceChars=0;
 // Small batches eliminate repeated background/offscreen/worker/Pyodide hops.
 // Neither Kiwi word boundaries nor per-paragraph candidates are merged.
 const MAX_BATCH_PARAGRAPHS=12,MAX_BATCH_CHARS=48000;
 const prefetched=new Map();let batchCalls=0,batchRequestMs=0;
 const phaseTotals={};const slowestParagraphs=[];const earlyAlignmentSamples=[];
 const localModes=reviewAll?{...modes,reviewAll:true,smartSegmentation}:
   reviewLocalConversions?{...modes,reviewLocalConversions:true,smartSegmentation}:{...modes,smartSegmentation};
 const cacheKeyFor=text=>JSON.stringify([...(smartSegmentation?['dictionary-v7-hanja-audit-survival-smart',true]:['dictionary-v7-hanja-audit-survival']),
   reviewAll,identity.engine_version,identity.dictionary_fingerprint,modes,text,...(reviewLocalConversions?['review-local-conversions-v1']:[])]);
 function profile(analysis){
  for(const [stage,value] of Object.entries(analysis.stats?.timings_ms||{}))
   if(Number.isFinite(value))phaseTotals[stage]=(phaseTotals[stage]||0)+value;
 }
 async function prefetchBatch(start,progress){
  if(!analyzeBatch)return;
  const upcoming=[];let chars=0;
  for(let j=start;j<sentences.length&&upcoming.length<MAX_BATCH_PARAGRAPHS;j++){
   const next=sentences[j];
   if(!bypassCache&&cache.has(cacheKeyFor(next.text)))break;
   if(upcoming.length&&chars+next.text.length>MAX_BATCH_CHARS)break;
   upcoming.push(next);chars+=next.text.length;
  }
  if(upcoming.length<2)return;
  const texts=[...new Set(upcoming.map(next=>next.text))];
  // A batch is NOT a single paragraph: report its complete range/character
  // count while the actual computation is in flight, not its first member.
  loading({stage:'analysis-batch',batchStart:start+1,batchEnd:start+upcoming.length,
   batchParagraphs:upcoming.length,batchCharacters:chars,batchUniqueParagraphs:texts.length});
  const firstSourceIndex=new Map();
  for(let j=0;j<upcoming.length;j++)if(!firstSourceIndex.has(upcoming[j].text))
   firstSourceIndex.set(upcoming[j].text,j);
  const relay=detail=>{
   if(['analysis-paragraph','analysis-phase'].includes(detail?.stage)){
    const index=Number.isInteger(detail.batchIndex)?detail.batchIndex-1:0;
    const sourceOffset=firstSourceIndex.get(texts[index])??0;
    loading({...detail,batchStart:start+1,batchEnd:start+upcoming.length,
     batchParagraphs:upcoming.length,batchCharacters:chars,batchUniqueParagraphs:texts.length,
     currentSentence:start+1+sourceOffset,sentenceCharacters:upcoming[sourceOffset].text.length});
   }else progress(detail);
  };
  const started=Date.now();
  // Identical source paragraphs must share work within a batch as well as
  // across already-committed cache entries.
  const results=texts.length===1?
    [await analyze(texts[0],localModes,signal,relay)]:
    await analyzeBatch(texts,localModes,signal,relay);
  batchRequestMs+=Date.now()-started;batchCalls++;
  if(!Array.isArray(results)||results.length!==texts.length)throw Error('Local batch analysis returned an invalid paragraph count');
  const byText=new Map(texts.map((text,i)=>[text,results[i]]));
  // Do not commit future paragraph cache entries or emit later RESULTS until
  // their normal, sequential source validation and progress steps finish.
  for(const next of upcoming)prefetched.set(next.id,byText.get(next.text));
 }
 for(const sentence of sentences){
  const oneSentenceStarted=Date.now();
  signal?.throwIfAborted();
  const currentSentence=completedSentences+1;
  const progress=detail=>loading({...detail,currentSentence,sentenceCharacters:sentence.text.length});
  const localKey=cacheKeyFor(sentence.text);
  let analysis=!bypassCache&&cache.get(localKey);
  let prefetchElapsed=0,analyzedNow=false;
  if(analysis){prefetched.delete(sentence.id);analysis=validateAnalysis(sentence.text,analysis);stats.cacheHits++;stats.localCacheHits++;}
  else {
   if(!prefetched.has(sentence.id)){
    const prefetchStarted=Date.now();
    await prefetchBatch(completedSentences,progress);
    prefetchElapsed=Date.now()-prefetchStarted;
   }
   if(!prefetched.has(sentence.id))progress({stage:'analysis'});
   const singleProgress=detail=>{
    if(['analysis-paragraph','analysis-phase'].includes(detail?.stage))
     progress({...detail,batchStart:currentSentence,batchEnd:currentSentence,
      batchParagraphs:1,batchCharacters:sentence.text.length,batchUniqueParagraphs:1});
    else progress(detail);
   };
   const raw=prefetched.has(sentence.id)?prefetched.get(sentence.id):await analyze(sentence.text,localModes,signal,singleProgress);
   prefetched.delete(sentence.id);
   analysis=validateAnalysis(sentence.text,raw);
   if(analysis.engine_version!==identity.engine_version||analysis.dictionary_fingerprint!==identity.dictionary_fingerprint)throw Error('Dictionary changed during operation');
   cache.set(localKey,analysis);
   profile(analysis);
   analyzedNow=true;
  }
  if(reviewAll){
   if(analysis.annotations.length)throw Error('模型重审不允许使用本地直接标注结果。');
   if(selectionReview){
    if(!Array.isArray(sentence.selected))throw Error('模型重审需要有效选区。');
    analysis={...analysis,targets:analysis.targets.filter(t=>sentence.selected.some(r=>Number.isInteger(r.start)&&Number.isInteger(r.end)&&t.start>=r.start&&t.end<=r.end))};
   }
   analysis.stats={...analysis.stats,pending:analysis.targets.length};
  }
  // Count actual engine output and validator survivors, including cache hits.
  for(const key of ['experimental_hanja_audit_generated','experimental_hanja_audit_retained',
    'experimental_hanja_audit_filtered','experimental_loanword_audit_generated',
    'experimental_loanword_audit_retained'])
    stats[key]+=Number(analysis.stats?.[key]||0);
  // Pre-fetching 12 paragraphs used to be charged entirely to the first
  // paragraph. Prefer measured engine time and exclude batch transport from
  // per-paragraph wall-clock timing. Cache hits are never reported as cold work.
  const measured=analysis.stats?.timings_ms?.total;
  const oneSentenceMs=analyzedNow&&Number.isFinite(measured)
    ?measured:Math.max(0,Date.now()-oneSentenceStarted-prefetchElapsed);
  if(analyzedNow){
   const times=analysis.stats?.timings_ms||{};
   slowestParagraphs.push({sentenceId:sentence.id,characters:sentence.text.length,
    ms:Math.round(oneSentenceMs*100)/100,tokenCount:analysis.stats?.token_count??null,
    segmentCount:analysis.stats?.segment_count??null,
    targetCount:analysis.targets.length,optionCount:analysis.stats?.option_count??null,
    timingsMs:Object.fromEntries(Object.entries(times).filter(([k,v])=>Number.isFinite(v)).map(([k,v])=>[k,Math.round(v*100)/100]))});
   slowestParagraphs.sort((a,b)=>b.ms-a.ms);
   if(slowestParagraphs.length>5)slowestParagraphs.pop();
   if(oneSentenceMs>slowestSentenceMs){slowestSentenceMs=oneSentenceMs;slowestSentenceId=sentence.id;slowestSentenceChars=sentence.text.length;}
  }
  if(oneSentenceMs>=1800){
   diagnostic({stage:'performance',level:'warning',
    message:`本地分析慢段：${sentence.id}（${sentence.text.length} 字符）耗时 ${oneSentenceMs}ms。`,
    detail:JSON.stringify({sentence_id:sentence.id,characters:sentence.text.length,localMs:oneSentenceMs})});
  }
  if(message.restrictToSelection===true){
   if(!Array.isArray(sentence.selected)||sentence.selected.some(r=>!Number.isInteger(r.start)||!Number.isInteger(r.end)||r.start<0||r.end<=r.start||r.end>sentence.text.length))throw Error('Invalid paragraph selection');
   const selected=a=>sentence.selected.some(r=>a.start>=r.start&&a.end<=r.end);
   analysis={...analysis,annotations:analysis.annotations.filter(selected),targets:analysis.targets.filter(selected)};
   analysis.stats={...analysis.stats,local_determined:analysis.annotations.length,pending:analysis.targets.length};
  }
  // Explicit Hangul(漢字) is an author's local spelling. Do not ask the
  // model to decide that exact pair, but preserve unrelated targets.
  const sourcePairs=modes.hanja?extractInlineHanjaPairs(sentence.text):[];
  if(modes.hanja){
   const annotated=applyInlineHanjaAnnotations(sentence.text,analysis,{
    selected:message.restrictToSelection===true?sentence.selected:null,
    pairs:sourcePairs});
   analysis=annotated.analysis;
   stats.inline_hanja_pairs_found+=annotated.stats.found;
   stats.inline_hanja_local_converted+=annotated.stats.converted;
   stats.inline_hanja_reused+=annotated.stats.reused;
   stats.inline_hanja_removed_targets+=annotated.stats.removedTargets;
   stats.inline_hanja_pairs_skipped+=annotated.stats.skipped;
  }
  let sessionHanjaUsed=false;
  if(sessionGlossary){
   // Learn only successful direct local pairs. Their evidence is available to
   // later text from the close of the actual (漢字) parentheses onward.
   learnSessionHanjaGlossary(sentence.text,analysis,sessionGlossary,{
    paragraphIndex:completedSentences,pairs:sourcePairs,
    selected:message.restrictToSelection===true?sentence.selected:null});
   if(sessionGlossary.terms){
    const updated=applySessionHanjaGlossary(sentence.text,analysis,sessionGlossary,{
     paragraphIndex:completedSentences,
     selected:message.restrictToSelection===true?sentence.selected:null});
    analysis=updated.analysis;
    stats.session_hanja_new_targets+=updated.stats.newTargets;
    stats.session_hanja_new_choices+=updated.stats.newChoices;
    stats.session_hanja_enhanced_choices+=updated.stats.enhancedChoices;
    stats.session_hanja_skipped+=updated.stats.skipped;
    sessionHanjaUsed=updated.stats.newTargets+updated.stats.newChoices+updated.stats.enhancedChoices>0;
   }
  }
  // Model-only safeguard: corroborated repeated personal names must not
  // acquire unrelated ordinary-noun senses from inconsistent Kiwi splits.
  // Keep the engine's cached source analysis and DOM offsets untouched.
  if(enabled&&modes.nameProtection){
   analysis=protectRepeatedArticleNames(sentence.text,analysis).analysis;
  }
  for(const warning of analysis.diagnostics||[])diagnostic(warning);
  for(const name of ['local_determined','pending','structural_rejections','rejected_options','upstream_alignment_pruned','skipped_mixed','protected_names','upstream_converted','upstream_ambiguous','upstream_no_match','upstream_kept'])stats[name]+=Number(analysis.stats[name]||0);
  for(const example of analysis.stats.upstream_alignment_samples||[])if(earlyAlignmentSamples.length<8)earlyAlignmentSamples.push({sentence_id:sentence.id,...example});
  hasOriginalCounts ||= Number.isInteger(analysis.stats.upstream_converted);
  completedSentences++;emit('RESULTS',{source:'local',sentenceCharacters:sentence.text.length,
   currentSentence:completedSentences,results:[{id:sentence.id,annotations:analysis.annotations}]});
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
    options:[{choice_id:null,type:'keep',replacement:sentence.text,entry_id:null,definitions:[]}]};
   analysis={...analysis,targets:[scan]};
  }
  if(smartSegmentation)analysis={...analysis,targets:analysis.targets.map(t=>({...t,repair_sentence_key:sentence.id,
   repair_context:analysis.repair_context||{kiwi_tokens:[],protected_ranges:[]}}))};
  stats.experimental_hanja_audit_reviewable+=analysis.targets.filter(t=>t.experimental_hanja_audit===true).length;
  work.push({sentence,analysis,localKey,repairs:[],sessionHanjaUsed});
 }
 diagnostic({stage:'performance',level:'info',
  message:`本地分析汇总：${sentences.length} 段共耗时 ${Date.now()-localStageStarted}ms；最慢段 ${slowestSentenceId}（${slowestSentenceChars} 字符）${slowestSentenceMs}ms，缓存命中 ${stats.cacheHits}。`,
  detail:JSON.stringify({paragraphs:sentences.length,totalLocalMs:Date.now()-localStageStarted,slowestSentenceMs,slowestSentenceId,slowestSentenceChars,cacheHits:stats.cacheHits,
   batchCalls,batchRequestMs,slowestParagraphs,stageTimingsMs:Object.fromEntries(Object.entries(phaseTotals).map(([stage,value])=>[stage,Math.round(value*100)/100]))})});
 if(slowestParagraphs.length)
  diagnostic({stage:'performance',level:'info',message:`本地分析最慢 ${slowestParagraphs.length} 段：${slowestParagraphs.map(p=>`${p.sentenceId} ${p.characters}字/${Math.round(p.ms)}ms`).join('；')}`,
   detail:JSON.stringify({slowestParagraphs})});
 if(sessionGlossary){
  stats.session_hanja_glossary_terms=sessionGlossary.terms;
  stats.session_hanja_glossary_variants=sessionGlossary.variants;
  stats.session_hanja_glossary_conflicts=sessionGlossary.conflicts;
 }
 if(sessionGlossary?.terms)diagnostic({stage:'session-hanja',level:sessionGlossary.conflicts?'warning':'info',
  message:`本次任务按正文顺序逐段学习：已遇到 ${sessionGlossary.terms} 个韩文词、${sessionGlossary.variants} 种括注汉字写法，存在多种写法的词 ${sessionGlossary.conflicts} 个；只向括注之后的位置新增待审核 Target ${stats.session_hanja_new_targets} 个、新增候选 ${stats.session_hanja_new_choices} 个、补充已有候选出处 ${stats.session_hanja_enhanced_choices} 次，跳过冲突位置 ${stats.session_hanja_skipped} 处；不会反向修改前文或写入永久词典。`});
 if(stats.inline_hanja_pairs_found)diagnostic({stage:'page-hanja',level:'info',
   message:`正文汉字开头括注：识别 ${stats.inline_hanja_pairs_found} 对，直接本地标注 ${stats.inline_hanja_local_converted} 对，已有一致标注 ${stats.inline_hanja_reused} 对，移除待审核 Target ${stats.inline_hanja_removed_targets} 个，跳过有歧义位置 ${stats.inline_hanja_pairs_skipped} 对；不送模型。`});
  if(stats.upstream_alignment_pruned)diagnostic({stage:'upstream-alignment-pruned',level:'info',
   message:`在本地候选评分前已排除 ${stats.upstream_alignment_pruned} 个无法映射到原文的汉字候选；这些候选不会发送给模型。`,
   detail:JSON.stringify({count:stats.upstream_alignment_pruned,samples:earlyAlignmentSamples})});
  if(stats.protected_names)diagnostic({stage:'rules',level:'info',message:`已按完整名称范围保留 ${stats.protected_names} 处疑似姓名，未使用内部普通词义替换。`,detail:JSON.stringify({protected_names:stats.protected_names})});
 if(modes.experimentalHanjaAudit)
  diagnostic({stage:'experimental-hanja-audit',level:stats.experimental_hanja_audit_filtered?'warning':'info',
   message:`汉字词实验审核目标：本地生成 ${stats.experimental_hanja_audit_generated}、本地校验保留 ${stats.experimental_hanja_audit_retained}、本地过滤 ${stats.experimental_hanja_audit_filtered}、后续流程可审核 ${stats.experimental_hanja_audit_reviewable}；外来语实验目标生成 ${stats.experimental_loanword_audit_generated}、保留 ${stats.experimental_loanword_audit_retained}。`});
 if(hasOriginalCounts)diagnostic({stage:'rules',level:'info',message:`原作者规则：自动转换 ${stats.upstream_converted}，歧义 ${stats.upstream_ambiguous}，未匹配 ${stats.upstream_no_match}；本地标注 ${stats.local_determined}，待审核 ${stats.pending}。`,detail:JSON.stringify({upstream_converted:stats.upstream_converted,upstream_ambiguous:stats.upstream_ambiguous,upstream_no_match:stats.upstream_no_match,upstream_kept:stats.upstream_kept,local_determined:stats.local_determined,pending:stats.pending,structural_rejections:stats.structural_rejections,rejected_options:stats.rejected_options,skipped_mixed:stats.skipped_mixed})});
 let config;
 if(enabled && work.some(w=>w.analysis.targets.length)){
  try{config=await modelConfig();if(!config)throw Error('没有可用模型配置');}
  catch(error){config=null;diagnostic({stage:'configuration',level:'error',message:`模型配置不可用：${error.message}`});}
 }else diagnostic({stage:'skipped',level:'info',message:enabled?'没有待审核候选，本次无需调用模型。':'模型审核开关关闭，仅使用本地词典规则。'});
 if(config){const upstreamDiagnostic=config.onDiagnostic;config={...config,onDiagnostic:d=>{upstreamDiagnostic?.(d);diagnostic({...d,message:safeDetail(d.message,config),detail:safeDetail(d.detail,config)});}};}

 const experimental=!!(config?.experimentalHanja&&modes.hanja||config?.experimentalLoanword&&modes.loanword);
 if(config)config={...config,smartSegmentation:smartSegmentation&&config.smartSegmentation===true,experimentalHanja:experimental&&config.experimentalHanja===true&&modes.hanja,experimentalLoanword:experimental&&config.experimentalLoanword===true&&modes.loanword,hanjaReadingCheck:config.hanjaReadingCheck===true,dictionaryFree,repairModes:{hanja:modes.hanja,loanword:modes.loanword}};
 const progressive=message.progressiveAnnotation===true;
 const lastPublished=new Map();
 const publishModel=(item,preview=[],provisional=false)=>{
  const suppressed=new Set((item.repairs||[]).flatMap(r=>r.source_target_ids));
  const accepted=[...item.result.accepted,...preview].filter(a=>!a.target.scan_only&&!suppressed.has(a.target.target_id));
  const additions=compactDomAnnotations([...accepted.filter(a=>a.option.type!=='keep').flatMap(a=>projectAnnotation(item.sentence.text,{...a.target,...a.option,start:a.target.start,end:a.target.end,surface:a.target.surface,context:a.target.context})),...(item.repairs||[]).flatMap(r=>r.annotations)]);
  const reviewed=[...accepted.map(a=>({start:a.target.start,end:a.target.end,surface:a.target.surface})),
   ...(item.repairs||[]).flatMap(r=>[
    ...r.source_target_ids.flatMap(id=>item.analysis.targets.filter(t=>t.target_id===id).map(t=>({start:t.start,end:t.end,surface:t.surface}))),
    {start:r.start,end:r.end,surface:r.surface}
   ])];
  const signature=JSON.stringify([additions,reviewed,provisional]);
  if(lastPublished.get(item)===signature||(!accepted.length&&!item.repairs?.length&&!lastPublished.has(item)))return;lastPublished.set(item,signature);
  return emit('RESULTS',{source:'model',replaceModel:true,provisional,results:[{id:item.sentence.id,annotations:additions,reviewed}]});
 };
 const previewModelResults=(owners,items)=>{
  const previewCounts=new Map();
  return accepted=>{
   // Group stream previews by paragraph, not by individual SSE token. The
   // model's 800+ answers in a 7K-character article should not regenerate
   // a multi-hundred-ruby DOM tree 800 times.
   const perItem=new Map();
   for(const a of accepted){
    const owner=owners.get(a.target.target_id);
    if(!owner||owner.target.scan_only)continue;
    const rows=perItem.get(owner.item)||[];
    rows.push({target:owner.target,option:a.option});
    perItem.set(owner.item,rows);
   }
   for(const item of items){
    const previews=perItem.get(item)||[];
    const previousCount=previewCounts.get(item);
    if(!shouldPublishPreview({sentenceChars:item.sentence.text.length,
      targetCount:item.reviewableTargets?.length||0,
      lastCount:previousCount??0,nextCount:previews.length,
      hasPublished:previousCount!==undefined}))continue;
    previewCounts.set(item,previews.length);
    publishModel(item,previews,previews.length>0);
   }
  };
 };
 const pending=[];
 const progress={modelCompleted:0,modelTotal:0};
 const reportProgress=()=>emit('MODEL_PROGRESS',{...progress,modelPercent:progress.modelTotal?Math.round(100*progress.modelCompleted/progress.modelTotal):100});
 const initialConfig=config;
 const fingerprint=config&&JSON.stringify([
  config.hanjaReadingCheck===true,
  smartSegmentation?'id-review-v21-single-pass-segmentation-repair':
   experimental?'id-review-v20-literal-origin-choice':'id-review-v17-chunk-context',
  config.reviewPosFilter!==false,
  ...(experimental?[!!config.experimentalHanja,!!config.experimentalLoanword,...(config.experimentalHanja===true?['person-origin-policy-v2']:[])]:[])
 ]);
 const articleLookup=config&&!bypassCache ?
  createArticleReviewLookup(work,await articleCacheScope(message.articleCacheIdentity),cache):null;
 let mixedContinuation=false,modelCacheMisses=0,modelCacheRejected=0,articleCacheHits=0;
 for(const [index,item] of work.entries()){
  const {analysis}=item;
  // Do not ask an ordinary (non-experimental) model to choose among null/no-conversion
  // and only native/nonconversion senses. Such targets cannot annotate
  // anything; they sometimes survive as original homograph review targets.
  // Smart segmentation keeps all its placeholders for repair, and explicitly
  // enabled open-ended origin audits remain unaffected.
  item.reviewableTargets=config&&!experimental&&!smartSegmentation?
   analysis.targets.filter(target=>
    filterReviewTarget(target,config).options.some(o=>['hanja','loanword','mixed'].includes(o.type))):
   analysis.targets;
  item.result={accepted:[],unresolved:item.reviewableTargets};
  if(config && item.reviewableTargets.length){
   item.reviewKey=paragraphReviewKey(work,index,fingerprint,message.restrictToSelection===true);
   const cached=!bypassCache&&cache.get(item.reviewKey);
   let restored=cached&&restoreParagraphReview(item,cached,config,message.restrictToSelection===true);
   const nearby=!restored&&articleLookup?.find(item.reviewKey,index);
   if(nearby)restored=restoreParagraphReview(item,nearby,config,message.restrictToSelection===true);
   if(restored&&nearby)articleCacheHits++;
   if(!restored&&!bypassCache){
    if(cached||nearby)modelCacheRejected++;
    else modelCacheMisses++;
   }
   item.articleScope=articleLookup?.scopeFor(index);
   if(restored){
    item.result=restored.result;item.repairs=restored.repairs;item.cacheRestored=true;
    const accepted=item.result.accepted;
    stats.cacheHits++;stats.modelCacheHits++;stats.modelCachedTargets+=accepted.length;
    stats.model_accepted+=accepted.length;
    stats.model_keep+=accepted.filter(a=>a.option.type==='keep').length;
    stats.model_nonconversion+=accepted.filter(a=>a.option.type==='nonconversion').length;
    stats.model_conversion_choices+=accepted.filter(a=>['hanja','loanword','mixed'].includes(a.option.type)).length;
    stats.model_literal_origins+=accepted.filter(a=>String(a.option.entry_id||'').startsWith('experimental:')).length;
    stats.repair_applied+=item.repairs.length;
    if(progressive)publishModel(item);
    diagnostic({stage:'cache',level:'info',message:'段落审核缓存命中：已重新校验 '+accepted.length+' 条词源及 '+item.repairs.length+' 项分词修复，无需重复请求。'});
   }
   if(item.result.unresolved.length){pending.push(item);progress.modelTotal+=item.result.unresolved.length;}
  }
 }
 reportProgress();
 const tier=normalizeBatchContextTier(config?.batchContextTier);
 const batches=tier!=='current'?contextReviewBatches(pending,context,{tier,manual:config?.manualReview===true,reviewPosFilter:config?.reviewPosFilter,experimentalHanja:config?.experimentalHanja,experimentalLoanword:config?.experimentalLoanword,dictionaryFree,smartSegmentation:config?.smartSegmentation,manualOutputTokenLimit:config?.manualOutputTokenLimit,apiOutputTokenLimit:config?.apiOutputTokenLimit,matchManualOutputBudget:config?.matchManualOutputBudget!==false}):config?.manualReview?manualReviewBatches(pending,context,{reviewPosFilter:config?.reviewPosFilter,experimentalHanja:config?.experimentalHanja,experimentalLoanword:config?.experimentalLoanword,dictionaryFree,smartSegmentation:config?.smartSegmentation}):sentenceReviewBatches(pending,context);
 const preparedBatches=batches.map((batch,batchIndex)=>{
  const owners=new Map();
  const targetWire=(id,item,target)=>{
   owners.set(id,{item,target});
   return {...target,target_id:id,
    source_sentence_id:item.sentence.id,original_target_id:target.target_id,
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
 if(config?.manualReview&&preparedBatches.length)emit('MANUAL_REVIEW_PLAN',{batches:preparedBatches.map(b=>b.manualPrepared)});
 // User-controlled retry state remains alive for this original DOM task.
 const rejectedChoiceHistory=new Map();
 const rejectedChoiceFeedback=new Map();
 const sourceKey=t=>JSON.stringify([t.source_sentence_id||t.repair_sentence_key||t.context||'',
  t.original_target_id||t.target_id,t.start,t.end,t.surface]);
 const feedbackChoices=targets=>Object.fromEntries(targets.map(t=>[t.target_id,
  Object.entries(rejectedChoiceFeedback.get(sourceKey(t))?.counts||{})
   .map(([c,v])=>({c,reason:v.reason||'invalid_choice_id'}))]).filter(([,v])=>v.length));
 let modelPermanentFailure=false;
 for(const [batchIndex,batch] of batches.entries()){
  if(batch.budget)diagnostic({stage:'batch-budget',level:'info',message:`${batch.budget.label} 档批次：预估输入 ${batch.budget.inputTokens}、答案 ${batch.budget.outputTokens}、输出预算上限 ${batch.budget.outputLimit}${config?.manualReview?'':`、实际请求上限 ${batch.budget.requestedOutputTokens}`}、安全余量 ${batch.budget.safetyTokens} tokens。${batch.budget.limitReason==='output'?'本批受答案长度预算限制。':''}`,detail:JSON.stringify(batch.budget)});
  const {owners,targets,repairScopes,manualBindings,manualPrepared}=preparedBatches[batchIndex];
  const firstReview=await reviewTargets({...config,rejectedChoiceHistory,rejectedChoiceFeedback,retryHistoryFeedback:true,
   firstPassOnly:config.manualReview!==true&&config.discardInvalidReviewResults!==true,
   repairScopes,manualBindings,manualPrepared,batchNumber:batchIndex+1,batchTotal:batches.length,batchBudget:batch.budget,operationId:message.operationId,stream:progressive?true:config.stream,timeoutMs:config.timeoutMs||600000,enableModelReview:true,context:batch.context,
   onPreview:progressive&&!config.manualReview?previewModelResults(owners,batch.items):undefined,
   onReviewTargetsSubmitted:wire=>{
    for(const t of wire)if(t.experimental_hanja_audit===true){
     stats.experimental_hanja_audit_request_occurrences++;
     const key=batchIndex+':'+t.target_id;
     if(!hanjaSentIds.has(key)){hanjaSentIds.add(key);stats.experimental_hanja_audit_sent++;}
    }
   },
   onExperimentalHanjaAnswers:audit=>{
    stats.model_direct_hanja_proposed+=audit.proposed;
    stats.model_direct_hanja_accepted+=audit.accepted;
    stats.model_direct_hanja_rejected+=audit.rejected;
    stats.model_direct_hanja_reading_rejected+=audit.reasons.hanja_reading_conflict||0;
    stats.model_direct_hanja_name_rejected+=audit.reasons.person_name_hanja_blocked||0;
    stats.model_direct_hanja_conflict_rejected+=audit.reasons.conflicting_well_formed_answers||0;
    stats.model_direct_hanja_boundary_rejected+=(audit.reasons.hanja_alignment_or_boundary||0)+
      (audit.reasons.partial_or_cross_word_boundary||0);
    for(const [reason,count] of Object.entries(audit.reasons))
     hanjaRejectionReasons[reason]=(hanjaRejectionReasons[reason]||0)+count;
    for(const sample of audit.samples||[])if(hanjaRejectionSamples.length<12)
     hanjaRejectionSamples.push({batch:batchIndex+1,...sample});
   },
   onAccepted:(accepted,{interrupted=false}={})=>{
    for(const a of accepted){
     const owner=owners.get(a.target.target_id);
     if(owner){
      if(a.invalidChoiceFallback||a.implicitNull||a.discardedInvalid||interrupted)owner.item.cacheUnsafe=true;
      owner.item.result.accepted.push({target:owner.target,option:a.option,
       ...(a.invalidChoiceFallback?{invalidChoiceFallback:true}:{})});
     }
    }
    stats.model_accepted+=accepted.length;
    stats.model_keep+=accepted.filter(a=>a.option.type==='keep').length;
    stats.model_nonconversion+=accepted.filter(a=>a.option.type==='nonconversion').length;
    stats.model_invalid_choice_fallback+=accepted.filter(a=>a.invalidChoiceFallback).length;
    stats.model_conversion_choices+=accepted.filter(a=>['hanja','loanword','mixed'].includes(a.option.type)).length;
    for(const answer of accepted){
     const row={surface:answer.target.surface,choice_id:answer.option.choice_id,
      replacement:answer.option.replacement};
     if(answer.invalidChoiceFallback&&outcomeSamples.invalidChoiceFallback.length<12)
      outcomeSamples.invalidChoiceFallback.push(row);
     else if(answer.option.type==='nonconversion'&&outcomeSamples.nonconversion.length<12)
      outcomeSamples.nonconversion.push(row);
    }
     stats.model_literal_origins+=accepted.filter(a=>String(a.option.entry_id||'').startsWith('experimental:')).length;
     progress.modelCompleted+=accepted.length;reportProgress();
    // Non-progressive mode still checkpoints completed model batches in the
    // page and MV3 session journal, but does NOT paint until DONE (or an
    // unexpected disconnect). Streaming mode also keeps its incremental UI.
    // Normal smart replies still commit atomically with validated repairs.
    // On transport failure there are no further repairs from this response;
    // lazily retain complete choices and checkpoint them immediately.
    if(!config.manualReview&&(!smartSegmentation||interrupted))
     return Promise.all(batch.items.map(item=>publishModel(item)));
   },
   ...(smartSegmentation?{onRepairRejected:count=>{stats.repair_rejected+=count;if(count)for(const item of batch.items)item.cacheUnsafe=true;},onRepairOffsetCorrected:count=>{stats.repair_offset_corrected+=count;},onRepairs:repairs=>{
    for(const repair of repairs){
     const owner=[...owners.values()].find(({item})=>item.sentence.id===repair.sentenceKey);
     if(owner){owner.item.repairs.push(repair);stats.repair_applied++;}
     else{stats.repair_rejected++;diagnostic({stage:'segmentation',level:'warning',message:'修复对应的原文段落已变化，安全跳过。'});}
    }
    if(!config.manualReview)return Promise.all(batch.items.map(item=>publishModel(item)));
   }}:{})
  },targets,signal);

  if(firstReview.errors?.some(error=>error.permanent===true))
   modelPermanentFailure=true;
  for(const item of batch.items){
   const answered=new Set(item.result.accepted.map(a=>a.target.target_id));
   const retired=new Set((item.repairs||[]).flatMap(r=>r.source_target_ids));
   item.result.unresolved=item.reviewableTargets.filter(t=>
     !answered.has(t.target_id)&&!retired.has(t.target_id)&&!t.scan_only);
   if(firstReview.errors?.length||smartSegmentation&&firstReview.unresolved?.length)item.cacheUnsafe=true;
  }
  await persist(cache);
 }

 // Complete the planned first pass, THEN rebudget sparse omissions into
 // fewer, context-safe requests. Never coerce a rejected answer to null.
 async function reviewRemainingTogether(mode='api',userForced=false){
  if(!config)return 0;
  const remainingItems=work.filter(item=>item.result?.unresolved?.some(t=>!t.scan_only));
  if(!remainingItems.length)return 0;
  const manual=mode==='manual';
  const tier=normalizeBatchContextTier(config.batchContextTier);
  const flags={tier,manual,
   reviewPosFilter:config.reviewPosFilter,experimentalHanja:config.experimentalHanja,
   experimentalLoanword:config.experimentalLoanword,dictionaryFree:config.dictionaryFree,
   smartSegmentation:false,manualOutputTokenLimit:config.manualOutputTokenLimit,
   apiOutputTokenLimit:config.apiOutputTokenLimit,
   matchManualOutputBudget:config.matchManualOutputBudget!==false};
  const pools=manual?manualReviewBatches(remainingItems,'',{
   reviewPosFilter:flags.reviewPosFilter,experimentalHanja:flags.experimentalHanja,
   experimentalLoanword:flags.experimentalLoanword,dictionaryFree:flags.dictionaryFree,
   smartSegmentation:false}):
   tier==='current'?sentenceReviewBatches(remainingItems,context):
   contextReviewBatches(remainingItems,'',flags);
  const before=remainingItems.reduce((n,item)=>n+
   item.result.unresolved.filter(t=>!t.scan_only).length,0);
  diagnostic({stage:'pooled-retry',level:'info',
   message:'前轮剩余 '+before+' 个审核目标；按原句上下文和输出预算合并成 '+
    pools.length+' 组补交请求，保留原有效答案。'});
  let totalAccepted=0;
  for(const [groupIndex,group] of pools.entries()){
   signal?.throwIfAborted();
   const owners=new Map();
   const rows=group.rows||group.items.flatMap(item=>
    item.result.unresolved.filter(t=>!t.scan_only).map(target=>({item,target})));
   const wire=rows.map(({item,target},i)=>{
    const id='r'+groupIndex+'t'+i;
    owners.set(id,{item,target});
    return {...target,target_id:id,source_sentence_id:item.sentence.id,
     original_target_id:target.target_id};
   });
   if(!wire.length)continue;
   const manualBindings=manual?wire.map(t=>{
    const {item,target}=owners.get(t.target_id);
    const options=filterReviewTarget(target,config).options;
    return {target_id:t.target_id,sentenceId:item.sentence.id,
     start:target.start,end:target.end,surface:target.surface,
     choices:options.map(o=>({choice_id:o.choice_id,
      annotations:o.type==='keep'?[]:
       projectAnnotation(item.sentence.text,{...target,...o}).map(a=>
        ({start:a.start,end:a.end,surface:a.surface,replacement:a.replacement,type:a.type}))})),
     ...((config.experimentalHanja||config.experimentalLoanword)?{literalOrigin:{
      hanja:config.experimentalHanja===true,loanword:config.experimentalLoanword===true,
      eligible:(config.experimentalHanja===true&&canProposeExperimentalOption(target,'hanja'))||
       (config.experimentalLoanword===true&&canProposeExperimentalOption(target,'loanword')),
      hanjaEligible:config.experimentalHanja===true&&canProposeExperimentalOption(target,'hanja'),
      loanwordEligible:config.experimentalLoanword===true&&canProposeExperimentalOption(target,'loanword'),
      morphology:target.morphology||[],known:options.filter(o=>
       ['hanja','loanword'].includes(o.type)).map(o=>({type:o.type,replacement:o.replacement}))
     }}:{})};
   }):undefined;
   const manualPrepared=manual?prepareManualRequest({...config,manualBindings,
    context:group.context,batchNumber:groupIndex+1,batchTotal:pools.length,
    rejectedChoices:feedbackChoices(wire),retryHistoryFeedback:true,
    batchBudget:group.budget,smartSegmentation:false},wire):undefined;
   const applied=new Set();
   const next=await reviewTargets({...config,enableModelReview:true,
    manualReview:manual,smartSegmentation:false,
    retryHistoryFeedback:true,rejectedChoiceHistory,rejectedChoiceFeedback,
    pooledRetry:!manual,userForcedRetry:userForced,
    context:group.context,manualBindings,manualPrepared,
    operationId:message.operationId,batchBudget:group.budget,
    stream:progressive?true:config.stream,timeoutMs:config.timeoutMs||600000,
    onPreview:progressive&&!manual?previewModelResults(owners,group.items):undefined,
    onAccepted:async accepted=>{
     const changed=new Set();
     for(const a of accepted){
      const owner=owners.get(a.target.target_id);
      if(!owner||applied.has(a.target.target_id))continue;
      applied.add(a.target.target_id);
      const {item,target}=owner;
      if(a.invalidChoiceFallback||a.implicitNull||a.discardedInvalid||smartSegmentation)item.cacheUnsafe=true;
      item.result.accepted.push({target,option:a.option});
      changed.add(item);
      stats.model_accepted++;
      if(a.option.type==='keep')stats.model_keep++;
      if(a.option.type==='nonconversion')stats.model_nonconversion++;
      if(['hanja','loanword','mixed'].includes(a.option.type))stats.model_conversion_choices++;
      if(String(a.option.entry_id||'').startsWith('experimental:'))stats.model_literal_origins++;
      progress.modelCompleted++;totalAccepted++;
     }
     for(const item of changed){
      const approved=new Set(item.result.accepted.map(a=>a.target.target_id));
      item.result.unresolved=item.result.unresolved.filter(t=>!approved.has(t.target_id));
     }
     if(changed.size&&!manual)await Promise.all([...changed].map(item=>publishModel(item)));
     if(changed.size)reportProgress();
    }
   },wire,signal);
   if(next.errors?.length)for(const item of group.items)item.cacheUnsafe=true;
   if(next.errors?.some(e=>e.permanent===true))modelPermanentFailure=true;
   diagnostic({stage:'pooled-retry',level:next.unresolved.length?'warning':'info',
    message:'合并补交 '+(groupIndex+1)+'/'+pools.length+'：采纳 '+
     applied.size+' 条，仍有 '+next.unresolved.length+' 条。'});
   if(modelPermanentFailure&&!userForced)break;
  }
  return totalAccepted;
 }
 if(config&&!config.manualReview&&config.discardInvalidReviewResults!==true&&
    !modelPermanentFailure)await reviewRemainingTogether('api',false);
 if(config&&message.webUserContinuation===true&&
    typeof waitForUnfinishedReview==='function'&&typeof continuationModelConfig==='function'){
  let pass=0;
  const outstanding=()=>work.reduce((n,item)=>n+
   (item.result?.unresolved||[]).filter(t=>!t.scan_only).length,0);
  while(outstanding()>0){
   await emit('REVIEW_PAUSED',{unansweredTargets:outstanding(),pass});
   const decision=await waitForUnfinishedReview();
   const mode=decision?.mode;
   if(!['api','manual','null'].includes(mode)){
    diagnostic({stage:'review-continuation',level:'warning',
     message:'继续审核方式无效，请重新选择 API、手动或按 null 完成。'});
    continue;
   }
   if(mode==='null'){
    mixedContinuation=true;
    let kept=0,changed=[];
    for(const item of work){
     const remains=item.result.unresolved.filter(t=>!t.scan_only);
     if(!remains.length)continue;
     for(const target of remains){
      const keep=target.options.find(o=>o.type==='keep');
      if(!keep)throw Error('剩余目标无 KEEP 选项，无法安全按 null 完成');
      item.result.accepted.push({target,option:keep});kept++;
     }
     item.result.unresolved=[];
     changed.push(item);
    }
    stats.model_accepted+=kept;stats.model_keep+=kept;
    progress.modelCompleted+=kept;reportProgress();
    await Promise.all(changed.map(item=>publishModel(item)));
    diagnostic({stage:'user-null-finish',level:'warning',
     message:'用户明确选择把剩余 '+kept+' 个目标按 null 处理，已保留此前全部有效答案。'});
    break;
   }
   const current=await continuationModelConfig(mode);
   if(!current){
    diagnostic({stage:'review-continuation',level:'error',message:'继续审核的模型配置不可用'});
    continue;
   }
   // A manual provider installs its own request callback. Remove that
   // callback before switching back to API; otherwise old manual requests
   // would silently override the selected real HTTP provider.
   mixedContinuation=true;
   const {request:previousManualRequest,...cleanConfig}=config;
   config={...cleanConfig,...current,request:mode==='manual'?current.request:undefined,
    experimentalHanja:config.experimentalHanja,experimentalLoanword:config.experimentalLoanword,
    reviewPosFilter:config.reviewPosFilter,discardInvalidReviewResults:config.discardInvalidReviewResults,
    retryInvalidDictionaryChoices:config.retryInvalidDictionaryChoices,
    hanjaReadingCheck:config.hanjaReadingCheck,smartSegmentation:false};
   modelPermanentFailure=false;pass++;
   await emit('REVIEW_CONTINUATION_STARTED',{pass,mode,unansweredTargets:outstanding()});
   await reviewRemainingTogether(mode,true);
  }
 }

 for(const item of work){
  const {sentence,analysis,result}=item;
  const replaced=new Set((item.repairs||[]).flatMap(r=>r.source_target_ids));
  const valid=result.accepted.filter(a=>!a.target.scan_only&&!replaced.has(a.target.target_id));
  const conversionRows=valid.filter(a=>['hanja','loanword','mixed'].includes(a.option.type));
  const projectedRows=conversionRows.map(a=>projectAnnotation(sentence.text,{...a.target,...a.option,
   start:a.target.start,end:a.target.end,surface:a.target.surface,context:a.target.context}));
  const additions=compactDomAnnotations([...projectedRows.flat(),...(item.repairs||[]).flatMap(r=>r.annotations)]);
  const reviewed=[...valid.map(a=>({start:a.target.start,end:a.target.end,surface:a.target.surface})),
   ...(item.repairs||[]).flatMap(r=>[
    ...r.source_target_ids.flatMap(id=>analysis.targets.filter(t=>t.target_id===id).map(t=>({start:t.start,end:t.end,surface:t.surface}))),
    {start:r.start,end:r.end,surface:r.surface}
   ])];
  stats.model_resolved+=conversionRows.length+(item.repairs||[]).filter(r=>r.annotations.length).length;
  stats.model_projected_fragments+=additions.length;
  stats.model_zero_projection+=projectedRows.filter(row=>!row.length).length;
  for(let i=0;i<projectedRows.length;i++)if(!projectedRows[i].length&&outcomeSamples.zeroProjection.length<12)
   outcomeSamples.zeroProjection.push({surface:conversionRows[i].target.surface,
    choice_id:conversionRows[i].option.choice_id,replacement:conversionRows[i].option.replacement});
  stats.unresolved+=result.unresolved.filter(t=>!t.scan_only&&!replaced.has(t.target_id)).length+valid.filter(a=>a.option.type==='keep').length;
  // This also emits the first final result for manual/cache paths. If an
  // earlier API batch already checkpointed the same completed result, avoid
  // a duplicate frame broadcast and a second storage write.
  if(enabled){
   // A no-target sentence still needs its single empty final RESULTS event:
   // old renderers rely on it to reconcile an earlier local-only result.
   // Already-published completed model results must not be duplicated.
   if(!lastPublished.has(item)&&!valid.length&&!item.repairs?.length)
    await emit('RESULTS',{source:'model',replaceModel:true,
      results:[{id:sentence.id,annotations:additions,reviewed}]});
   else await publishModel(item);
  }
 }
 // Null / valid nonconversion selections are intentionally not conversions;
 // only missing model answers mean that analysis has NOT fully completed.
 stats.model_unanswered=enabled?work.reduce((n,item)=>{
  const retired=new Set((item.repairs||[]).flatMap(r=>r.source_target_ids));
  return n+item.result.unresolved.filter(t=>!t.scan_only&&!retired.has(t.target_id)).length;
 },0):0;
 if(modes.experimentalHanjaAudit||stats.model_direct_hanja_proposed)
  diagnostic({stage:'experimental-hanja-audit',level:stats.model_direct_hanja_rejected?'warning':'info',
   message:`汉字词实验补全：生成目标 ${stats.experimental_hanja_audit_generated}、通过本地校验 ${stats.experimental_hanja_audit_retained}、进入模型请求 ${stats.experimental_hanja_audit_sent}（含重试提交 ${stats.experimental_hanja_audit_request_occurrences} 次）；模型直接填写汉字 ${stats.model_direct_hanja_proposed}、校验通过 ${stats.model_direct_hanja_accepted}、拒绝 ${stats.model_direct_hanja_rejected}（读音 ${stats.model_direct_hanja_reading_rejected}、词界或对齐 ${stats.model_direct_hanja_boundary_rejected}、姓名保护 ${stats.model_direct_hanja_name_rejected}、冲突答案 ${stats.model_direct_hanja_conflict_rejected}）。`,
   detail:JSON.stringify({reasonCounts:hanjaRejectionReasons,samples:hanjaRejectionSamples})});
 diagnostic({stage:'model-outcomes',
  level:stats.model_invalid_choice_fallback||stats.model_nonconversion>Math.max(100,stats.model_conversion_choices*2)?'warning':'info',
  message:`模型审核归因：接受 ${stats.model_accepted} 个答案；转换候选 ${stats.model_conversion_choices}、非转换词典义项 ${stats.model_nonconversion}、保留原文 ${stats.model_keep}（其中无效选项降级 ${stats.model_invalid_choice_fallback}）；生成 ${stats.model_projected_fragments} 个对齐片段，转换但无可标注片段 ${stats.model_zero_projection}。`,
  detail:JSON.stringify(outcomeSamples)});
 if(stats.model_unanswered)
  diagnostic({stage:'incomplete',level:'warning',
   message:`模型审核仍有 ${stats.model_unanswered} 个目标没有有效答案；本轮只能算部分完成，可继续恢复与重试。`});
 // Only cache fully verified results from the original review configuration.
 // Forced nulls, mixed providers, interrupted smart scans and rejected repairs
 // must never become durable, seemingly complete answers.
 if(initialConfig&&!mixedContinuation){
  for(const item of work){
   if(!item.reviewKey||item.cacheRestored)continue;
   const snapshot=snapshotParagraphReview(item,smartSegmentation);
   if(snapshot)cache.set(item.reviewKey,item.articleScope ? {...snapshot,articleScope:item.articleScope} : snapshot);
  }
 }
 diagnostic({stage:'cache',level:'info',message:'缓存汇总：本地分析命中 '+stats.localCacheHits+' 段；模型审核命中 '+stats.modelCacheHits+' 段（'+stats.modelCachedTargets+' 个答案，其中同篇文章容错命中 '+articleCacheHits+' 段）；未找到匹配 '+modelCacheMisses+' 段，缓存校验未通过 '+modelCacheRejected+' 段。'});
 await persist(cache);
 await emit('DONE',{reviewIncomplete:stats.model_unanswered>0,
  unansweredTargets:stats.model_unanswered,
  canAutoResume:Boolean(config&&!config.manualReview&&!modelPermanentFailure)});return stats;
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

import {validateChoices,validateExperimentalChoices} from './choice-review.js';
import {validateSegmentationRepairsCore} from './repair-validation-core.js';
import {verifySegmentationOrigin} from './segmentation-repairs.js';
import {stableCacheStringify} from './session-cache.js';

// Paragraph-local identity: do not depend on transient frame/sentence IDs,
// batch layout or the rest of the page. Keep exact source and candidate data.
export function paragraphReviewKey(work,index,fingerprint,restrictToSelection=false){
 const item=work[index],sentence=item.sentence;
 const neighbors=[work[index-1]?.sentence.text??null,work[index+1]?.sentence.text??null];
 const targets=item.analysis.targets.map(({context,repair_context,repair_sentence_key,...target})=>target);
 return stableCacheStringify(['paragraph-review-v1',item.localKey,fingerprint,targets,
  item.analysis.annotations,item.analysis.repair_context??null,neighbors,
  sentence.adjacentContext??null,restrictToSelection?sentence.selected??[]:null]);
}
export function snapshotParagraphReview(item,smart){
 if(item.cacheUnsafe||!item.reviewableTargets?.length||item.result.unresolved.some(t=>!t.scan_only))return null;
 const retired=new Set((item.repairs||[]).flatMap(r=>r.source_target_ids));
 const rows=item.result.accepted.filter(a=>!a.target.scan_only&&!retired.has(a.target.target_id));
 if(rows.some(a=>a.invalidChoiceFallback||a.implicitNull||a.discardedInvalid))return null;
 const expected=item.reviewableTargets.filter(t=>!t.scan_only&&!retired.has(t.target_id));
 if(rows.length!==expected.length||new Set(rows.map(a=>a.target.target_id)).size!==expected.length||
    expected.some(t=>!rows.some(a=>a.target.target_id===t.target_id)))return null;
 return {version:1,results:rows.map(a=>({t:a.target.target_id,c:a.option.type==='keep'?null:a.option.choice_id})),
  repairs:smart?(item.repairs||[]).map(r=>({sentence_id:'s0',op:r.op,old_target_ids:r.source_target_ids,
   start:r.start,end:r.end,surface:r.surface,choice_id:r.choice_id??null})):[]};
}
export function restoreParagraphReview(item,cached,config,restrictToSelection=false){
 if(cached?.version!==1||!Array.isArray(cached.results)||!Array.isArray(cached.repairs))return null;
 const targets=item.reviewableTargets;
 let repairs=[];
 if(cached.repairs.length){
  if(!config.smartSegmentation)return null;
  const scope={text:item.sentence.text,allTargets:item.analysis.targets.filter(t=>!t.scan_only),
   localAnnotations:item.analysis.annotations,protected_ranges:item.analysis.repair_context?.protected_ranges||[],
   selected:restrictToSelection?item.sentence.selected||[]:null,existingRepairs:[]};
  const wire=targets.map(t=>({...t,original_target_id:t.target_id,repair_sentence_key:item.sentence.id}));
  const checked=validateSegmentationRepairsCore(wire,{repairs:cached.repairs},{
   ...config,payload:{sentences:[{sentence_id:'s0',text:item.sentence.text}],targets:wire.map(()=>({sentence_id:'s0'}))},
   repairScopes:new Map(wire.map(t=>[t.target_id,scope])),
   verifyOrigin:details=>verifySegmentationOrigin({...details,config})
  });
  if(checked.rejected.length||checked.accepted.length!==cached.repairs.length)return null;
  repairs=checked.accepted;
 }
 const retired=new Set(repairs.flatMap(r=>r.source_target_ids));
 const active=targets.filter(t=>!t.scan_only&&!retired.has(t.target_id));
 // Never let discard-invalid mode turn a damaged cache row into a null answer.
 const strict={...config,discardInvalidReviewResults:false};
 if(cached.results.length!==active.length||new Set(cached.results.map(r=>r?.t)).size!==active.length)return null;
 const result=(config.experimentalHanja||config.experimentalLoanword?validateExperimentalChoices:validateChoices)(active,cached,strict);
 if(result.unresolved.length||result.accepted.length!==active.length)return null;
 return {result,repairs};
}

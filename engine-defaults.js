// Only the browser dictionary/model-review switches shown in the engine panel.
// Keep batch planning, API profiles, logs and imported dictionaries outside reset.
export const ENGINE_SWITCH_DEFAULTS=Object.freeze({
 enableModelReview:true,
 preloadEngineOnStartup:true,
 nameProtection:true,
 filterDictionaryPeople:true,
 reviewPosFilter:true,
 experimentalHanja:true,
 hanjaReadingCheck:false,
 experimentalLoanword:true,
 smartSegmentation:true,
 reviewLocalConversions:true,
 retryInvalidDictionaryChoices:true,
 discardInvalidReviewResults:false,
 reviewAllCandidates:false,
 manualModelReview:true
});
export const DEFAULT_BATCH_CONTEXT_TIER='1m';
// Existing users who explicitly disabled review must not have it silently
// turned on by *new* default-on experimental switches missing from storage.
// Their own explicit per-switch selections always win; Reset opts in to all.
export function engineSwitchValues(saved={}){
 const priorReviewOff=saved.enableModelReview===false;
 const reviewDependent=new Set(['manualModelReview','experimentalHanja','experimentalLoanword','smartSegmentation']);
 const values=Object.fromEntries(Object.entries(ENGINE_SWITCH_DEFAULTS).map(([key,fallback])=>
  [key,typeof saved[key]==='boolean'?saved[key]:priorReviewOff&&reviewDependent.has(key)?false:fallback]));
 // These are exhaustive, mutually exclusive invalid-answer strategies.
 // Legacy profiles with neither enabled are migrated to strict retry instead
 // of silently turning arbitrary invalid c values into null.
 if(values.discardInvalidReviewResults)values.retryInvalidDictionaryChoices=false;
 else values.retryInvalidDictionaryChoices=true;
 if(!values.experimentalHanja)values.hanjaReadingCheck=false;
 return values;
}

// Only the browser dictionary/model-review switches shown in the engine panel.
// Keep batch planning, API profiles, logs and imported dictionaries outside reset.
export const ENGINE_SWITCH_DEFAULTS=Object.freeze({
 enableModelReview:true,
 preloadEngineOnStartup:true,
 nameProtection:true,
 filterDictionaryPeople:true,
 reviewPosFilter:true,
 experimentalHanja:true,
 hanjaReadingCheck:true,
 experimentalLoanword:true,
 smartSegmentation:true,
 reviewLocalConversions:true,
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
 return Object.fromEntries(Object.entries(ENGINE_SWITCH_DEFAULTS).map(([key,fallback])=>
  [key,typeof saved[key]==='boolean'?saved[key]:priorReviewOff&&reviewDependent.has(key)?false:fallback]));
}

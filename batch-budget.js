import {buildReviewPayload,buildManualPrompt,REVIEW_INSTRUCTIONS} from './review-payload.js';
import {EXPERIMENTAL_REVIEW_INSTRUCTIONS,canProposeExperimentalOption} from './experimental-options.js';

export const normalizeBatchContextTier=value=>['32k','128k','256k','512k','1m'].includes(value)?value:'32k';
// Editable planning/request limits, not a claim about a provider's real capacity.
// The API limit controls max_tokens/max_completion_tokens/max_output_tokens;
// the manual limit controls batching only (the chat UI has its own limits).
export const DEFAULT_API_OUTPUT_TOKENS=16384;
export const DEFAULT_MANUAL_OUTPUT_TOKENS=65536;
export const MAX_CONFIGURED_OUTPUT_TOKENS=1000000;
export function normalizeOutputTokenLimit(value,manual=false){
 const fallback=manual?DEFAULT_MANUAL_OUTPUT_TOKENS:DEFAULT_API_OUTPUT_TOKENS;
 if(value===undefined||value===null||value==='')return fallback;
 const n=Number(value);
 return Number.isSafeInteger(n)&&n>=1024&&n<=MAX_CONFIGURED_OUTPUT_TOKENS?n:fallback;
}
// This is a multilingual byte heuristic, not any provider's exact tokenizer.
export const estimateTokenCount=text=>Math.ceil(new TextEncoder().encode(text||'').length/3);
const limits={'32k':32000,'128k':128000,'256k':256000,'512k':512000,'1m':1000000};
export function describeBatchBudget(context,targets,{tier='32k',manual=false,wireIds=false,batchId='00000000',reviewPosFilter=true,experimentalHanja=false,experimentalLoanword=false,manualOutputTokenLimit=DEFAULT_MANUAL_OUTPUT_TOKENS,apiOutputTokenLimit=DEFAULT_API_OUTPUT_TOKENS}={}){
 tier=normalizeBatchContextTier(tier);
 const wire=wireIds?targets:targets.map((t,i)=>({...t,target_id:manual?'t'+i:'b0t'+i}));
 const experimental=experimentalHanja===true||experimentalLoanword===true;
 const config={reviewPosFilter,experimentalHanja,experimentalLoanword};
 const input=manual?buildManualPrompt(context,wire,batchId,config):REVIEW_INSTRUCTIONS+(experimental?'\n'+EXPERIMENTAL_REVIEW_INSTRUCTIONS:'')+'\n'+JSON.stringify(buildReviewPayload(context||'',wire,config).payload);
 // One optional proposal per ELIGIBLE target. The validator will never
 // accept an experimental proposal for proper nouns, name homographs, partial
 // words or other forbidden targets. Do not reserve fictional answers for them.
 const experimentalRows=experimental?wire.filter(canProposeExperimentalOption).map(t=>({target_id:t.target_id,choice_id:'x0',type:experimentalHanja?'hanja':'loanword',
  replacement:experimentalHanja?'漢字詞':'loanword',definition:'a precise matching sense of this Korean word in context'})):[];
 const reply=JSON.stringify({...(manual?{batch_id:batchId}:{}),...(experimental?{experimental_options:experimentalRows}:{}),results:wire.map(t=>({target_id:t.target_id,choice_id:experimental?'x0':t.options.reduce((longest,o)=>JSON.stringify(o.choice_id).length>JSON.stringify(longest).length?o.choice_id:longest,'')}))});
 const contextTokens=limits[tier],inputTokens=estimateTokenCount(input)+(manual?0:64),outputTokens=Math.ceil(estimateTokenCount(reply)*1.1)+32;
 const safetyTokens=contextTokens?Math.ceil(contextTokens*.08)+1024:0,outputLimit=normalizeOutputTokenLimit(manual?manualOutputTokenLimit:apiOutputTokenLimit,manual);
 const reservedOutputTokens=manual?outputTokens:Math.max(outputTokens,outputLimit),totalTokens=inputTokens+reservedOutputTokens+safetyTokens;
 return {tier,label:tier==='32k'?'32K':tier==='128k'?'128K':tier==='256k'?'256K':tier==='512k'?'512K':'1M',estimated:true,contextTokens,inputTokens,outputTokens,reservedOutputTokens,safetyTokens,outputLimit,totalTokens,remainingTokens:contextTokens===null?null:contextTokens-totalTokens};
}

export function contextReviewBatches(items,context='',{tier='128k',manual=false,reviewPosFilter=true,experimentalHanja=false,experimentalLoanword=false,manualOutputTokenLimit=DEFAULT_MANUAL_OUTPUT_TOKENS,apiOutputTokenLimit=DEFAULT_API_OUTPUT_TOKENS}={}){
 tier=normalizeBatchContextTier(tier);if(tier==='current')throw Error('Explicit context capacity required');
 const rows=items.flatMap(item=>item.result.unresolved.map(target=>({item,target}))),batches=[];
 const fits=budget=>budget.totalTokens<=budget.contextTokens&&budget.outputTokens<=budget.outputLimit;
 for(let start=0;start<rows.length;){
  const memo=new Map();
  const evaluate=count=>{
   if(memo.has(count))return memo.get(count);
   const group=rows.slice(start,start+count),ownContext=[...new Set(group.map(r=>r.target.context))].join('\n');
   const budget=describeBatchBudget(ownContext,group.map(r=>r.target),{tier,manual,reviewPosFilter,experimentalHanja,experimentalLoanword,manualOutputTokenLimit,apiOutputTokenLimit}),value={rows:group,items:[...new Set(group.map(r=>r.item))],context:ownContext,budget};memo.set(count,value);return value;
  };
  if(!fits(evaluate(1).budget))throw Error(`单个待选词及其完整上下文/释义超出 ${evaluate(1).budget.label} 输入或答案预算；请选更大档位或缩小文本范围。`);
  const remaining=rows.length-start;let low=1,high=remaining;
  for(let count=2;count<=remaining;count=Math.min(count*2,remaining)){
   if(!fits(evaluate(count).budget)){high=count-1;break;}
   low=count;if(count===remaining)break;
  }
  while(low<high){const middle=Math.ceil((low+high)/2);if(fits(evaluate(middle).budget))low=middle;else high=middle-1;}
  const batch=evaluate(low);
  const next=low<remaining?evaluate(low+1).budget:null;
  batch.budget.limitReason=next?(next.outputTokens>next.outputLimit?'output':'context'):'end';
  // Page-wide context is optional; every occurrence's actual sentence is mandatory.
  if(context&&context.length<=batch.budget.contextTokens*3){
   const full=describeBatchBudget(context,batch.rows.map(r=>r.target),{tier,manual,reviewPosFilter,experimentalHanja,experimentalLoanword,manualOutputTokenLimit,apiOutputTokenLimit});
   if(fits(full)){batch.context=context;batch.budget={...full,limitReason:batch.budget.limitReason};}
  }
  batches.push(batch);start+=low;
 }
 return batches;
}

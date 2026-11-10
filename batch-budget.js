import {buildReviewPayload,buildManualPrompt,reviewInstructions} from './review-payload.js';
import {generatedChoices} from './model-origin.js';

// The batch size is governed only by the prompt, predicted JSON answer,
// configured output allowance, and selected context window.
export const normalizeOutputLimitTokens=(value,fallback=16384)=>{
 const n=Number(value);
 return value!==''&&value!==null&&value!==undefined&&Number.isSafeInteger(n)&&
  n>=1024&&n<=1000000?n:fallback;
};
export const normalizeBatchContextTier=value=>['32k','128k','256k','512k','1m'].includes(value)?value:'32k';
// This is a multilingual byte heuristic, not any provider's exact tokenizer.
export const estimateTokenCount=text=>Math.ceil(new TextEncoder().encode(text||'').length/3);
const limits={'32k':32000,'128k':128000,'256k':256000,'512k':512000,'1m':1000000};
export function describeBatchBudget(context,targets,{tier='32k',manual=false,wireIds=false,batchId='00000000',reviewPosFilter=true,allowModelHanja=false,allowModelLoanword=false,allowModelSegmentation=false,maxOutputTokens=16384,manualOutputTokens=65536}={}){
 tier=normalizeBatchContextTier(tier);
 const wire=wireIds?targets:targets.map((t,i)=>({...t,target_id:manual?'t'+i:'b0t'+i}));
 const config={reviewPosFilter,allowModelHanja,allowModelLoanword,allowModelSegmentation};
 const input=manual?buildManualPrompt(context,wire,batchId,config):reviewInstructions(config)+'\n'+JSON.stringify(buildReviewPayload(context||'',wire,config).payload);
 // Estimate the current compact JSON schema: do not reserve removed confidence/evidence
 // fields. Still budget multiple subwords rather than assuming all words are whole.
 // Reserve enough reply space for multiple subwords; otherwise long documents
 // can exhaust the model's output limit even when the input fits comfortably.
 const reply=JSON.stringify({...(manual?{batch_id:batchId}:{}),results:wire.map(t=>{
  const choices=generatedChoices(t,config);
  if(choices.includes('GEN_SEGMENTS')){
   const pieces=Math.min(8,Math.max(1,Math.ceil(t.surface.length/2)));
   const segments=Array.from({length:pieces},(_,i)=>({
    start:i*2,end:Math.min(t.surface.length,i*2+2),surface:t.surface.slice(i*2,i*2+2),
    type:'hanja',replacement:'中'.repeat(Math.min(2,t.surface.length-i*2))
   }));
   return {target_id:t.target_id,choice_id:'GEN_SEGMENTS',segments};
  }
  return choices.length?{target_id:t.target_id,choice_id:choices[0],replacement:'W'.repeat(Math.max(4,t.surface.length))}:
    {target_id:t.target_id,choice_id:t.options.reduce((longest,o)=>JSON.stringify(o.choice_id).length>JSON.stringify(longest).length?o.choice_id:longest,'')};
 })});
 const contextTokens=limits[tier],inputTokens=estimateTokenCount(input)+(manual?0:64),outputTokens=Math.ceil(estimateTokenCount(reply)*1.1)+32;
 const safetyTokens=contextTokens?Math.ceil(contextTokens*.08)+1024:0,
  outputLimit=normalizeOutputLimitTokens(manual?manualOutputTokens:maxOutputTokens,manual?65536:16384);
 const reservedOutputTokens=outputTokens,totalTokens=inputTokens+reservedOutputTokens+safetyTokens;
 return {tier,label:tier==='32k'?'32K':tier==='128k'?'128K':tier==='256k'?'256K':tier==='512k'?'512K':'1M',estimated:true,contextTokens,inputTokens,outputTokens,reservedOutputTokens,safetyTokens,outputLimit,totalTokens,remainingTokens:contextTokens===null?null:contextTokens-totalTokens};
}

export function contextReviewBatches(items,context='',{tier='128k',manual=false,reviewPosFilter=true,allowModelHanja=false,allowModelLoanword=false,allowModelSegmentation=false,maxOutputTokens=16384,manualOutputTokens=65536}={}){
 tier=normalizeBatchContextTier(tier);if(tier==='current')throw Error('Explicit context capacity required');
 const rows=items.flatMap(item=>item.result.unresolved.map(target=>({item,target}))),batches=[];
 const fits=budget=>budget.totalTokens<=budget.contextTokens&&budget.outputTokens<=budget.outputLimit;
 for(let start=0;start<rows.length;){
  const memo=new Map();
  const evaluate=count=>{
   if(memo.has(count))return memo.get(count);
   const group=rows.slice(start,start+count),ownContext=[...new Set(group.map(r=>r.target.context))].join('\n');
   const budget=describeBatchBudget(ownContext,group.map(r=>r.target),{tier,manual,reviewPosFilter,allowModelHanja,allowModelLoanword,allowModelSegmentation,maxOutputTokens,manualOutputTokens}),value={rows:group,items:[...new Set(group.map(r=>r.item))],context:ownContext,budget};memo.set(count,value);return value;
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
   const full=describeBatchBudget(context,batch.rows.map(r=>r.target),{tier,manual,reviewPosFilter,allowModelHanja,allowModelLoanword,allowModelSegmentation,maxOutputTokens,manualOutputTokens});
   if(fits(full)){batch.context=context;batch.budget={...full,limitReason:batch.budget.limitReason};}
  }
  batches.push(batch);start+=low;
 }
 return batches;
}

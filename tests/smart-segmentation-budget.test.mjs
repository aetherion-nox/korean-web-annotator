import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewPayload,buildManualPrompt} from '../review-payload.js';
import {describeBatchBudget,contextReviewBatches} from '../batch-budget.js';
import {manualReviewBatches} from '../manual-review.js';

const phrase='가나다라 마바사';
const target={
 target_id:'t0',start:0,end:4,surface:'가나다라',context:phrase,
 repair_sentence_key:'page1',
 repair_context:{kiwi_tokens:[
  {form:'가나다라',tag:'NNG',start:0,end:4},
  {form:'마바사',tag:'NNG',start:5,end:8}
 ],protected_ranges:[]},
 options:[{choice_id:'KEEP',type:'keep',replacement:'가나다라',entry_id:null,definitions:[]},
  {choice_id:'c0',type:'hanja',replacement:'可那多羅',entry_id:1,definitions:['dictionary definition']}]
};

test('smart payload uses compact Kiwi arrays, does not duplicate top-level full context',()=>{
 const on=buildReviewPayload(phrase,[target],{smartSegmentation:true}).payload;
 const off=buildReviewPayload(phrase,[target],{}).payload;
 assert.deepEqual(on.sentences[0].kiwi_tokens,[['가나다라','NNG',0,4],['마바사','NNG',5,8]]);
 assert.equal(on.context,undefined);
 assert.equal(off.context,phrase);
 assert.equal(off.sentences[0].kiwi_tokens,undefined);
 assert.equal(on.targets[0].surface,target.surface);
 const scan={...target,scan_only:true,options:[target.options[0]],surface:phrase,end:phrase.length};
 const scanned=buildReviewPayload(phrase,[scan],{smartSegmentation:true}).payload;
 assert.equal(scanned.targets[0].surface,undefined);
 assert.equal(scanned.sentences[0].text,phrase);
});

test('smart context budgets agree with the actual compact prompt at page-wide re-evaluation',()=>{
 const settings={tier:'512k',manual:true,smartSegmentation:true};
 const fullContext=phrase.repeat(30),item={result:{unresolved:[target]}};
 const [batch]=contextReviewBatches([item],fullContext,settings);
 const recomputed=describeBatchBudget(batch.context,[target],settings);
 assert.equal(batch.budget.inputTokens,recomputed.inputTokens);
 assert.equal(batch.budget.outputTokens,recomputed.outputTokens);
 assert.ok(buildManualPrompt(batch.context,[target],'00000000',{smartSegmentation:true}).includes('kiwi_tokens'));
});

test('legacy manual context fallback estimates the optional repair prompt',()=>{
 const items=[{result:{unresolved:[target]}}];
 const smart=manualReviewBatches(items,phrase,{maxChars:2000,smartSegmentation:true});
 assert.equal(smart.length,1);
 const old=manualReviewBatches(items,phrase,{maxChars:2000,smartSegmentation:false});
 assert.equal(old.length,1);
 const smartPrompt=buildManualPrompt(smart[0].context,[{...target,target_id:'t0'}],'00000000',{smartSegmentation:true});
 const oldPrompt=buildManualPrompt(old[0].context,[{...target,target_id:'t0'}],'00000000',{smartSegmentation:false});
 assert.ok(smartPrompt.length>oldPrompt.length);
 assert.ok(smartPrompt.includes('repairs'));
});

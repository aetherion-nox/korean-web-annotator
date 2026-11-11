import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOfflineManualAnswer} from '../offline-manual-recovery.js';
import {prepareManualRequest} from '../manual-review.js';

function fixture(surface='학교',choiceId='學校',flags={}){
 const target={target_id:'t0',start:0,end:surface.length,surface,
  repair_sentence_key:'p0',original_target_id:'source0',options:[
   {choice_id:'KEEP',type:'keep',replacement:surface}
  ],...flags};
 const scope={text:surface,allTargets:flags.scan_only?[]:[
  {target_id:'source0',start:0,end:surface.length,surface}
 ],localAnnotations:[],protected_ranges:[],selected:[{start:0,end:surface.length}],existingRepairs:[]};
 const backup={requestId:'batch-0',bindings:[{target_id:'t0',sentenceId:'p0',start:0,end:surface.length,
  surface,choices:[{choice_id:'KEEP',annotations:[]}]}],
  recovery:{experimentalHanja:true,experimentalLoanword:true,smartSegmentation:true,
   reviewPosFilter:false,repairModes:{hanja:true,loanword:true},
   targets:[target],scopeGroups:[{sentenceKey:'p0',scope}]}};
 const response={batch_id:'batch-0',results:[{target_id:'t0',choice_id:choiceId}]};
 const sentences=new Map([['p0',{id:'p0',text:surface}]]);
 return {backup,response,sentences,scope};
}

test('offline accepts model-generated Hanja with correct reading and source positions',()=>{
 const {backup,response,sentences}=fixture();
 const result=validateOfflineManualAnswer(backup,response,sentences);
 assert.deepEqual(result.accepted[0].choice.annotations.map(a=>[a.surface,a.replacement]),[['학교','學校']]);
});

test('offline accepts original Latin loanwords without a service worker',()=>{
 const {backup,response,sentences}=fixture('컴퓨터','computer');
 const result=validateOfflineManualAnswer(backup,response,sentences);
 assert.equal(result.accepted[0].choice.annotations[0].type,'loanword');
 assert.equal(result.accepted[0].choice.annotations[0].replacement,'computer');
});

test('phonetic mismatch and protected names remain blocked',()=>{
 const wrong=fixture('학교','天地');
 assert.throws(()=>validateOfflineManualAnswer(wrong.backup,wrong.response,wrong.sentences),/검증|校验|词源/);
 const name=fixture('학교','學校',{proper_noun:true});
 assert.throws(()=>validateOfflineManualAnswer(name.backup,name.response,name.sentences),/검증|校验|词源/);
});

test('unknown target and mismatched source are never applied',()=>{
 const invalid=fixture();
 invalid.response.results[0].target_id='t9';
 assert.throws(()=>validateOfflineManualAnswer(invalid.backup,invalid.response,invalid.sentences),/target_id/);
 const stale=fixture();
 stale.sentences.set('p0',{id:'p0',text:'학기'});
 assert.throws(()=>validateOfflineManualAnswer(stale.backup,stale.response,stale.sentences),/失效/);
});

test('offline validates genuine add repairs and rejects protected-name overlap',()=>{
 const data=fixture('학교','KEEP',{scan_only:true});
 data.response.repairs=[{sentence_id:'s0',op:'add',old_target_ids:[],start:0,end:2,surface:'학교',choice_id:'學校'}];
 let outcome=validateOfflineManualAnswer(data.backup,data.response,data.sentences);
 assert.equal(outcome.repairs.length,1);
 assert.equal(outcome.repairs[0].annotations[0].replacement,'學校');
 data.scope.protected_ranges=[[0,2]];
 outcome=validateOfflineManualAnswer(data.backup,data.response,data.sentences);
 assert.equal(outcome.repairs.length,0);
 assert.match(outcome.rejectedRepairs[0].reason,/protected/);
});

test('prepared manual batch keeps validator scopes and local target IDs',()=>{
 const data=fixture();
 const targets=[{...data.backup.recovery.targets[0],target_id:'b0t0',context:'학교',
  options:[{choice_id:'KEEP',type:'keep',replacement:'학교',entry_id:null,definitions:[]}]}];
 const prepared=prepareManualRequest({context:'학교',smartSegmentation:true,
  experimentalHanja:true,experimentalLoanword:true,repairModes:{hanja:true,loanword:true},
  manualBindings:[{...data.backup.bindings[0],target_id:'b0t0'}],
  repairScopes:new Map([['b0t0',data.scope]])},targets);
 assert.equal(prepared.bindings[0].target_id,'t0');
 assert.equal(prepared.recovery.targets[0].target_id,'t0');
 assert.equal(prepared.recovery.scopeGroups[0].sentenceKey,'p0');
 assert.equal(prepared.recovery.repairModes.hanja,true);
});

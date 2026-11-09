import test from 'node:test';
import assert from 'node:assert/strict';
import {localBoundaryUnsafe} from '../review-boundary.js';
import {segmentationTargets} from '../segmentation-rescue.js';
import {validateChoices,modelTargets} from '../choice-review.js';
import {contextReviewBatches} from '../batch-budget.js';
const KEEP={choice_id:'KEEP',type:'keep',replacement:'',entry_id:null,definitions:[]};
function target(text,start,end,{partial_word=false,boundary_unverified=false}={}){
 const surface=text.slice(start,end);
 return {target_id:'t0',start,end,surface,context:text,partial_word,boundary_unverified,
  options:[{...KEEP,replacement:surface},{choice_id:'c0',type:'hanja',
    replacement:'各'.repeat(surface.length),entry_id:100,definitions:['dictionary entry']}]};
}
test('v1.1.61 incident: 文津街 cannot take a song title from a prefix',()=>{
 const text='서성구 문진가두 선거구';
 const a={start:4,end:7,surface:'문진가',type:'hanja',replacement:'問津歌'};
 assert.ok(localBoundaryUnsafe(text,a,{}));
 const hazards=[{start:4,end:9,reason:'unverified_word_boundary'}];
 const t=segmentationTargets(text,{stats:{protected_names:0},annotations:[],targets:[],
    boundary_risks:hazards,protected_name_spans:[]});
 assert.equal(t.length,1);assert.equal(t[0].surface,'문진가두');
});
test('v1.1.61 incident: each single character in a named building is not independent',()=>{
 const t=target('자광각 투표소',2,3,{partial_word:true});
 assert.equal(validateChoices([t],{results:[{target_id:'t0',choice_id:'c0'}]},{}).accepted[0].option.choice_id,'KEEP');
 assert.equal(modelTargets([t])[0].partial_word,true);
 const a={start:2,end:3,surface:'각',replacement:'各'};
 assert.ok(localBoundaryUnsafe(t.context,a,{}));
});
test('v1.1.61 incident: 참답게 was analyzed as noun 참; still retain Hangul',()=>{
 const t=target('참답게 작성',0,1,{boundary_unverified:true});
 assert.equal(validateChoices([t],{results:[{target_id:'t0',choice_id:'c0'}]},{}).accepted[0].option.choice_id,'KEEP');
 assert.equal(modelTargets([t])[0].boundary_unverified,true);
 assert.ok(localBoundaryUnsafe(t.context,{start:0,end:1,surface:'참'},{}));
});
test('grammatical particles and confirmed full headwords preserve legitimate conversion',()=>{
 assert.equal(localBoundaryUnsafe('학교를',{start:0,end:2,surface:'학교'},{suffix_spans:[{start:2,end:3}]}),false);
 assert.equal(localBoundaryUnsafe('팀장이',{start:1,end:2,surface:'장'},{
  confirmed_whole_spans:[{start:0,end:2}],suffix_spans:[{start:2,end:3}]}),false);
});
test('only evidence-bearing ranges are reviewed; names elsewhere do not disable the sentence',()=>{
 const text='습근평 문진가두 선거구';
 const list=segmentationTargets(text,{stats:{protected_names:1},
  protected_name_spans:[{start:0,end:3}],
  boundary_risks:[{start:4,end:9,reason:'unverified_word_boundary'}],
  annotations:[],targets:[]});
 assert.deepEqual(list.map(t=>t.surface),['문진가두']);
 assert.deepEqual(segmentationTargets('정치일반',{annotations:[],targets:[],stats:{}}),[]);
});
test('a 512K manual batch accommodates all 418 review targets when input/output fit',()=>{
 const context='문진가두',targets=Array.from({length:418},(_,i)=>{
  const surface='문진가두';return {...target(surface,0,5),target_id:'x'+i,segmentation_review:true};
 });
 const item={sentence:{id:'s',text:context},result:{unresolved:targets}};
 for(const tier of ['512k','1m']){
  const batches=contextReviewBatches([item],context,{tier,manual:true});
  assert.equal(batches.length,1,tier);
  assert.equal(batches[0].rows.length,418);
  assert.equal(batches[0].budget.limitReason,'end');
  assert.ok(batches[0].budget.totalTokens<=batches[0].budget.contextTokens);
 }
 const api=contextReviewBatches([item],context,{tier:'512k',manual:false,maxOutputTokens:131072});
 assert.equal(api.length,1);
 assert.equal(api[0].rows.length,418);
});

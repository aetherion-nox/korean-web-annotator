import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentationTargets} from '../segmentation-rescue.js';
import {mergeResegmentationTargets} from '../review-merge.js';
import {validateGeneratedSegmentsRow} from '../model-origin.js';
import {runSentencePipeline} from '../annotation-pipeline.js';
import {engineConfig} from '../local-engine.js';
import {modelTargets,validateChoices} from '../choice-review.js';
const config={allowModelSegmentation:true,allowModelHanja:true,allowModelLoanword:true};
const keep=(surface)=>({choice_id:'KEEP',type:'keep',replacement:surface,entry_id:null,definitions:[]});
const target=(start,end,surface,origin)=>({target_id:'t'+start,start,end,surface,context:'팀장이',options:[keep(surface),{choice_id:'c0',type:'hanja',replacement:origin,entry_id:start+1,definitions:['dictionary sense']}]});
test('known complete compound with particle is not sent for redundant model segmentation',()=>{
 const analysis={annotations:[{start:0,end:1,surface:'팀',replacement:'team',type:'loanword'},
   {start:1,end:2,surface:'장',replacement:'長',type:'hanja'}],targets:[],stats:{protected_names:0},
   confirmed_whole_spans:[{start:0,end:2}],suffix_spans:[{start:2,end:3}]};
 assert.deepEqual(segmentationTargets('팀장이',analysis),[]);
});
test('weak unique dictionary choice followed by particle remains one selectable dictionary task',()=>{
 const analysis={annotations:[],targets:[target(0,2,'이상','以上')],stats:{protected_names:0},
  suffix_spans:[{start:2,end:3}]};
 assert.deepEqual(segmentationTargets('이상은',analysis),[]);
});
test('unknown compound combines contained dictionary targets into one review',()=>{
 const analysis={annotations:[],targets:[target(0,1,'팀','team'),target(1,2,'장','長')],
   boundary_risks:[{start:0,end:2,surface:'팀장',reason:'kiwi_split_no_full_headword'}],
   suffix_spans:[{start:2,end:3}],stats:{protected_names:0}};
 const proposed=segmentationTargets('팀장이',analysis);
 assert.equal(proposed.length,1);
 const merged=mergeResegmentationTargets(analysis,proposed);
 assert.equal(merged.added,1);assert.equal(merged.removed,2);
 assert.equal(merged.targets.length,1);
 assert.equal(merged.targets[0].surface,'팀장이');
 assert.equal(merged.targets[0].component_candidates.length,2);
 assert.ok(merged.targets[0].review_reasons.includes('kiwi_split_no_full_headword'));
});
test('team + head is a valid adjacent two-morpheme mixed result; isolated one syllable remains forbidden',()=>{
 const t={target_id:'t0',surface:'팀장이',segmentation_review:true};
 const row={target_id:'t0',choice_id:'GEN_SEGMENTS',confidence:'high',
   evidence:'Team lead has mixed origin: team plus 長.',
   segments:[{start:0,end:1,surface:'팀',type:'loanword',replacement:'team'},
     {start:1,end:2,surface:'장',type:'hanja',replacement:'長'}]};
 const good=validateGeneratedSegmentsRow(t,row,config);
 assert.ok(good);assert.equal(good.replacement,'team長이');
 assert.equal(validateGeneratedSegmentsRow(t,{...row,segments:[row.segments[1]]},config),null);
});
test('two overlapping review tasks are never sent in the same batch',()=>{
 const text='학교생활을';
 const analysis={annotations:[],targets:[target(0,2,'학교','學校'),target(2,4,'생활','生活')],
  boundary_risks:[{start:0,end:4,reason:'kiwi_split_no_full_headword'}],stats:{protected_names:0}};
 const proposal=segmentationTargets(text,analysis);
 const merged=mergeResegmentationTargets(analysis,proposal);
 assert.equal(merged.targets.length,1);
 assert.equal(merged.targets[0].start,0);
 assert.equal(merged.targets[0].end,text.length);
});
test('new risk toggle defaults on and preserves explicitly disabled value',async()=>{
 globalThis.chrome={storage:{local:{get:async()=>({})}}};
 assert.equal((await engineConfig()).uniqueCandidateRiskReview,true);
 globalThis.chrome={storage:{local:{get:async()=>({uniqueCandidateRiskReview:false})}}};
 assert.equal((await engineConfig()).uniqueCandidateRiskReview,false);
 delete globalThis.chrome;
});
test('model pipeline reviews previously missed compound exactly once',async()=>{
 const text='팀장이',out=[];
 const status=async()=>({engine_version:'fixture',dictionary_fingerprint:'v'});
 const analyze=async()=>({engine_version:'fixture',dictionary_fingerprint:'v',annotations:[],
    targets:[],boundary_risks:[{start:0,end:2,surface:'팀장',reason:'kiwi_split_no_full_headword'}],
    suffix_spans:[{start:2,end:3}],stats:{protected_names:0,local_determined:0,pending:0,
    boundary_suspicions:1,unique_risk_reviews:0}});
 const modelConfig=async()=>({...config,endpoint:'https://test.invalid',model:'fixture',
  request:async(_conf,t)=>{
   assert.equal(t.length,1);assert.equal(t[0].surface,text);
   return {results:[{target_id:t[0].target_id,choice_id:'GEN_SEGMENTS',
    confidence:'high',evidence:'Known mixed-origin compound.',
    segments:[{start:0,end:1,surface:'팀',type:'loanword',replacement:'team'},
     {start:1,end:2,surface:'장',type:'hanja',replacement:'長'}]}]};
  }});
 await runSentencePipeline({operationId:'risk',experimentalSegmentation:true,
   sentences:[{id:'s',text}],modes:{hanja:true,loanword:true},uniqueCandidateRiskReview:true},
   e=>out.push(e),{status,analyze,modelConfig,enabled:true});
 const result=out.find(e=>e.type==='RESULTS'&&e.source==='model');
 assert.ok(result);
 assert.deepEqual(result.results[0].annotations.map(a=>({surface:a.surface,replacement:a.replacement})),
  [{surface:'팀',replacement:'team'},{surface:'장',replacement:'長'}]);
 assert.equal(out.find(e=>e.type==='DONE').stats.model_resegmented,1);
});

test('unknown current meaning can generate its real origin instead of borrowing the sole dictionary homophone',()=>{
 const current={target_id:'t0',start:3,end:5,surface:'원잠',context:'핵잠(원잠)',
  review_reasons:['weak_unique_dictionary_candidate'],
  options:[keep('원잠'),{choice_id:'c0',type:'hanja',replacement:'原蠶',
   entry_id:465818,definitions:['원잠종을 받기 위하여 계통을 바르게 한 누에.'],
   subject_category:'농업',written_form:'원잠',part_of_speech:'명사'}]};
 const inputs=modelTargets([current],{allowModelHanja:true});
 assert.deepEqual(inputs[0].generated_choices,['GEN_HANJA']);
 assert.equal(inputs[0].options[1].replacement,'原蠶');
 const generated={target_id:'t0',choice_id:'GEN_HANJA',replacement:'原潛'};
 const result=validateChoices([current],{results:[generated]}, {allowModelHanja:true});
 assert.equal(result.unresolved.length,0);
 assert.equal(result.accepted[0].option.replacement,'原潛');
 assert.equal(validateChoices([current],{results:[{...generated,choice_id:'c9'}]}, {allowModelHanja:true}).accepted.length,0);
});

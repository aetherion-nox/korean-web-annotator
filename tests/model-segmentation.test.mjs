import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentationTargets,MAX_SEGMENTATION_TARGETS} from '../segmentation-rescue.js';
import {generatedChoices,validateGeneratedSegmentsRow} from '../model-origin.js';
import {validateChoices} from '../choice-review.js';
import {buildReviewPayload,buildManualPrompt} from '../review-payload.js';
import {runSentencePipeline} from '../annotation-pipeline.js';
const config={allowModelSegmentation:true,allowModelHanja:true,allowModelLoanword:true};
const target=(source='학교생활을')=>({
 target_id:'seg0-'+source.length,start:0,end:source.length,surface:source,context:source,
 segmentation_review:true,options:[{choice_id:'KEEP',type:'keep',replacement:source,entry_id:null,definitions:[]}]
});
const proposal=(choice='GEN_SEGMENTS',parts=[{start:0,end:4,surface:'학교생활',type:'hanja',replacement:'學校生活'}])=>({
 target_id:'seg0-5',choice_id:choice,segments:parts,confidence:'high',evidence:'Known Korean Sino-Korean lexical origin in context'
});
test('raw phrase can be segmented without a Kiwi candidate',()=>{
 const raw='학교생활을',t=segmentationTargets(raw,{annotations:[],targets:[],stats:{}});
 assert.equal(t.length,1);assert.equal(t[0].surface,raw);
 assert.equal(generatedChoices(t[0],{}).length,0);
 assert.deepEqual(generatedChoices(t[0],config),['GEN_SEGMENTS']);
 const result=validateChoices(t,{results:[proposal()]},config);
 assert.equal(result.accepted.length,1);
 assert.equal(result.accepted[0].option.replacement,'學校生活을');
 assert.equal(result.accepted[0].option.segments.length,1);
 const payload=buildReviewPayload(raw,t,config).payload;
 assert.equal(payload.targets[0].segmentation_review,true);
 assert.deepEqual(payload.targets[0].generated_choices,['GEN_SEGMENTS']);
 assert.match(buildManualPrompt(raw,t,'batch-id',config),/GEN_SEGMENTS/);
});
test('multi-word independent resplitting with unconverted Korean particle',()=>{
 const t=target('학교생활과외국어를'),p={target_id:'seg0-9',choice_id:'GEN_SEGMENTS',confidence:'high',evidence:'Both compounds have known Sino-Korean origin',segments:[
 {start:0,end:4,surface:'학교생활',type:'hanja',replacement:'學校生活'},
 {start:5,end:8,surface:'외국어',type:'hanja',replacement:'外國語'}
 ]};
 const result=validateGeneratedSegmentsRow(t,p,config);
 assert.ok(result);assert.equal(result.segments.length,2);
 assert.equal(result.replacement,'學校生活과外國語를');
});
test('reject wrong offsets, word boundaries, unsafe origins and duplicate/overlap',()=>{
 const t=target();
 for(const parts of [
 [{start:0,end:4,surface:'학교생활',type:'hanja',replacement:'學校生'}],
 [{start:0,end:4,surface:'학교생할',type:'hanja',replacement:'學校生活'}],
 [{start:0,end:7,surface:'학교생활을',type:'hanja',replacement:'學校生活'}],
 [{start:0,end:4,surface:'학교생활',type:'hanja',replacement:'a<script>'}],
 [{start:0,end:4,surface:'학교생활',type:'loanword',replacement:'學校生活'}],
 [{start:0,end:4,surface:'학교생활',type:'hanja',replacement:'學校生活'},
  {start:2,end:4,surface:'생활',type:'hanja',replacement:'生活'}],
 [{start:0,end:1,surface:'학',type:'hanja',replacement:'學'}]
 ])assert.equal(validateGeneratedSegmentsRow(t,proposal('GEN_SEGMENTS',parts),config),null,JSON.stringify(parts));
 assert.equal(validateGeneratedSegmentsRow(t,{...proposal(),confidence:'medium'},config),null);
 assert.equal(validateGeneratedSegmentsRow(t,{...proposal(),unexpected:'X'},config),null);
 assert.equal(validateGeneratedSegmentsRow(t,proposal(),{...config,allowModelSegmentation:false}),null);
 assert.equal(validateGeneratedSegmentsRow(t,proposal(),{...config,allowModelHanja:false}),null);
 assert.equal(validateGeneratedSegmentsRow({...t,segmentation_review:false},proposal(),config),null);
});
test('never send protected names, partial existing full words, or >24-syllable fragments',()=>{
 const raw='김민수가 왔다.';
 assert.deepEqual(segmentationTargets(raw,{stats:{protected_names:1},annotations:[],targets:[]}),[]);
 assert.deepEqual(segmentationTargets('학교',{stats:{},annotations:[{start:0,end:2}],targets:[]}),[]);
 assert.deepEqual(segmentationTargets('학교',{stats:{},annotations:[],targets:[{start:0,end:2}]}),[]);
 assert.deepEqual(segmentationTargets('학교생활을',{stats:{},annotations:[],targets:[{start:1,end:3,dictionary_person_name:true}]}),[]);
 assert.deepEqual(segmentationTargets('가'.repeat(25),{stats:{},annotations:[],targets:[]}),[]);
 assert.deepEqual(segmentationTargets('학교생활을',{stats:{},annotations:[],targets:[]},[{start:2,end:4}]),[]);
});
test('independent rescue can override a partially converted local span',async()=>{
 const context='학교생활을',events=[],seen=[];
 const status=async()=>({engine_version:'test',dictionary_fingerprint:'fixture'});
 const analyze=async()=>({engine_version:'test',dictionary_fingerprint:'fixture',annotations:[{start:0,end:2,surface:'학교',replacement:'學校',type:'hanja'}],
    targets:[],stats:{local_determined:1,pending:0,protected_names:0,upstream_converted:0}});
 const modelConfig=async()=>({...config,endpoint:'https://fixture.test',model:'fixture',
 request:async(_config,targets)=>{
   seen.push(targets.map(t=>t.surface));
   return {results:targets.map(t=>({...proposal(),target_id:t.target_id}))};
 }});
 await runSentencePipeline({operationId:'seg-rescue',experimentalSegmentation:true,sentences:[{id:'s0',text:context}],
   modes:{hanja:true,loanword:false}},e=>events.push(e),{status,analyze,modelConfig,enabled:true});
 assert.deepEqual(seen,[['학교생활을']]);
 const models=events.filter(e=>e.type==='RESULTS'&&e.source==='model');
 assert.equal(models.length,1);
 assert.deepEqual(models[0].results[0].annotations.map(a=>({surface:a.surface,replacement:a.replacement,start:a.start,end:a.end})),
 [{surface:'학교생활',replacement:'學校生活',start:0,end:4}]);
 const done=events.find(e=>e.type==='DONE');assert.equal(done.stats.model_resegmented,1);
});
test('rescue is not activated when experimental flag is disabled',async()=>{
 const events=[];
 const analyze=async()=>({engine_version:'test',dictionary_fingerprint:'fixture',annotations:[],targets:[],stats:{local_determined:0,pending:0,protected_names:0}});
 await runSentencePipeline({operationId:'disabled',sentences:[{id:'s0',text:'학교생활을'}],modes:{hanja:true,loanword:false}},e=>events.push(e),
 {status:async()=>({engine_version:'test',dictionary_fingerprint:'fixture'}),analyze,enabled:true,modelConfig:async()=>{throw Error('must not call modelConfig')}});
 assert.equal(events.find(e=>e.type==='DONE').stats.pending,0);
});
test('rescues have a conservative bounded budget',()=>{
 assert.equal(MAX_SEGMENTATION_TARGETS,120);
 const text=Array.from({length:50},()=>'학교생활').join(' ');
 const t=segmentationTargets(text,{annotations:[],targets:[],stats:{}});
 assert.equal(t.length,12);
});

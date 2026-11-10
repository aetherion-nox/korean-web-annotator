import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentationTargets} from '../segmentation-rescue.js';
import {mergeResegmentationTargets,planSegmentationFallback} from '../review-merge.js';
import {generatedChoices,validateGeneratedSegmentsRow} from '../model-origin.js';
import {buildReviewPayload,buildManualPrompt,reviewInstructions} from '../review-payload.js';
import {validateChoices} from '../choice-review.js';
import {choicePreviewParser} from '../model-stream.js';
import {createManualReviewSession} from '../manual-review.js';
import {runSentencePipeline} from '../annotation-pipeline.js';
const config={allowModelSegmentation:true,allowModelHanja:true,allowModelLoanword:true};
const keep=s=>({choice_id:'KEEP',type:'keep',replacement:s,entry_id:null,definitions:[]});
const risk=(start,end,surface,reason='kiwi_split_no_full_headword')=>({start,end,surface,reason});
const target=(id,start,end,surface,flags={})=>({target_id:id,start,end,surface,
 context:'구인대가 활동한다',options:[keep(surface),
 {choice_id:'c0',type:'hanja',replacement:'區',entry_id:99,definitions:['a district administrative unit']}],...flags});
const generated=(id,segments)=>({target_id:id,choice_id:'GEN_SEGMENTS',segments,
 confidence:'high',evidence:'Established Sino-Korean institutional lexeme and its compositional original form.'});

test('unknown full compound gets one review using component dictionary evidence',()=>{
 const text='구인대가 활동한다';
 const analysis={annotations:[],protected_name_spans:[],stats:{protected_names:0},
  targets:[target('c0',0,1,'구',{proper_noun:true,suspected_person_name:true})],
  boundary_risks:[risk(0,3,'구인대')],suffix_spans:[{start:3,end:4}]};
 const proposed=segmentationTargets(text,analysis);
 assert.equal(proposed.length,1);
 assert.equal(proposed[0].surface,'구인대가');
 const merged=mergeResegmentationTargets(analysis,proposed);
 assert.equal(merged.added,1);assert.equal(merged.removed,1);
 assert.equal(merged.targets.length,1);
 assert.equal(merged.targets[0].component_candidates.length,1);
 assert.equal(merged.targets[0].component_candidates[0].options[1].replacement,'區');
 assert.equal(merged.targets[0].component_candidates[0].options[1].entry_id,99);
 assert.deepEqual(generatedChoices(merged.targets[0],config),['GEN_SEGMENTS']);
 const {payload}=buildReviewPayload(text,merged.targets,config);
 assert.equal(payload.targets[0].review_reasons[0],'kiwi_split_no_full_headword');
 assert.equal(payload.targets[0].component_candidates[0].surface,'구');
 assert.deepEqual(payload.targets[0].generated_choices,['GEN_SEGMENTS']);
 assert.match(buildManualPrompt(text,merged.targets,'testbatch',config),/GEN_SEGMENTS/);
});
test('a missing component can be supplied while the known component is preserved',()=>{
 const t={target_id:'t0',surface:'구인대가',segmentation_review:true,options:[keep('구인대가')]};
 const row=generated('t0',[
  {start:0,end:1,surface:'구',type:'hanja',replacement:'區'},
  {start:1,end:3,surface:'인대',type:'hanja',replacement:'人大'}
 ]);
 const accepted=validateChoices([t],{results:[row]},config);
 assert.equal(accepted.unresolved.length,0);
 assert.equal(accepted.accepted[0].option.replacement,'區人大가');
 assert.equal(accepted.accepted[0].option.segments.length,2);
});
test('a full unlisted Sino-Korean compound can be recovered in one segment',()=>{
 const t={target_id:'t0',surface:'중공중앙',segmentation_review:true,options:[keep('중공중앙')]};
 const row=generated('t0',[{start:0,end:4,surface:'중공중앙',type:'hanja',replacement:'中共中央'}]);
 const accepted=validateChoices([t],{results:[row]},config);
 assert.equal(accepted.unresolved.length,0);
 assert.equal(accepted.accepted[0].option.replacement,'中共中央');
 assert.ok(reviewInstructions(config).includes('Institutional or legal titles'));
 assert.ok(reviewInstructions(config).includes('dictionary may not contain'));
});
test('isolated unlisted nominal word can be sent even without a dictionary option',()=>{
 const text='인대',analysis={annotations:[],targets:[],protected_name_spans:[],stats:{protected_names:0},
  boundary_risks:[risk(0,2,'인대','unlisted_nominal_headword')]};
 const proposed=segmentationTargets(text,analysis);
 assert.equal(proposed.length,1);
 assert.deepEqual(proposed[0].options,[keep('인대')]);
 const answer=generated(proposed[0].target_id,[{start:0,end:2,surface:'인대',type:'hanja',replacement:'人大'}]);
 assert.equal(validateGeneratedSegmentsRow(proposed[0],answer,config).replacement,'人大');
});
test('actual protected person spans remain excluded; POS-only name hints do not',()=>{
 const text='홍길동';
 const origin={annotations:[],targets:[target('n',0,2,text.slice(0,2),{suspected_person_name:true,proper_noun:true})],
  boundary_risks:[risk(0,3,text,'unlisted_nominal_headword')],protected_name_spans:[],stats:{protected_names:0}};
 assert.equal(segmentationTargets(text,origin).length,1);
 const protectedAnalysis={...origin,protected_name_spans:[{start:0,end:3}],stats:{protected_names:1}};
 assert.deepEqual(segmentationTargets(text,protectedAnalysis),[]);
 assert.equal(mergeResegmentationTargets(protectedAnalysis,[{
  target_id:'seg0-3',start:0,end:3,surface:text,segmentation_review:true
 }]).added,0);
 assert.deepEqual(generatedChoices({surface:text,segmentation_review:true,dictionary_person_name:true},config),[]);
});
test('invalid offsets, invented fields and unsupported characters cannot bypass validation',()=>{
 const target={target_id:'t0',surface:'구인대',segmentation_review:true};
 const good=generated('t0',[{start:0,end:3,surface:'구인대',type:'hanja',replacement:'區人大'}]);
 assert.ok(validateGeneratedSegmentsRow(target,good,config));
 assert.equal(validateGeneratedSegmentsRow(target,{...good,confidence:'medium'},config),null);
 assert.equal(validateGeneratedSegmentsRow(target,{...good,extra:'yes'},config),null);
 const corrected=validateGeneratedSegmentsRow(target,{...good,segments:[{...good.segments[0],start:1}]},config);
 assert.ok(corrected); // unique source substring: numeric offset can be safely repaired
 assert.equal(corrected.segments[0].start,0);
 assert.equal(validateGeneratedSegmentsRow(target,{...good,segments:[{...good.segments[0],replacement:'DistrictAssembly'}]},config),null);
 assert.equal(validateGeneratedSegmentsRow(target,{...good,segments:[{...good.segments[0],replacement:'區人大會'}]},config),null);
});
test('manual JSON and streaming replies use the same whole-word validation',async()=>{
 const t={target_id:'orig',start:0,end:3,surface:'구인대',context:'구인대가 활동한다',
  segmentation_review:true,options:[keep('구인대')]};
 const row=generated('t0',[{start:0,end:3,surface:'구인대',type:'hanja',replacement:'區人大'}]);
 const previews=[],parser=choicePreviewParser([{...t,target_id:'t0'}],a=>previews.push(a),config);
 parser('{"results":['+JSON.stringify(row)+']}');
 assert.equal(previews.at(-1)[0].option.replacement,'區人大');
 const events=[],session=createManualReviewSession({operationId:'op',post:e=>events.push(e)});
 const waiting=session.request({context:t.context,...config},[t]);
 const request=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 assert.equal(session.submit({operationId:'op',requestId:request.requestId,
   text:JSON.stringify({batch_id:request.requestId,results:[row]})}),true);
 const output=await waiting;
 assert.deepEqual(output.results[0].segments,[row.segments[0]]);
 assert.equal(Object.hasOwn(output.results[0],'replacement'),false);
 assert.equal(output.results[0].segments[0].end,3);
});
test('pipeline can recover a dictionary-missing term and leaves particles unchanged',async()=>{
 const text='인대가';
 const events=[];
 const analyze=async()=>({engine_version:'fixture',dictionary_fingerprint:'f',annotations:[],targets:[],
  protected_name_spans:[],boundary_risks:[risk(0,2,'인대','unlisted_nominal_headword')],
  suffix_spans:[{start:2,end:3}],stats:{local_determined:0,pending:0,protected_names:0}});
 const modelConfig=async()=>({...config,endpoint:'https://example.test',model:'fixture',request:async(_,targets)=>{
  assert.deepEqual(targets.map(t=>t.surface),[text]);
  return {results:[generated(targets[0].target_id,[{start:0,end:2,surface:'인대',type:'hanja',replacement:'人大'}])]};
 }});
 await runSentencePipeline({operationId:'recover',sentences:[{id:'s',text}],
  modes:{hanja:true,loanword:false},experimentalSegmentation:true},
  e=>events.push(e),{enabled:true,analyze,status:async()=>({engine_version:'fixture',dictionary_fingerprint:'f'}),modelConfig});
 const result=events.find(e=>e.type==='RESULTS'&&e.source==='model');
 assert.ok(result);
 assert.deepEqual(result.results[0].annotations.map(a=>({surface:a.surface,replacement:a.replacement,start:a.start,end:a.end})),
  [{surface:'인대',replacement:'人大',start:0,end:2}]);
});

function conservativeFixture(){
 const text='학교생활을';
 const old=(id,start,end,surface,replacement)=>({
  target_id:id,start,end,surface,context:text,
  options:[keep(surface),{choice_id:'c0',type:'hanja',replacement,
   entry_id:start+40,definitions:['A dictionary sense of '+surface]}]
 });
 const analyze=async()=>({engine_version:'fixture',dictionary_fingerprint:'v',
  annotations:[],targets:[
   old('original-school',0,2,'학교','學校'),
   old('original-life',2,4,'생활','生活')
  ],protected_name_spans:[],
  boundary_risks:[{start:0,end:4,surface:'학교생활',reason:'kiwi_split_no_full_headword'}],
  suffix_spans:[{start:4,end:5}],stats:{local_determined:0,pending:2,protected_names:0}});
 const status=async()=>({engine_version:'fixture',dictionary_fingerprint:'v'});
 const whole={target_id:'b0t0',choice_id:'GEN_SEGMENTS',segments:[
  {start:0,end:4,surface:'학교생활',type:'hanja',replacement:'學校生活'}
 ]};
 return {text,analyze,status,whole};
}

test('merged original targets remain internal, and an unsafe compound requires whole-word re-review',async()=>{
 const {text,analyze}=conservativeFixture();
 const analysis=await analyze();
 const proposed=segmentationTargets(text,analysis);
 const merged=mergeResegmentationTargets(analysis,proposed);
 assert.equal(merged.removed,2);
 const whole=merged.targets[0];
 assert.deepEqual(whole.fallback_targets.map(t=>t.target_id),['original-school','original-life']);
 assert.equal(whole.fallback_targets[0].context,undefined);
 assert.equal(whole.fallback_targets[1].options[1].replacement,'生活');
 const prompt=buildReviewPayload(text,merged.targets,config);
 assert.equal(prompt.payload.targets[0].fallback_targets,undefined);
 assert.equal(JSON.stringify(prompt.payload).includes('"fallback_targets"'),false);
 const fallback=planSegmentationFallback(text,{...analysis,targets:merged.targets},
  [{target:whole,option:{choice_id:'KEEP',type:'keep'}}],[]);
 assert.equal(fallback.preserved,2);
 assert.equal(fallback.unsafeComponents,2);
 assert.equal(fallback.safeOriginals,0);
 assert.equal(fallback.wholeRechecks,1);
 assert.equal(fallback.targets[0].surface,'학교생활을');
 assert.match(fallback.targets[0].repair_feedback,/完整词干/);
 assert.equal(fallback.targets.length,1);
});

test('safe independent original dictionary candidates are re-reviewed, never blindly restored',()=>{
 const text='학교를';
 const original={target_id:'old',start:0,end:2,surface:'학교',context:text,
  options:[keep('학교'),{choice_id:'c0',type:'hanja',replacement:'學校',
    entry_id:41,definitions:['학교 교육 기관']}]};
 const parent={target_id:'seg0-3',start:0,end:3,surface:text,context:text,
  segmentation_review:true,options:[keep(text)],fallback_targets:[original]};
 const analysis={targets:[parent],suffix_spans:[{start:2,end:3}]};
 const plan=planSegmentationFallback(text,analysis,
  [{target:parent,option:{choice_id:'KEEP',type:'keep'}}],[]);
 assert.equal(plan.safeOriginals,1);
 assert.equal(plan.wholeRechecks,0);
 assert.equal(plan.targets[0].target_id,'old');
 assert.equal(plan.targets[0].fallback_dictionary_only,true);
 assert.equal(plan.targets[0].recovery_parent,parent.target_id);
 assert.deepEqual(generatedChoices(plan.targets[0],config),[]);
 assert.equal(validateChoices(plan.targets,
   {results:[{target_id:'old',choice_id:'c0'}]},config).accepted.length,1);
 const unsafe=planSegmentationFallback(text,{...analysis,targets:[{
  ...parent,fallback_targets:[{...original,boundary_unverified:true}]
 }]},[{target:parent,option:{choice_id:'KEEP',type:'keep'}}],[]);
 assert.equal(unsafe.safeOriginals,0);
 assert.equal(unsafe.wholeRechecks,1);
});

test('whole-word KEEP triggers a second safe complete-lexeme review, not subword auto-conversion',async()=>{
 const {text,analyze,status,whole}=conservativeFixture(),events=[],calls=[];
 const modelConfig=async()=>({...config,provider:'test',endpoint:'https://example.invalid',
  model:'test',request:async(conf,targets)=>{
   calls.push(targets);
   if(calls.length===1)return {results:[{target_id:targets[0].target_id,choice_id:'KEEP'}]};
   assert.equal(targets.length,1);
   assert.match(targets[0].repair_feedback,/component_candidates/);
   return {results:[{...whole,target_id:targets[0].target_id}]};
  }});
 const stats=await runSentencePipeline({operationId:'fallback',sentences:[{id:'s',text}],
  modes:{hanja:true,loanword:false},experimentalSegmentation:true},
  e=>events.push(e),{enabled:true,analyze,status,modelConfig});
 assert.equal(calls.length,2);
 assert.equal(stats.segmentation_preserved_targets,2);
 assert.equal(stats.segmentation_fallback_unsafe,2);
 assert.equal(stats.segmentation_fallback_full_retry,1);
 assert.equal(stats.segmentation_fallback_recovered,1);
 assert.equal(stats.model_review_keep,0);
 assert.equal(stats.model_annotation_spans,1);
 const final=events.filter(e=>e.type==='RESULTS'&&e.source==='model').at(-1);
 assert.deepEqual(final.results[0].annotations.map(a=>[a.surface,a.replacement]),
  [['학교생활','學校生活']]);
 assert.ok(events.some(e=>e.type==='DIAGNOSTIC'&&e.diagnostic?.stage==='annotation-audit'));
});

test('whole-word fallback KEEP never resurrects unjustified dictionary pieces',async()=>{
 const {text,analyze,status}=conservativeFixture(),events=[];
 const modelConfig=async()=>({...config,request:async(_config,targets)=>({
  results:targets.map(t=>({target_id:t.target_id,choice_id:'KEEP'}))
 })});
 const stats=await runSentencePipeline({operationId:'no-invented-recovery',
  sentences:[{id:'s',text}],modes:{hanja:true,loanword:false},
  experimentalSegmentation:true},e=>events.push(e),{enabled:true,analyze,status,modelConfig});
 assert.equal(stats.segmentation_fallback_recovered,0);
 assert.equal(stats.segmentation_fallback_unsafe,2);
 const last=events.filter(e=>e.type==='RESULTS'&&e.source==='model').at(-1);
 assert.deepEqual(last.results[0].annotations,[]);
 assert.equal(stats.model_review_keep,1);
});

test('manual whole-word fallback creates a second resumable manual batch',async()=>{
 const {text,analyze,status,whole}=conservativeFixture(),events=[];
 let session;
 session=createManualReviewSession({operationId:'manual-fallback',post:event=>{
  events.push(event);
  if(event.type==='MANUAL_REVIEW_REQUEST')queueMicrotask(()=>{
   const candidate=event.batchNumber===1?
    {target_id:'t0',choice_id:'KEEP'}:{...whole,target_id:'t0'};
   session.submit({operationId:'manual-fallback',requestId:event.requestId,
    text:JSON.stringify({batch_id:event.requestId,results:[candidate]})});
  });
 }});
 const modelConfig=async()=>({...config,manualReview:true,model:'fixture',
  request:async(cfg,targets)=>session.request(cfg,targets)});
 const emitted=[];
 const stats=await runSentencePipeline({operationId:'manual-fallback',sentences:[{id:'s',text}],
  modes:{hanja:true,loanword:false},experimentalSegmentation:true},
  e=>emitted.push(e),{enabled:true,analyze,status,modelConfig});
 assert.equal(stats.segmentation_fallback_recovered,1);
 const requests=events.filter(e=>e.type==='MANUAL_REVIEW_REQUEST');
 assert.equal(requests.length,2);
 assert.equal(requests[0].batchNumber,1);
 assert.equal(requests[1].batchNumber,2);
 assert.match(requests[1].text,/fallback_complete_lexeme/);
 assert.equal(emitted.filter(e=>e.type==='MANUAL_REVIEW_PLAN').length,2);
 assert.equal(emitted.filter(e=>e.type==='RESULTS'&&e.source==='model').at(-1).results[0].annotations[0].replacement,'學校生活');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentationTargets} from '../segmentation-rescue.js';
import {mergeResegmentationTargets} from '../review-merge.js';
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

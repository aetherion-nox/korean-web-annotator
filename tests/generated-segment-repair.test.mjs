import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalizeGeneratedSegments,validateGeneratedSegmentsRow,generatedChoices} from '../model-origin.js';
import {validateChoices,reviewTargets,reviewRepairFeedback} from '../choice-review.js';
import {choicePreviewParser} from '../model-stream.js';
import {createManualReviewSession} from '../manual-review.js';
import {segmentationTargets} from '../segmentation-rescue.js';
import {mergeResegmentationTargets} from '../review-merge.js';
const config={allowModelHanja:true,allowModelLoanword:true,allowModelSegmentation:true,reviewPosFilter:true};
const keep=s=>({choice_id:'KEEP',type:'keep',replacement:s,entry_id:null,definitions:[]});
function target(id,surface,details={}){
 return {target_id:id,start:0,end:surface.length,surface,context:surface,segmentation_review:true,options:[keep(surface)],...details};
}
const gen=(id,surface,start,end,type,replacement)=>({target_id:id,choice_id:'GEN_SEGMENTS',
  segments:[{start,end,surface,type,replacement}],confidence:'high',evidence:'Etymological spelling corroborated by source context and lexical evidence.'});
function groundedTicket(){
 const evidence={start:1,end:2,surface:'표',options:[keep('표'),
 {choice_id:'c9',entry_id:521095,type:'hanja',replacement:'票',
  written_form:'표',part_of_speech:'명사',definitions:['선거 때 의사를 적는 쪽지.']}]};
 return target('t182','한표를',{component_candidates:[evidence],
  morphology:[{start:0,end:1,form:'한',tag:'MM'},
   {start:1,end:2,form:'표',tag:'NNG'},
   {start:2,end:3,form:'를',tag:'JKO'}]});
}
const shortTicket=gen('t182','표',1,2,'hanja','票');
const ballon=id=>target(id,id==='t266'||id==='t305'?'발롱도르는':'발롱도르');
const wrongBallon=id=>gen(id,'발롱도르',0,5,'loanword',"Ballon d'Or");
test('the four Korean syllables in Ballon d’Or are realigned by unique surface without hallucinating source text',()=>{
 for(const id of ['t262','t266','t301','t305']){
  const t=ballon(id),row=wrongBallon(id);
  assert.equal(row.segments[0].end,5);
  const canonical=canonicalizeGeneratedSegments(t,row.segments);
  assert.deepEqual(canonical[0].end,4);
  const result=validateGeneratedSegmentsRow(t,row,config);
  assert.ok(result,id);
  assert.equal(result.segments[0].end,4);
  assert.equal(result.replacement,"Ballon d'Or"+(t.surface.endsWith('는')?'는':''));
 }
});
test('unresolvable duplicate substrings are never guessed, while accurate offsets stay valid',()=>{
 const t=target('dup','가가가');
 const bad=gen('dup','가',0,2,'hanja','家');
 assert.equal(canonicalizeGeneratedSegments(t,bad.segments),null);
 assert.equal(validateGeneratedSegmentsRow(t,bad,config),null);
 const correct={...bad,segments:[{...bad.segments[0],start:1,end:2}]};
 assert.equal(validateGeneratedSegmentsRow(t,correct,config),null); // no standalone one-syllable evidence
 assert.equal(canonicalizeGeneratedSegments(t,correct.segments)[0].start,1);
 const missing={...bad,segments:[{...bad.segments[0],surface:'나'}]};
 assert.equal(canonicalizeGeneratedSegments(t,missing.segments),null);
});
test('documented ballot counter after determiner, before case particle, is an allowed isolated one-syllable conversion',()=>{
 const t=groundedTicket();
 const result=validateChoices([t],{results:[shortTicket]},config);
 assert.equal(result.unresolved.length,0);
 assert.equal(result.accepted[0].option.replacement,'한票를');
 assert.deepEqual(result.accepted[0].option.segments,[shortTicket.segments[0]]);
});
test('a phonetic character match inside a named location is still not enough',()=>{
 const t=target('site','자광각',{component_candidates:[{start:2,end:3,surface:'각',
  options:[{choice_id:'c0',entry_id:5,type:'hanja',replacement:'各',written_form:'각',definitions:['each']}] }],
  morphology:[{start:0,end:2,form:'자광',tag:'NNG'},{start:2,end:3,form:'각',tag:'MM'}]});
 assert.equal(validateGeneratedSegmentsRow(t,gen('site','각',2,3,'hanja','各'),config),null);
 const noDictionary=target('ticket','한표를',{morphology:groundedTicket().morphology});
 assert.equal(validateGeneratedSegmentsRow(noDictionary,shortTicket,config),null);
 const noGrammar=target('ticket','한표를',{component_candidates:groundedTicket().component_candidates});
 assert.equal(validateGeneratedSegmentsRow(noGrammar,shortTicket,config),null);
});
test('whole-token unknown NNP cannot invent a foreign person name from pronunciation alone',()=>{
 const t=target('person','호날두',{name_risk:true});
 assert.deepEqual(generatedChoices(t,config),['GEN_SEGMENTS']);
 assert.equal(validateGeneratedSegmentsRow(t,gen('person','호날두',0,3,'loanword','Ronaldo'),config),null);
 const ordinary=target('word','컴퓨터');
 assert.ok(validateGeneratedSegmentsRow(ordinary,gen('word','컴퓨터',0,3,'loanword','computer'),config));
 const institution=target('inst','국가위원회',{name_risk:true});
 assert.ok(validateGeneratedSegmentsRow(institution,gen('inst','국가위원회',0,5,'hanja','國家委員會'),config));
});
test('Kiwi morphology is relative to the word target, with no forced human-name whitelist',()=>{
 const text='한표를';
 const analysis={targets:[{target_id:'component',start:1,end:2,surface:'표',options:groundedTicket().component_candidates[0].options}],
  annotations:[],boundary_risks:[{start:0,end:3,reason:'unverified_word_boundary'}],
  protected_name_spans:[],stats:{protected_names:0},
  token_morphology:[{start:0,end:1,form:'한',tag:'MM'},{start:1,end:2,form:'표',tag:'NNG'},
   {start:2,end:3,form:'를',tag:'JKO'}]};
 const extra=segmentationTargets(text,analysis);
 assert.equal(extra.length,1);
 const merged=mergeResegmentationTargets(analysis,extra);
 assert.equal(merged.targets.length,1);
 assert.deepEqual(merged.targets[0].morphology,groundedTicket().morphology);
 assert.equal(validateChoices(merged.targets,{results:[{...shortTicket,target_id:merged.targets[0].target_id}]},config).accepted.length,1);
});
test('streaming validator canonicalizes wrong Ballon d’Or offsets',()=>{
 const t=ballon('t266'),seen=[];
 const parser=choicePreviewParser([t],accepted=>seen.push(accepted),config);
 parser('{"results":['+JSON.stringify(wrongBallon('t266'))+']}');
 assert.equal(seen.at(-1)[0].option.segments[0].end,4);
});
test('402-row manual JSON saves canonicalized valid rows and requests only the unsafe row',async()=>{
 const targets=Array.from({length:402},(_,i)=>i===182?groundedTicket():
  [262,266,301,305].includes(i)?ballon('t'+i):
  i===268?target('t268','호날두',{name_risk:true}):
  target('t'+i,'학교'));
 const events=[],session=createManualReviewSession({operationId:'bulk',post:e=>events.push(e)});
 const pending=session.request({...config,context:'simulation of 402 real ids'},targets);
 const init=events.find(x=>x.type==='MANUAL_REVIEW_REQUEST');
 const rows=targets.map((t,i)=>i===182?shortTicket:[262,266,301,305].includes(i)?wrongBallon('t'+i):
  i===268?gen('t268','호날두',0,3,'loanword','Ronaldo'):
  {target_id:'t'+i,choice_id:'KEEP'});
 assert.equal(session.submit({operationId:'bulk',requestId:init.requestId,text:JSON.stringify({batch_id:init.requestId,results:rows})}),false);
 const error=events.at(-1);
 assert.equal(error.type,'MANUAL_REVIEW_ERROR');
 assert.equal(error.acceptedCount,401);
 assert.deepEqual(error.invalidTargetIds,['t268']);
 assert.equal(error.acceptedRows.find(r=>r.target_id==='t262').segments[0].end,4);
 assert.equal(error.acceptedRows.find(r=>r.target_id==='t182').segments[0].replacement,'票');
 assert.match(error.repairPrompt,/t268/);
 assert.doesNotMatch(error.repairPrompt,/\"target_id\":\"t182\"/);
 assert.match(error.repairPrompt,new RegExp(init.requestId));
 const repaired={batch_id:init.requestId,results:[{target_id:'t268',choice_id:'KEEP'}]};
 assert.equal(session.submit({operationId:'bulk',requestId:init.requestId,text:JSON.stringify(repaired)}),true);
 const output=await pending;
 assert.equal(output.results.length,402);
 assert.equal(output.results[262].segments[0].end,4);
 assert.equal(output.results[182].segments[0].replacement,'票');
 assert.equal(Object.hasOwn(output.results[182],'replacement'),false);
 assert.equal(output.results[268].choice_id,'KEEP');
});
test('unknown IDs or duplicate patch rows never erase previously validated decisions',async()=>{
 const events=[],targets=[target('a','학교'),target('b','발롱도르')];
 const session=createManualReviewSession({operationId:'partial',post:e=>events.push(e)});
 const pending=session.request(config,targets);const request=events[0].requestId;
 assert.equal(session.submit({operationId:'partial',requestId:request,
  text:JSON.stringify({batch_id:request,results:[{target_id:'t0',choice_id:'KEEP'}]})}),false);
 assert.equal(events.at(-1).acceptedCount,1);
 assert.equal(session.submit({operationId:'partial',requestId:request,
  text:JSON.stringify({batch_id:request,results:[{target_id:'bogus',choice_id:'KEEP'}]})}),false);
 assert.equal(session.submit({operationId:'partial',requestId:request,
  text:JSON.stringify({batch_id:request,results:[{target_id:'t1',choice_id:'KEEP'},{target_id:'t1',choice_id:'KEEP'}]})}),false);
 assert.equal(session.submit({operationId:'partial',requestId:request,
  text:JSON.stringify({batch_id:request,results:[{target_id:'t1',choice_id:'KEEP'}]})}),true);
 assert.equal((await pending).results.length,2);
});

test('whole-lexeme corrective feedback repairs an isolated Hanja syllable without guessing missing characters',()=>{
 const t=target('t0','공영');
 const invalid={target_id:'t0',choice_id:'GEN_SEGMENTS',
  segments:[{start:0,end:1,surface:'공',type:'hanja',replacement:'公'}]};
 const diagnosis=reviewRepairFeedback(t,[invalid],config);
 assert.match(diagnosis,/ISOLATED_SYLLABLE/);
 assert.match(diagnosis,/공영/);
 assert.match(diagnosis,/완전|完整|整个|完整目标|完整词干/);
 assert.equal(validateChoices([t],{results:[invalid]},config).accepted.length,0);
 const whole={target_id:'t0',choice_id:'GEN_SEGMENTS',segments:[
  {start:0,end:2,surface:'공영',type:'hanja',replacement:'公營'}]};
 const valid=validateChoices([t],{results:[whole]},config);
 assert.equal(valid.accepted.length,1);
 assert.equal(valid.accepted[0].option.replacement,'公營');
 const attached=target('suffix','공영을');
 assert.equal(validateGeneratedSegmentsRow(attached,{...whole,target_id:'suffix'},config)?.replacement,'公營을');
});

test('manual repair supplies the exact failed target and recommends complete lexical analysis',async()=>{
 const targets=[target('a','공영'),target('b','학교')],events=[];
 const session=createManualReviewSession({operationId:'whole-word',post:e=>events.push(e)});
 const pending=session.request({...config,context:'공영을 운영한다.'},targets);
 const request=events[0].requestId;
 const first={batch_id:request,results:[
  {target_id:'t0',choice_id:'GEN_SEGMENTS',segments:[
   {start:0,end:1,surface:'공',type:'hanja',replacement:'公'}]},
  {target_id:'t1',choice_id:'KEEP'}
 ]};
 assert.equal(session.submit({operationId:'whole-word',requestId:request,text:JSON.stringify(first)}),false);
 const error=events.at(-1);
 assert.equal(error.acceptedCount,1);
 assert.deepEqual(error.invalidTargetIds,['t0']);
 assert.match(error.repairPrompt,/repair_feedback/);
 assert.match(error.repairPrompt,/ISOLATED_SYLLABLE/);
 assert.match(error.repairPrompt,/公營|完整词干/);
 assert.match(error.repairPrompt,/"surface":"공영"/);
 assert.doesNotMatch(error.repairPrompt,/"target_id":"t1"/);
 const second={batch_id:request,results:[{target_id:'t0',choice_id:'GEN_SEGMENTS',
  segments:[{start:0,end:2,surface:'공영',type:'hanja',replacement:'公營'}]}]};
 assert.equal(session.submit({operationId:'whole-word',requestId:request,text:JSON.stringify(second)}),true);
 const done=await pending;
 assert.equal(done.results.length,2);
 assert.equal(done.results[0].target_id,'a');
 assert.equal(done.results[0].segments[0].replacement,'公營');
 assert.equal(done.results[1].choice_id,'KEEP');
});

test('automatic second attempt receives specific failure feedback and keeps valid first answers',async()=>{
 const t=target('orig','공영'),keepTarget=target('safe','학교');
 const calls=[];
 const result=await reviewTargets({...config,enableModelReview:true,model:'test',
  request:async(_configuration,targets)=>{
   calls.push(targets);
   if(calls.length===1)return {results:[
    {target_id:'orig',choice_id:'GEN_SEGMENTS',segments:[
     {start:0,end:1,surface:'공',type:'hanja',replacement:'公'}]},
    {target_id:'safe',choice_id:'KEEP'}
   ]};
   return {results:[{target_id:'orig',choice_id:'GEN_SEGMENTS',
    segments:[{start:0,end:2,surface:'공영',type:'hanja',replacement:'公營'}]}]};
  }},[t,keepTarget]);
 assert.equal(calls.length,2);
 assert.equal(calls[0][0].repair_feedback,undefined);
 assert.equal(calls[1].length,1);
 assert.equal(calls[1][0].target_id,'orig');
 assert.match(calls[1][0].repair_feedback,/ISOLATED_SYLLABLE/);
 assert.match(calls[1][0].repair_feedback,/공영/);
 assert.equal(result.unresolved.length,0);
 assert.equal(result.accepted.length,2);
 assert.equal(result.accepted.find(a=>a.target.target_id==='orig').option.replacement,'公營');
 assert.equal(result.accepted.find(a=>a.target.target_id==='safe').option.choice_id,'KEEP');
});

test('unique exact subword offsets can be inferred and normalized before any rendering',()=>{
 const t=target('word','공영을');
 const row={target_id:'word',choice_id:'GEN_SEGMENTS',segments:[
  {surface:'공영',type:'hanja',replacement:'公營'}]};
 const accepted=validateGeneratedSegmentsRow(t,row,config);
 assert.ok(accepted);
 assert.equal(accepted.replacement,'公營을');
 assert.deepEqual(accepted.segments.map(p=>[p.start,p.end]),[[0,2]]);
 const checked=validateChoices([t],{results:[row]},config);
 assert.equal(checked.accepted.length,1);
 assert.equal(checked.accepted[0].option.segments[0].start,0);
 assert.equal(checked.accepted[0].option.segments[0].end,2);
 assert.match(reviewInstructions(config),/Omit BOTH start and end/);
});

test('repeated or partially specified segment offsets remain invalid, even when the characters are valid',()=>{
 const t=target('repeated','학교학교');
 const compact={target_id:'repeated',choice_id:'GEN_SEGMENTS',
  segments:[{surface:'학교',type:'hanja',replacement:'學校'}]};
 assert.equal(validateGeneratedSegmentsRow(t,compact,config),null);
 assert.equal(validateChoices([t],{results:[compact]},config).accepted.length,0);
 assert.equal(validateGeneratedSegmentsRow(t,{...compact,segments:[
  {...compact.segments[0],start:2}
 ]},config),null);
 const exact={...compact,segments:[{...compact.segments[0],start:2,end:4}]};
 const verified=validateGeneratedSegmentsRow(t,exact,config);
 assert.ok(verified);
 assert.equal(verified.replacement,'학교學校');
 assert.equal(validateGeneratedSegmentsRow(t,{...compact,segments:[
  {surface:'없는',type:'hanja',replacement:'學校'}
 ]},config),null);
});

test('manual review normalizes optional offsets without relaxing same-batch ID authorization',async()=>{
 const entry=target('original','공영을'),events=[];
 const session=createManualReviewSession({operationId:'compact-offset',post:e=>events.push(e)});
 const pending=session.request({...config,context:'공영을 운영하다.'},[entry]);
 const request=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 const submitted={batch_id:request.requestId,results:[
  {target_id:'t0',choice_id:'GEN_SEGMENTS',segments:[
   {surface:'공영',type:'hanja',replacement:'公營'}
  ]}
 ]};
 assert.equal(session.submit({operationId:'compact-offset',requestId:request.requestId,
  text:JSON.stringify(submitted)}),true);
 const result=await pending;
 assert.deepEqual(result.results[0].segments,[{
  start:0,end:2,surface:'공영',type:'hanja',replacement:'公營'
 }]);
});

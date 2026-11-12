import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewPayload,buildManualPrompt} from '../review-payload.js';
import {validateSegmentationRepairs} from '../segmentation-repairs.js';
import {reviewTargets} from '../choice-review.js';
import {createManualReviewSession} from '../manual-review.js';
import {runSentencePipeline} from '../annotation-pipeline.js';

const word=(id,text,start,end)=>({target_id:id,original_target_id:id,
 repair_sentence_key:'paragraphA',start,end,surface:text.slice(start,end),context:text,
 repair_context:{kiwi_tokens:[],protected_ranges:[]},options:[
  {choice_id:'KEEP',type:'keep',replacement:text.slice(start,end),entry_id:null,definitions:[]},
  {choice_id:'c0',type:'hanja',replacement:'科學',entry_id:1,definitions:['science']}
 ]});
const fixture=(text,targets)=>{const config={context:text,smartSegmentation:true,reviewPosFilter:false,
 repairModes:{hanja:true,loanword:true},hanjaReadingCheck:true,
 repairScopes:new Map(targets.map(t=>[t.target_id,{text,allTargets:targets.filter(t=>!t.scan_only),
  localAnnotations:[],protected_ranges:[],selected:null,existingRepairs:[]}]))};
 const pool=buildReviewPayload(text,targets,config).payload;
 return {config,sid:pool.sentences[0].sentence_id};
};
const replace=(sid,id,start,end,surface,choice_id)=>({
 sentence_id:sid,op:'replace',old_target_ids:[id],start,end,surface,choice_id
});
test('atomic repair does not require KEEP for unchanged native suffix',()=>{
 const text='과학이야기',t=word('t0',text,0,text.length),f=fixture(text,[t]);
 const output={results:[],repairs:[replace(f.sid,'t0',0,2,'과학','科學')]};
 const valid=validateSegmentationRepairs([t],output,f.config);
 assert.equal(valid.accepted.length,1,JSON.stringify(valid.rejected));
 assert.deepEqual(valid.accepted[0].source_target_ids,['t0']);
 assert.deepEqual(valid.accepted[0].annotations.map(a=>[a.surface,a.replacement]),[['과학','科學']]);
 assert.match(buildManualPrompt(text,[t],'id',f.config),/omit results for retired targets/i);
});
test('review validation requires only unreplaced originals, not retired target or scan-only placeholders',async()=>{
 const text='과학이야기',t=word('t0',text,0,text.length),f=fixture(text,[t]);
 const repairs=[],response={results:[],repairs:[replace(f.sid,'t0',0,2,'과학','科學')]};
 const r=await reviewTargets({...f.config,enableModelReview:true,
  onRepairs:parts=>repairs.push(...parts),
  request:async()=>response},[t]);
 assert.equal(r.unresolved.length,0);
 assert.equal(r.accepted.length,0);
 assert.equal(repairs.length,1);
 const scan={...word('scan',text,0,text.length),scan_only:true,
  options:[{choice_id:'KEEP',type:'keep',replacement:text,entry_id:null,definitions:[]}]};
 const sf=fixture(text,[scan]);
 const scanned=await reviewTargets({...sf.config,enableModelReview:true,request:async()=>({results:[]})},[scan]);
 assert.equal(scanned.unresolved.length,0);
});
test('failed repair never retires original target; a normal old result remains valid fallback',async()=>{
 const text='과학이야기',t=word('t0',text,0,text.length),f=fixture(text,[t]);
 const bad=replace(f.sid,'t0',0,2,'과학','韓國');
 const check=await reviewTargets({...f.config,enableModelReview:true,
  request:async()=>({results:[],repairs:[bad]})},[t]);
 assert.equal(check.unresolved.length,1);
 const withFallback=await reviewTargets({...f.config,enableModelReview:true,
  request:async()=>({results:[{target_id:'t0',choice_id:'c0'}],repairs:[bad]})},[t]);
 assert.equal(withFallback.accepted.length,1);
 assert.equal(withFallback.accepted[0].option.choice_id,'c0');
});
test('add excludes KEEP; delete can omit choice_id and suppress old result safely',()=>{
 const text='과학이야기',t=word('t0',text,0,text.length),f=fixture(text,[t]);
 assert.equal(validateSegmentationRepairs([t],{repairs:[{
  sentence_id:f.sid,op:'add',old_target_ids:[],start:2,end:5,surface:'이야기',choice_id:'KEEP'
 }]},f.config).accepted.length,0);
 const deletion={sentence_id:f.sid,op:'delete',old_target_ids:['t0'],
  start:0,end:text.length,surface:text};
 const v=validateSegmentationRepairs([t],{results:[],repairs:[deletion]},f.config);
 assert.equal(v.accepted.length,1,JSON.stringify(v.rejected));
 assert.equal(v.accepted[0].choice_id,'KEEP');
 assert.deepEqual(v.accepted[0].annotations,[]);
});
test('manual submit accepts missing superseded target answer and forwards only valid repair',async()=>{
 const text='과학이야기',t=word('original',text,0,text.length),f=fixture(text,[t]),events=[];
 const session=createManualReviewSession({operationId:'atomic',post:e=>events.push(e)});
 const pending=session.request(f.config,[t]);
 const event=events.find(x=>x.type==='MANUAL_REVIEW_REQUEST');
 const answer={batch_id:event.requestId,results:[],
  repairs:[replace('s0','t0',0,2,'과학','科學')]};
 assert.equal(session.submit({operationId:'atomic',requestId:event.requestId,text:JSON.stringify(answer)}),true);
 const resolved=await pending;
 assert.deepEqual(resolved.results,[]);
 assert.equal(resolved.repairs.length,1);
 assert.deepEqual(resolved.repairs[0].old_target_ids,['original']);
 assert.ok(events.some(e=>e.type==='MANUAL_REVIEW_ACCEPTED'&&e.retiredTargetIds.includes('t0')));
});
test('manual partial answer retries only the unrepaired original and retains successful repair',async()=>{
 const text='과학이야기 게임',first=word('first',text,0,5),second=word('second',text,6,8);
 const f=fixture(text,[first,second]),events=[];
 const session=createManualReviewSession({operationId:'atomic-retry',post:e=>events.push(e)});
 const pending=session.request(f.config,[first,second]);
 const event=events.find(x=>x.type==='MANUAL_REVIEW_REQUEST');
 const partial={batch_id:event.requestId,results:[],repairs:[replace('s0','t0',0,2,'과학','科學')]};
 assert.equal(session.submit({operationId:'atomic-retry',requestId:event.requestId,text:JSON.stringify(partial)}),false);
 const problem=events.findLast(e=>e.type==='MANUAL_REVIEW_ERROR');
 assert.deepEqual(problem.invalidTargetIds,['t1']);
 assert.deepEqual(problem.retiredTargetIds,['t0']);
 assert.equal(problem.acceptedRepairs.length,1);
 assert.match(problem.repairPrompt,/t1/);
 const retry={batch_id:event.requestId,results:[{target_id:'t1',choice_id:'KEEP'}],
  // The earlier valid fragment cannot be undone by a later conflicting edit.
  repairs:[replace('s0','t0',0,2,'과학','韓國')]};
 assert.equal(session.submit({operationId:'atomic-retry',requestId:event.requestId,text:JSON.stringify(retry)}),true);
 const final=await pending;
 assert.deepEqual(final.results,[{target_id:'second',choice_id:'KEEP'}]);
 assert.deepEqual(final.repairs[0].old_target_ids,['first']);
});
test('pipeline renders only the new Hanja fragment when the old original target is superseded',async()=>{
 const text='과학이야기',t=word('local',text,0,text.length);
 // This mocked upstream dictionary option must project to the entire
 // original target, or validateAnalysis correctly removes the bad candidate.
 t.options[1].replacement='科學異野記';
 const f=fixture(text,[t]),events=[];
 await runSentencePipeline({operationId:'repair-only',sentences:[{id:'paragraphA',text}],
  modes:{hanja:true,loanword:true},smartSegmentation:true,progressiveAnnotation:true},e=>events.push(e),{
  enabled:true,status:async()=>({ready:true,engine_version:'fixture',dictionary_fingerprint:'fixture'}),
  analyze:async()=>({engine_version:'fixture',dictionary_fingerprint:'fixture',
   annotations:[],targets:[t],repair_context:{kiwi_tokens:[],protected_ranges:[]},stats:{pending:1}}),
  modelConfig:async()=>({...f.config,enableModelReview:true,experimentalHanja:true,experimentalLoanword:true,
   request:async(_,targets)=>({results:[],repairs:[replace('s0',targets[0].target_id,0,2,'과학','科學')]})})
 });
 const rendered=events.filter(e=>e.type==='RESULTS'&&e.source==='model');
 assert.ok(rendered.length);
 assert.deepEqual(rendered.at(-1).results[0].annotations.map(a=>[a.surface,a.replacement]),[['과학','科學']]);
 assert.equal(events.at(-1).type,'DONE');
});

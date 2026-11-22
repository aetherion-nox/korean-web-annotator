import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ENGINE_SWITCH_DEFAULTS,engineSwitchValues} from '../engine-defaults.js';
import {validateChoices,validateExperimentalChoices,reviewTargets} from '../choice-review.js';
import {buildManualPrompt,buildReviewPayload,normalizePooledChoiceAnswers} from '../review-payload.js';
import {createManualReviewSession} from '../manual-review.js';
import {choicePreviewParser,experimentalChoicePreviewParser} from '../model-stream.js';

const keep=s=>({choice_id:null,type:'keep',replacement:s,entry_id:null,definitions:[]});
const sense=(id,hanja,entry=1)=>({choice_id:id,type:'hanja',replacement:hanja,entry_id:entry,definitions:['test']});
const target=(id,text,options=[sense('c0','經濟')])=>({
 target_id:id,context:text,start:0,end:text.length,surface:text,
 options:[keep(text),...options]
});
const strict={retryInvalidDictionaryChoices:true,discardInvalidReviewResults:false,reviewPosFilter:false};
const discard={retryInvalidDictionaryChoices:false,discardInvalidReviewResults:true,reviewPosFilter:false};
const response=(t,c)=>({results:[{t,c}]});
const wireJSON=prompt=>JSON.parse(prompt.slice(prompt.indexOf('{"format":"shared-pools-v5"')));

test('exactly one invalid-result strategy is enforced including migrated both-off settings',()=>{
 assert.equal(ENGINE_SWITCH_DEFAULTS.retryInvalidDictionaryChoices,true);
 assert.equal(ENGINE_SWITCH_DEFAULTS.discardInvalidReviewResults,false);
 for(const [saved,retry,discard] of [
  [{},true,false],
  [{retryInvalidDictionaryChoices:false,discardInvalidReviewResults:false},true,false],
  [{retryInvalidDictionaryChoices:true,discardInvalidReviewResults:true},false,true],
  [{retryInvalidDictionaryChoices:false,discardInvalidReviewResults:true},false,true],
  [{retryInvalidDictionaryChoices:true,discardInvalidReviewResults:false},true,false],
 ]) {
  const values=engineSwitchValues(saved);
  assert.equal(values.retryInvalidDictionaryChoices,retry);
  assert.equal(values.discardInvalidReviewResults,discard);
  assert.equal(Number(values.retryInvalidDictionaryChoices)+Number(values.discardInvalidReviewResults),1);
 }
 const ui=readFileSync(new URL('../engine-settings.js',import.meta.url),'utf8');
 assert.match(ui,/changed==='discardInvalidReviewResults'/);
 assert.match(ui,/changed==='retryInvalidDictionaryChoices'/);
 assert.match(ui,/checked=!\$\('discardInvalidReviewResults'\)\.checked/);
 assert.match(ui,/checked=!\$\('retryInvalidDictionaryChoices'\)\.checked/);
});

test('strict mode accepts exactly explicit null, case-insensitive "null", verified sense or verified origin',()=>{
 const one=target('t0','경제');
 for(const valid of [null,'null','Null','NULL','nUlL']){
  const normal=validateChoices([one],response('t0',valid),strict);
  const experimental=validateExperimentalChoices([one],response('t0',valid),{...strict,experimentalHanja:true,experimentalLoanword:true});
  for(const result of [normal,experimental]){
   assert.equal(result.accepted.length,1,String(valid));
   assert.equal(result.accepted[0].option.type,'keep');
   assert.equal(result.unresolved.length,0);
  }
 }
 assert.equal(validateChoices([one],response('t0','c0'),strict).accepted[0].option.choice_id,'c0');
 const loan=target('loan','게임',[]);
 const valid=validateExperimentalChoices([loan],response('loan','game'),
  {...strict,experimentalLoanword:true});
 assert.equal(valid.accepted[0].option.replacement,'game');
 assert.equal(valid.unresolved.length,0);
});

test('strict mode never silently maps any other invalid result to null with either retry setting',()=>{
 const one=target('t0','경제');
 for(const value of ['p4672','p0','c99','n5','x1','c0 ',
   'NULL ','','안전하지않은어원',0,1,false,true,undefined]){
  const answer=value===undefined?{results:[{t:'t0'}]}:response('t0',value);
  for(const ex of [false,true]){
   const result=(ex?validateExperimentalChoices:validateChoices)([one],answer,{
    ...strict,retryInvalidDictionaryChoices:false,experimentalHanja:ex,experimentalLoanword:ex
   });
   assert.equal(result.accepted.length,0,JSON.stringify([value,ex]));
   assert.equal(result.unresolved.length,1,JSON.stringify([value,ex]));
  }
 }
 const noDict=target('empty','미확인',[]);
 const missing=validateExperimentalChoices([noDict],response('empty','p2'),{...strict,experimentalHanja:true});
 assert.equal(missing.accepted.length,0);
 assert.equal(missing.unresolved.length,1);
 const omit=validateChoices([one],{results:[]},strict);
 assert.equal(omit.accepted.length,0);
 assert.equal(omit.unresolved.length,1);
});

test('discard mode alone converts invalid, blank, missing and broken model decisions into null',()=>{
 const targets=[target('t0','경제'),target('t1','산업'),target('t2','사회'),target('t3','재정')];
 for(const ex of [false,true]){
  const result=(ex?validateExperimentalChoices:validateChoices)(
   targets,{results:[{t:'t0',c:'p4672'},{t:'t1',c:'c999'},{t:'t2',c:'x1'}]},
   {...discard,experimentalHanja:ex,experimentalLoanword:ex}
  );
  assert.equal(result.accepted.length,4);
  assert.equal(result.unresolved.length,0);
  assert.ok(result.accepted.every(r=>r.option.type==='keep'));
 }
});

test('p ID maps to a verified current target conversion; identical rendered choices merge',()=>{
 const first=target('t0','경제',[sense('c0','經濟'),sense('c1','景氣')]);
 const second=target('t1','사회',[sense('c0','社會')]);
 const {payload,choiceIndex}=buildReviewPayload('경제 사회',[first,second],strict);
 const alias=payload.targets[0].options[0];
 assert.equal(typeof alias,'string');assert.match(alias,/^p\d+$/);
 const converted=normalizePooledChoiceAnswers({results:[{t:'t0',c:alias}]},choiceIndex);
 assert.equal(converted.results[0].c,'c0');
 const cross=normalizePooledChoiceAnswers({results:[{t:'t1',c:alias}]},choiceIndex);
 assert.equal(cross.results[0].c,alias);
 const ambiguous=target('same','경제',[sense('c0','經濟'),sense('c1','經濟')]);
 const ambiguousBuilt=buildReviewPayload('경제',[ambiguous],strict);
 const packed=ambiguousBuilt.payload;
 assert.deepEqual(packed.targets[0].options,['p0']);
 assert.deepEqual(ambiguousBuilt.choiceIndex.same.p0,['c0']);
 assert.equal(normalizePooledChoiceAnswers({results:[{t:'same',c:packed.targets[0].options[0]}]},ambiguousBuilt.choiceIndex)
  .results[0].c,'c0');
});

test('API strict retry uses the original shared pool and re-asks only unresolvable p ID targets',async()=>{
 const input=[target('t0','경제',[sense('c0','經濟')]),target('t1','사회',[sense('c0','社會')])];
 const calls=[];
 const final=await reviewTargets({
  ...strict,enableModelReview:true,model:'fake',provider:'custom',context:'경제 사회',
  request:async(cfg,wire)=>{
   const packed=buildReviewPayload(cfg.context||'',wire,cfg).payload;
   calls.push(wire.map(t=>t.target_id));
   if(calls.length===1){
    const valid=packed.targets.find(x=>x.target_id==='t0').options[0];
    return {results:[{t:'t0',c:valid},{t:'t1',c:valid}]};
   }
   return {results:[{t:'t1',c:'p0'}]};
  }
 },input);
 assert.deepEqual(calls,[['t0','t1'],['t1']]);
 assert.equal(final.accepted.length,2);
 assert.equal(final.unresolved.length,0);
 assert.ok(final.accepted.every(x=>x.option.type==='hanja'));
});

test('manual strict retry saves unique pool answer and isolates other invalid results',async()=>{
 const first=target('original0','경제',[sense('c0','經濟')]);
 const second=target('original1','사회',[sense('c0','社會')]);
 const third=target('original2','게임',[]);
 const events=[];
 const session=createManualReviewSession({operationId:'strict-manual',post:e=>events.push(e)});
 const waiting=session.request({...strict,experimentalLoanword:true,context:'경제 사회 게임'},
  [first,second,third]);
 const request=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 const payload=wireJSON(request.text);
 const alias=payload.targets[0].options[0];
 assert.ok(alias);
 const firstSubmit=session.submit({operationId:'strict-manual',requestId:request.requestId,text:JSON.stringify({
  batch_id:request.requestId,results:[
   {t:'t0',c:alias},{t:'t1',c:alias},{t:'t2',c:'not a valid 词源'}
  ]
 })});
 assert.equal(firstSubmit,false);
 const correction=events.filter(e=>e.type==='MANUAL_REVIEW_ERROR').at(-1);
 assert.equal(correction.acceptedCount,1);
 assert.deepEqual(correction.invalidTargetIds,['t1','t2']);
 assert.deepEqual(correction.acceptedRows,[{t:'t0',c:'c0'}]);
 const retryPayload=wireJSON(correction.repairPrompt);
 assert.deepEqual(retryPayload.targets.map(t=>t.target_id),['t1','t2']);
 assert.equal(session.submit({operationId:'strict-manual',requestId:request.requestId,text:JSON.stringify({
  batch_id:request.requestId,results:[{t:'t1',c:payload.targets[1].options[0]},{t:'t2',c:null}]
 })}),true);
 assert.deepEqual((await waiting).results,[
  {t:'original0',c:'c0'},{t:'original1',c:'c0'},{t:'original2',c:null}
 ]);
});

test('streaming parser never previews an illegal answer as implicit null in strict mode',()=>{
 const input=[target('t0','경제'),target('t1','사회')];
 let preview;
 const parse=experimentalChoicePreviewParser(input,{...strict,experimentalLoanword:true},a=>{preview=a});
 parse('{"results":[{"t":"t0","c":"p4672"},{"t":"t1","c":"NULL"}]}');
 assert.deepEqual(preview.map(x=>x.target.target_id),['t1']);
 assert.equal(preview[0].option.type,'keep');
});

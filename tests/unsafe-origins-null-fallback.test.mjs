import test from 'node:test';
import assert from 'node:assert/strict';
import {validateChoices,validateExperimentalChoices} from '../choice-review.js';
import {createManualReviewSession} from '../manual-review.js';
import {experimentalChoicePreviewParser} from '../model-stream.js';

const keep=surface=>({choice_id:'KEEP',type:'keep',replacement:surface,entry_id:null,definitions:[]});
const surface1='한동훈',surface2='이승만';
const targets=[
 {target_id:'person-korean',surface:surface1,context:'한동훈이 말했다.',start:0,end:3,
  options:[keep(surface1),{choice_id:'c0',type:'hanja',replacement:'韓東勳',entry_id:5,definitions:['name']}]},
 {target_id:'protected-person',surface:surface2,context:'이승만은 대통령이었다.',start:0,end:3,
  dictionary_person_name:true,options:[keep(surface2)]}
];

test('unsupported Hangul string and blocked historical personal Hanja leave original Korean',()=>{
 const resp={results:[{t:'person-korean',c:'한동훈'},{t:'protected-person',c:'李承晩'}]};
 const v=validateExperimentalChoices(targets,resp,{experimentalHanja:true});
 assert.equal(v.unresolved.length,0);
 assert.deepEqual(v.accepted.map(x=>x.option.type),['keep','keep']);
 assert.equal(v.experimentalRejected,2);
 assert.equal(v.rejectionCounts.unsupported_choice_id,1);
 assert.equal(v.rejectionCounts.person_name_hanja_blocked,1);
 assert.deepEqual(v.rejectionSamples.map(x=>x.target_id),targets.map(t=>t.target_id));
});

test('fallback applies without experimental modes, but never converts unauthorized Hanja',()=>{
 const v=validateChoices(targets,{results:[
  {t:'person-korean',c:'한동훈'},{t:'protected-person',c:'李承晩'}]});
 assert.equal(v.unresolved.length,0);
 assert.deepEqual(v.accepted.map(x=>x.option.type),['keep','keep']);
});

test('nonempty but unsafe source formats, disabled modes and Hanja alignment all return keep',()=>{
 const base={target_id:'t',surface:'원잠',context:'원잠이 있다.',start:0,end:2,options:[keep('원잠')]};
 for(const [c,config] of [
  ['原潛',{}],
  ['原子潛水艇',{experimentalHanja:true}],
  ['한동훈',{experimentalHanja:true}],
  ['123',{experimentalHanja:true}],
  ['x0',{experimentalHanja:true}],
  ['元箴 ',{experimentalHanja:true}],
  ['https://example.test',{experimentalLoanword:true}],
  ['c20',{experimentalHanja:true}]
 ]){
  const v=validateExperimentalChoices([base],{results:[{t:'t',c}]},config);
  assert.equal(v.unresolved.length,0,c);
  assert.equal(v.accepted[0].option.type,'keep',c);
 }
});

test('experimental literal origins are tried before falling back: Latin KEEP is not null',()=>{
 const t={target_id:'t',surface:'킵',context:'킵',start:0,end:1,options:[keep('킵')]};
 const v=validateExperimentalChoices([t],{results:[{t:'t',c:'KEEP'}]},{experimentalLoanword:true});
 assert.equal(v.accepted[0].option.type,'loanword');
 assert.equal(v.accepted[0].option.replacement,'KEEP');
 assert.equal(v.experimentalAccepted,1);
});

test('duplicate, foreign, missing and malformed rows still never complete review',()=>{
 const t=targets[0];
 for(const v of [
  [{t:'foreign',c:'한동훈'}],
  [{t:t.target_id,c:'한동훈'},{t:t.target_id,c:'漢字'}],
  [{t:t.target_id,c:{value:'漢字'}}],
  [{t:t.target_id,c:'漢字',extra:true}]
 ]){
  assert.equal(validateExperimentalChoices([t],{results:v},{experimentalHanja:true}).accepted.length,0,
   JSON.stringify(v));
 }
 const missing=validateExperimentalChoices(targets,{results:[{t:targets[0].target_id,c:null}]},
  {experimentalHanja:true});
 assert.equal(missing.unresolved.length,1);
 assert.equal(missing.unresolved[0].target_id,targets[1].target_id);
});

test('manual full batch with rejected individual origins completes without a retry',async()=>{
 const events=[],session=createManualReviewSession({operationId:'blocked-person',post:x=>events.push(x)});
 const done=session.request({context:targets.map(t=>t.context).join('\n'),experimentalHanja:true},targets);
 const ask=events.find(x=>x.type==='MANUAL_REVIEW_REQUEST');
 assert.equal(session.submit({operationId:'blocked-person',requestId:ask.requestId,
  text:JSON.stringify({batch_id:ask.requestId,results:[
   {t:'t0',c:'한동훈'},{t:'t1',c:'李承晩'}]})}),true);
 assert.deepEqual((await done).results,[
  {t:'person-korean',c:null},{t:'protected-person',c:null}
 ]);
 assert.equal(events.filter(x=>x.type==='MANUAL_REVIEW_ERROR').length,0);
});

test('streaming preview only shows source-kept words for rejected per-target origins',()=>{
 const events=[],callback=rows=>events.push(rows.map(x=>x.option.type));
 const parser=experimentalChoicePreviewParser(targets,{experimentalHanja:true},callback);
 parser(JSON.stringify({results:[
  {t:'person-korean',c:'한동훈'},{t:'protected-person',c:'李承晩'}]}));
 assert.deepEqual(events.at(-1),['keep','keep']);
});

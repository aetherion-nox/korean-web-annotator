import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parsePartialReviewJson} from '../partial-review-json.js';
import {validateChoices,validateExperimentalChoices,reviewTargets} from '../choice-review.js';
import {createManualReviewSession} from '../manual-review.js';
import {ENGINE_SWITCH_DEFAULTS} from '../engine-defaults.js';

const keep=s=>({choice_id:null,type:'keep',replacement:s,entry_id:null,definitions:[]});
const hanja=(id,repl)=>({choice_id:id,type:'hanja',replacement:repl,entry_id:id,definitions:['test']});
const target=(id,surface,options=[])=>({
 target_id:id,start:0,end:surface.length,surface,context:surface,
 options:[keep(surface),...options]
});

test('new switch defaults on and new Chrome content script can load recovery parser',()=>{
 assert.equal(ENGINE_SWITCH_DEFAULTS.retryInvalidDictionaryChoices,true);
 const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
 assert.ok(['1.1.56.53','1.1.56.54','1.1.56.55','1.1.56.56','1.1.56.57','1.1.56.58','1.1.56.59','1.1.56.60','1.1.56.61','1.1.56.62','1.1.56.63','1.1.56.64','1.2.0','1.2.1','1.2.2','1.2.3','1.2.4','1.2.5','1.2.6','1.2.7','1.2.8','1.2.9','1.2.10','1.2.11','1.2.12'].includes(manifest.version));
 assert.ok(manifest.web_accessible_resources.some(resource=>
  resource.resources.includes('partial-review-json.js')));
});

test('malformed t/c row does not discard independently complete neighboring rows',()=>{
 const raw='{"batch_id":"demo","results":['+
  '{"t":"t0","c":"c0"},'+
  '{"t":"t":"t1","c":null},'+
  '{"t":"t2","c":null}]}';
 const parsed=parsePartialReviewJson(raw);
 assert.equal(parsed.recovered,true);
 assert.equal(parsed.response.batch_id,'demo');
 assert.deepEqual(parsed.response.results,[{t:'t0',c:'c0'},{t:'t2',c:null}]);
});

test('never invent a result from an unterminated or invalid object',()=>{
 const raw='{"results":[{"t":"t0","c":"c0"},{"t":"t1","c":"c';
 const parsed=parsePartialReviewJson(raw);
 assert.equal(parsed.recovered,true);
 assert.deepEqual(parsed.response.results,[{t:'t0',c:'c0'}]);
 assert.throws(()=>parsePartialReviewJson('{"results":[{"t":"t1","c":"c'),SyntaxError);
});

test('invalid numbered dictionary key is unresolved without rejecting valid unrelated answers',()=>{
 const targets=[target('t0','가',[hanja('c0','可')]),
  target('t1','나',[hanja('c4','羅')]),
  target('t2','다',[hanja('c5','多')])];
 const reviewed=validateChoices(targets,{results:[
  {t:'t0',c:'c0'},{t:'t1',c:'c99'},{t:'t2',c:null},
  {t:'unknown',c:'c0'}]}, {retryInvalidDictionaryChoices:true,reviewPosFilter:false});
 assert.deepEqual(reviewed.accepted.map(row=>row.target.target_id),['t0','t2']);
 assert.deepEqual(reviewed.unresolved.map(row=>row.target_id),['t1']);
 assert.deepEqual(reviewed.invalidDictionaryChoiceIds,['t1']);
 const old=validateChoices([targets[1]],{results:[{t:'t1',c:'c99'}]},
  {discardInvalidReviewResults:true,retryInvalidDictionaryChoices:false,reviewPosFilter:false});
 assert.equal(old.accepted[0].option.type,'keep');
});

test('experimental free-form origin rejection does not enter dictionary correction',()=>{
 const t=target('t0','사람',[]);
 const result=validateExperimentalChoices([t],{results:[{t:'t0',c:'Some Bad Etymology'}]},
  {retryInvalidDictionaryChoices:true,experimentalHanja:true,reviewPosFilter:false});
 assert.deepEqual(result.invalidDictionaryChoiceIds,['t0']);
 assert.equal(result.accepted.length,0);
 assert.deepEqual(result.unresolved.map(t=>t.target_id),['t0']);
});

test('API accepts valid answers, then only re-asks incorrect dictionary target',async()=>{
 const targets=[target('t0','가',[hanja('c0','可')]),
  {...target('t1','나',[hanja('c1','羅')]),experimental_hanja_audit:true},
  target('t2','다',[hanja('c2','多')])];
 const requests=[],updates=[];
 const result=await reviewTargets({
  enableModelReview:true,retryInvalidDictionaryChoices:true,reviewPosFilter:false,
  experimentalHanja:true,experimentalLoanword:true,smartSegmentation:true,
  model:'fake',provider:'custom',context:'가나다',
  request:async(config,wire)=>{
   requests.push(wire.map(t=>t.target_id));
   if(requests.length===2){
    assert.equal(config.dictionaryCorrectionOnly,true);
    assert.equal(config.experimentalHanja,true);
    assert.equal(config.experimentalLoanword,true);
    assert.equal(config.smartSegmentation,false);
    assert.equal(wire[0].experimental_hanja_audit,true);
   }
   return requests.length===1?
    {results:[{t:'t0',c:'p0'},{t:'t1',c:'c99'},{t:'t2',c:'p2'}]}:
    {results:[{t:'t1',c:'p0'}]};
  },
  onAccepted:rows=>updates.push(rows.map(r=>r.target.target_id))
 },targets);
 assert.deepEqual(requests,[['t0','t1','t2'],['t1']]);
 assert.deepEqual(updates,[['t0','t2'],['t1']]);
 assert.equal(result.accepted.length,3);
 assert.equal(result.unresolved.length,0);
});

test('manual mode retains validated rows, emits only invalid dictionary target in correction prompt',async()=>{
 const events=[];
 const session=createManualReviewSession({operationId:'operation',post:e=>events.push(e)});
 const t0=target('original0','가',[hanja('c0','可')]);
 const t1=target('original1','나',[hanja('c1','羅')]);
 const prompt='Instructions\\n'+JSON.stringify({
  format:'shared-pools-v5',batch_id:'my-batch',
  sentences:[{sentence_id:'s0',text:'가나'}],
  candidates:[{candidate_id:'p0',type:'hanja',replacement:'可'},
              {candidate_id:'p1',type:'hanja',replacement:'羅'}],
  targets:[{target_id:'t0',sentence_id:'s0',options:['p0']},
           {target_id:'t1',sentence_id:'s0',options:['p1']}]
 });
 const pending=session.request({
  manualPrepared:{requestId:'my-batch',text:prompt,bindings:[],targetCount:2},
  reviewPosFilter:false,retryInvalidDictionaryChoices:true
 },[t0,t1]);
 assert.equal(session.submit({operationId:'operation',requestId:'my-batch',text:JSON.stringify({
  batch_id:'my-batch',results:[{t:'t0',c:'p0'},{t:'t1',c:'c99'}]
 })}),false);
 const partial=events.find(e=>e.type==='MANUAL_REVIEW_ERROR'&&e.acceptedRows);
 assert.ok(partial);
 assert.deepEqual(partial.acceptedRows,[{t:'t0',c:'c0'}]);
 assert.deepEqual(partial.invalidTargetIds,['t1']);
 const correction=JSON.parse(partial.repairPrompt.slice(partial.repairPrompt.indexOf('{"format":"shared-pools-v5"')));
 assert.deepEqual(correction.targets.map(row=>row.target_id),['t1']);
 assert.deepEqual(correction.candidates.map(row=>row.candidate_id),['p1']);
 assert.match(partial.repairPrompt,/DICTIONARY-ONLY CORRECTION/);
 assert.equal(correction.origin_mode,undefined);
 assert.equal(correction.allowed_origin_types,undefined);
 assert.equal(correction.targets[0].experimental_hanja_audit,undefined);
 assert.equal(session.submit({operationId:'operation',requestId:'my-batch',text:JSON.stringify({
  batch_id:'my-batch',results:[{t:'t1',c:'p1'}]
 })}),true);
 assert.deepEqual((await pending).results,[{t:'original0',c:'c0'},{t:'original1',c:'c1'}]);
});

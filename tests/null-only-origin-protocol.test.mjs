import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAnalysis,projectAnnotation} from '../local-engine.js';
import {validateChoices,validateExperimentalChoices} from '../choice-review.js';
import {experimentalChoicePreviewParser} from '../model-stream.js';
import {createManualReviewSession} from '../manual-review.js';
import {validateSegmentationRepairs} from '../segmentation-repairs.js';
import {buildReviewPayload} from '../review-payload.js';

const text='킵'; // Hangul transliteration used for the literal Latin spelling KEEP.
const keep={choice_id:null,type:'keep',replacement:text,entry_id:null,definitions:[]};
const target={target_id:'t0',start:0,end:text.length,surface:text,context:text,
 experimental_loanword_audit:true,options:[keep]};
const outcome=c=>({results:[{t:'t0',c}]});

test('the internal keep option is identified by null, never by the Latin spelling KEEP',()=>{
 const base={engine_version:'new',dictionary_fingerprint:'dict',annotations:[],targets:[target],stats:{}};
 const accepted=validateAnalysis(text,base);
 assert.deepEqual(accepted.targets[0].options.map(o=>o.choice_id),[null]);
 assert.throws(()=>validateAnalysis(text,{...base,targets:[{...target,
  options:[{...keep,choice_id:'KEEP'}]}]}),/Invalid engine option/);
 const noConversion=validateChoices([target],outcome(null));
 assert.equal(noConversion.accepted[0].option.type,'keep');
 assert.equal(noConversion.accepted[0].option.choice_id,null);
 const literal=validateExperimentalChoices([target],outcome('KEEP'),
  {experimentalLoanword:true,reviewPosFilter:false,retryInvalidDictionaryChoices:false});
 assert.equal(literal.accepted.length,1);
 assert.equal(literal.accepted[0].option.choice_id,'KEEP');
 assert.equal(literal.accepted[0].option.type,'loanword');
 assert.equal(literal.accepted[0].option.replacement,'KEEP');
 assert.equal(literal.experimentalAccepted,1);
 assert.deepEqual(projectAnnotation(text,{...target,...literal.accepted[0].option})
  .map(a=>a.replacement),['KEEP']);
});

test('dictionary payload exposes only real c/n choices; never exposes a null/KEEP pool entry',()=>{
 const {payload}=buildReviewPayload(text,[target],{experimentalLoanword:true});
 assert.deepEqual(payload.targets[0].options,{});
 assert.equal(payload.candidates.length,0);
});

test('streamed model literal KEEP is a visible loanword preview, not a KEEP/null veto',()=>{
 const snapshots=[];
 const parse=experimentalChoicePreviewParser([target],
  {experimentalLoanword:true,reviewPosFilter:false},
  accepted=>snapshots.push(accepted.map(a=>[a.option.type,a.option.choice_id])));
 parse('{"results":[{"t":"t0","c":"KEEP"}]}');
 assert.deepEqual(snapshots.at(-1),[['loanword','KEEP']]);
});

test('manual JSON review round-trips raw Latin KEEP without rewriting it to null',async()=>{
 const events=[];
 const session=createManualReviewSession({operationId:'literal-keep',post:e=>events.push(e)});
 const awaiting=session.request({experimentalLoanword:true,reviewPosFilter:false,
  retryInvalidDictionaryChoices:false},[target]);
 const request=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 assert.ok(request);
 const response={batch_id:request.requestId,results:[{t:'t0',c:'KEEP'}]};
 assert.equal(session.submit({operationId:'literal-keep',requestId:request.requestId,
  text:JSON.stringify(response)}),true);
 const resolved=await awaiting;
 assert.deepEqual(resolved.results,[{t:'t0',c:'KEEP'}]);
});

test('segmentation repairs: delete uses op and null; literal KEEP may become a real loanword',()=>{
 const original={...target,original_target_id:'t0',repair_sentence_key:'s0',
  repair_context:{kiwi_tokens:[],protected_ranges:[]}};
 const payload=buildReviewPayload(text,[original],{smartSegmentation:true}).payload;
 const sid=payload.sentences[0].sentence_id;
 const config={smartSegmentation:true,context:text,repairModes:{hanja:true,loanword:true},
  hanjaReadingCheck:false,
  repairScopes:new Map([['t0',{text,allTargets:[original],localAnnotations:[],
    selected:null,protected_ranges:[],existingRepairs:[]}]])};
 const base={sentence_id:sid,old_target_ids:['t0'],start:0,end:text.length,surface:text};
 const check=row=>validateSegmentationRepairs([original],{results:[],repairs:[row]},config);
 const deleted=check({...base,op:'delete'});
 assert.equal(deleted.accepted.length,1,JSON.stringify(deleted.rejected));
 assert.equal(deleted.accepted[0].choice_id,null);
 assert.equal(deleted.accepted[0].annotations.length,0);
 const badDelete=check({...base,op:'delete',choice_id:'KEEP'});
 assert.equal(badDelete.accepted.length,0);
 const converted=check({...base,op:'replace',choice_id:'KEEP'});
 assert.equal(converted.accepted.length,1,JSON.stringify(converted.rejected));
 assert.deepEqual(converted.accepted[0].annotations.map(a=>a.replacement),['KEEP']);
 const kept=check({...base,op:'replace',choice_id:null});
 assert.equal(kept.accepted.length,1,JSON.stringify(kept.rejected));
 assert.equal(kept.accepted[0].annotations.length,0);
});

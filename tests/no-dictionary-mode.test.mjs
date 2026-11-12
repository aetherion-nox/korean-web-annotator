import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeWithoutDictionary,NO_DICTIONARY_IDENTITY} from '../no-dictionary-analysis.js';
import {validateAnalysis} from '../local-engine.js';
import {literalOriginOption} from '../experimental-options.js';
import {buildManualPrompt,buildReviewPayload,buildReviewInstructions} from '../review-payload.js';
import {runSentencePipeline} from '../annotation-pipeline.js';

const token=(str,tag,position)=>({str,tag,position,length:str.length});
const mode={hanja:true,loanword:false,allowNoDictionary:true};

test('Kiwi-only analysis works with KEEP targets, no automatic conversions or dictionary metadata',()=>{
 const text='경제학을 공부한다';
 const tokens=[token('경제','NNG',0),token('학','XSN',2),token('을','JKO',3),
  token('공부','NNG',5),token('한다','EF',7)];
 const result=analyzeWithoutDictionary(text,tokens,mode);
 assert.equal(result.dictionary_free,true);
 assert.equal(result.dictionary_fingerprint,NO_DICTIONARY_IDENTITY.dictionary_fingerprint);
 assert.deepEqual(result.annotations,[]);
 assert.deepEqual(result.targets.map(t=>t.surface),['경제학','공부']);
 assert.equal(result.targets[0].options[0].choice_id,'KEEP');
 assert.deepEqual(validateAnalysis(text,result).targets.map(t=>t.surface),['경제학','공부']);
 const withDict={...result,dictionary_free:false};
 assert.deepEqual(validateAnalysis(text,withDict).targets,[]);
});

test('no-dictionary analysis requires explicit authorization and an annotation type',()=>{
 const text='경제';
 for(const options of [{hanja:true},{hanja:true,allowNoDictionary:false},{allowNoDictionary:true}]){
  assert.throws(()=>analyzeWithoutDictionary(text,[token('경제','NNG',0)],options),/无词典模式/);
 }
});

test('proper nouns stay protected, even if alternative Kiwi lexical tokens overlap',()=>{
 const text='이용철 경제';
 const tokens=[token('이용철','NNP',0),token('이용','NNG',0),
   token('철','NNG',2),token('경제','NNG',4)];
 const result=analyzeWithoutDictionary(text,tokens,mode);
 assert.deepEqual(result.targets.map(t=>t.surface),['경제']);
 assert.ok(result.repair_context.protected_ranges.some(t=>t.start===0&&t.end===3));
});

test('source spans remain UTF-16 offsets after emoji, and suffixes remain joined',()=>{
 const text='😀 사실상 경제';
 const tokens=[token('사실','NNG',3),token('상','XSN',5),token('경제','NNG',7)];
 const result=validateAnalysis(text,analyzeWithoutDictionary(text,tokens,mode));
 assert.deepEqual(result.targets.map(t=>[t.surface,t.start,t.end]),[['사실상',3,6],['경제',7,9]]);
});

test('without a dictionary, raw Hanja origins still go through existing reading/alignment checks',()=>{
 const text='가';
 const result=validateAnalysis(text,analyzeWithoutDictionary(text,[token('가','NNG',0)],mode));
 const target=result.targets[0];
 const good=literalOriginOption(target,'可',{experimentalHanja:true});
 const bad=literalOriginOption(target,'韓',{experimentalHanja:true});
 assert.equal(good?.replacement,'可');
 assert.equal(bad,null);
 assert.equal(literalOriginOption(target,'game',{experimentalHanja:true,experimentalLoanword:false}),null);
});

test('model instruction and manual prompts identify no dictionary and still use shared-pools v3',()=>{
 const text='경제';
 const targets=analyzeWithoutDictionary(text,[token('경제','NNG',0)],mode).targets;
 const cfg={dictionaryFree:true,experimentalHanja:true};
 assert.match(buildReviewInstructions(cfg),/No external dictionary/);
 assert.doesNotMatch(buildReviewInstructions(cfg),/check the supplied dictionary definitions/);
 const prompt=buildManualPrompt(text,targets,'b123',cfg);
 assert.match(prompt,/no dictionary senses/i);
 const payload=buildReviewPayload(text,targets,cfg).payload;
 assert.equal(payload.format,'shared-pools-v3');
 assert.deepEqual(payload.candidates,[]);
 assert.deepEqual(payload.targets[0].options,{KEEP:null});
});

test('dictionary-free sentence pipeline issues review requests and retains model KEEP results',async()=>{
 const text='경제',analysis=analyzeWithoutDictionary(text,[token('경제','NNG',0)],mode);
 const events=[],seen=[];
 const request=async(config,targets)=>{
  seen.push({dictionaryFree:config.dictionaryFree,targets});
  return {results:targets.map(t=>({target_id:t.target_id,choice_id:'KEEP'}))};
 };
 const options={operationId:'no-dictionary-test',sentences:[{id:'s',text}],
  modes:{hanja:true},progressiveAnnotation:true};
 await runSentencePipeline(options,e=>events.push(e),{
  enabled:true,status:async()=>NO_DICTIONARY_IDENTITY,
  analyze:async()=>analysis,
  modelConfig:async()=>({provider:'manual',model:'test',enableModelReview:true,
   experimentalHanja:true,request,batchContextTier:'32k'})
 });
 assert.ok(seen.length);
 assert.ok(seen.every(x=>x.dictionaryFree===true));
 assert.ok(events.some(e=>e.type==='DONE'));
 assert.ok(events.some(e=>e.type==='DIAGNOSTIC'&&e.diagnostic?.message?.includes('未导入外部词典')));
});

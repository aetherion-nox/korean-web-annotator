import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewPayload,buildManualPrompt} from '../review-payload.js';
import {modelTargets,validateChoices} from '../choice-review.js';
const option=(id,pos,type='hanja')=>({choice_id:id,type,replacement:type==='nonconversion'?'가':'可',entry_id:id,part_of_speech:pos,definitions:['definition']});
const target=(tag,options)=>({target_id:'t0',surface:'가',start:0,end:1,context:'가',morphology:[{form:'가',tag,start:0,end:1}],options:[{choice_id:'KEEP',type:'keep',replacement:'가',entry_id:null,definitions:[]},...options]});
const packed=t=>buildReviewPayload('가',[t]).payload;
const ids=t=>Object.keys(packed(t).targets[0].options);
test('reliable POS families exclude incompatible review senses without changing source choices',()=>{
 for(const [tag,pos] of [['NNG','명사'],['NNP','고유 명사'],['NNB','불완전 명사'],['NP','대명사'],['NR','수사'],['VV-R','동사'],['VA-I','형용사'],['VX','보조 동사'],['MM','관형사'],['MAG','부사'],['MAJ','부사'],['IC','감탄사'],['JKB','조사'],['EF','어미'],['XPN','접두사'],['XSN','접미사'],['XSV','동사 파생 접미사'],['XSA','형용사 파생 접미사'],['XR','어근']]){
  const t=target(tag,[option('c0',pos),option('c1',tag==='IC'?'명사':'감탄사')]);
  const before=JSON.stringify(t);assert.deepEqual(ids(t),['KEEP','c0'],tag);assert.equal(JSON.stringify(t),before);
 }
});
test('Chinese, multiple and unknown POS labels are conservative',()=>{
 const t=target('NNB',[option('c0','依存名詞'),option('c1','不完全名词'),option('c2','名詞'),option('c3','動詞'),option('n0','명사 / 부사','nonconversion'),option('n1',null,'nonconversion'),option('n2','명사 · 新品詞','nonconversion')]);
 assert.deepEqual(ids(t),['KEEP','c0','c1','n1','n2']);
 assert.deepEqual(ids(target('VA',[option('c0','명사 / 형용사'),option('c1','명사 / 未知詞性'),option('c2','명사 / 부사')])),['KEEP','c0','c1']);
 for(const tag of ['UNKNOWN','USER0','VCP','VCN'])assert.deepEqual(ids(target(tag,[option('c0','명사'),option('c1','동사')])),['KEEP','c0','c1']);
});
test('all conflicts restore original options and signal POS conflict',()=>{
 const t=target('MAG',[option('c0','명사'),option('n0','동사','nonconversion')]);
 const p=packed(t);assert.deepEqual(Object.keys(p.targets[0].options),['KEEP','c0','n0']);assert.equal(p.targets[0].pos_conflict,true);
 assert.match(buildManualPrompt('가',[t],'batch'),/pos_conflict/);
});
test('whole derived and inflected spans are checked as a whole, incomplete spans stay unknown',()=>{
 const t={...target('NNG',[]),surface:'사실상',context:'사실상',end:3,morphology:[{form:'사실',tag:'NNG',start:0,end:2},{form:'상',tag:'XSN',start:2,end:3}],options:[{choice_id:'KEEP',type:'keep'},option('c0','부사'),option('c1','관형사'),option('c2','명사'),option('c3','동사')]};
 assert.deepEqual(ids(t),['KEEP','c0','c1','c2']);
 const v={...t,morphology:[{form:'명확',tag:'XR',start:0,end:2},{form:'하',tag:'XSA',start:2,end:3}],options:[{choice_id:'KEEP',type:'keep'},option('c0','형용사'),option('c1','명사')]};
 assert.deepEqual(ids(v),['KEEP','c0']);
 const part={...target('MAG',[option('c0','부사'),option('c1','명사')]),morphology:[{form:'다른단어',tag:'MAG',start:0,end:4}]};
 assert.deepEqual(ids(part),['KEEP','c0','c1']);
});
test('manual and API export use identical allowed keys and validation rejects removed choices',()=>{
 const t=target('MAG',[option('c0','부사'),option('c1','명사'),option('n0','부사','nonconversion')]);
 const wire=modelTargets([t]);assert.deepEqual(wire[0].options.map(o=>o.choice_id),['KEEP','c0','n0']);
 const manual=JSON.parse(buildManualPrompt('가',[t],'batch').split('\n').at(-1));
 assert.deepEqual(manual.targets[0].options,packed(t).targets[0].options);
 assert.equal(validateChoices([t],{results:[{target_id:'t0',choice_id:'c1'}]}).accepted.length,0);
 assert.equal(validateChoices([t],{results:[{target_id:'t0',choice_id:'KEEP'}]}).accepted.length,1);
 assert.equal(validateChoices([t],{results:[{target_id:'t0',choice_id:'n0'}]}).accepted.length,1);
 assert.equal(modelTargets([target('MAG',[option('c0','명사')])])[0].pos_conflict,true);
});
test('merged choices use their own dictionary headword span, never the last token of a different word',()=>{
 const t={...target('NNG',[]),surface:'사실상',context:'사실상',end:3,morphology:[{form:'사실',tag:'NNG',start:0,end:2},{form:'상',tag:'XSN',start:2,end:3}],options:[{choice_id:'KEEP',type:'keep'}, {...option('c0','부사'),written_form:'사실상'},{...option('c1','접사'),written_form:'-상'},{...option('c2','동사'),written_form:'다른단어'}]};
 assert.deepEqual(ids(t),['KEEP','c0','c1','c2']);
});
test('switch off preserves API, manual and validation candidates without conflict hints',()=>{
 const config={reviewPosFilter:false};
 const t=target('MAG',[option('c0','부사'),option('c1','명사')]);
 const p=buildReviewPayload('가',[t],config).payload;
 assert.deepEqual(Object.keys(p.targets[0].options),['KEEP','c0','c1']);assert.equal(p.targets[0].pos_conflict,undefined);
 assert.deepEqual(modelTargets([t],config)[0].options.map(o=>o.choice_id),['KEEP','c0','c1']);
 assert.equal(validateChoices([t],{results:[{target_id:'t0',choice_id:'c1'}]},config).accepted.length,1);
 const manual=JSON.parse(buildManualPrompt('가',[t],'batch',config).split('\n').at(-1));
 assert.deepEqual(Object.keys(manual.targets[0].options),['KEEP','c0','c1']);
});
test('pipeline separates on/off model caches and applies request configuration',async()=>{
 const {runSentencePipeline}=await import('../annotation-pipeline.js');const cache=new Map(),sent=[];
 const t=target('MAG',[option('c0','부사'),option('c1','명사')]);
 const identity={engine_version:'review-pos-fixture',dictionary_fingerprint:'fixture'};
 for(const reviewPosFilter of [true,false,true]){
  const events=[];
  await runSentencePipeline({operationId:'op',sentences:[{id:'s',text:'가'}],modes:{hanja:true}},e=>events.push(e),{
   cache,enabled:true,status:async()=>identity,analyze:async()=>({...identity,annotations:[],targets:[t],stats:{}}),
   modelConfig:async()=>({endpoint:'https://fixture.test',model:'fixture',reviewPosFilter,request:async(config,targets)=>{
    sent.push(targets[0].options.map(o=>o.choice_id));return {results:[{target_id:targets[0].target_id,choice_id:reviewPosFilter?'c0':'c1'}]};
   }})
  });
  assert.ok(events.some(e=>e.type==='RESULTS'&&e.source==='model'&&e.results[0].annotations.length===1));
 }
 assert.deepEqual(sent,[['KEEP','c0'],['KEEP','c0','c1']]);
});
test('manual review session honors the captured switch for prompt and answer validation',async()=>{
 const {createManualReviewSession}=await import('../manual-review.js');
 for(const reviewPosFilter of [true,false]){
  const events=[],session=createManualReviewSession({operationId:'op',post:e=>events.push(e)});
  const t=target('MAG',[option('c0','부사'),option('c1','명사')]);
  const pending=session.request({context:'가',reviewPosFilter},[t]);
  const request=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
  const prompt=JSON.parse(request.text.split('\n').at(-1));
  assert.deepEqual(Object.keys(prompt.targets[0].options),reviewPosFilter?['KEEP','c0']:['KEEP','c0','c1']);
  assert.equal(session.submit({operationId:'op',requestId:request.requestId,text:JSON.stringify({batch_id:request.requestId,results:[{target_id:'t0',choice_id:reviewPosFilter?'c0':'c1'}]})}),true);
  assert.equal((await pending).results[0].choice_id,reviewPosFilter?'c0':'c1');
 }
});

test('NNB keeps only explicit dependent POS and unknown senses across API and manual review',()=>{
 const context='수능 2주앞… ‘AI 스마트안경’ 부정행위 차단 비상';const start=context.indexOf('주');
 const t={...target('NNB',[]),surface:'주',context,start,end:start+1,morphology:[{form:'주',tag:'NNB',start,end:start+1}],options:[{choice_id:'KEEP',type:'keep',replacement:'주'},option('c0','의존 명사'),option('c1','依存名詞'),option('c2','불완전 명사'),option('c3','명사'),option('c4','名詞'),option('c5','普通名词'),option('c6','명사 / 의존 명사'),{...option('c7','명사'),written_form:'주01'},option('n0',null,'nonconversion'),option('n1','명사','nonconversion'),option('n2','未知詞性','nonconversion')]};
 const expected=['KEEP','c0','c1','c2','c6','n0','n2'];
 assert.deepEqual(Object.keys(buildReviewPayload(context,[t]).payload.targets[0].options),expected);
 assert.deepEqual(modelTargets([t])[0].options.map(o=>o.choice_id),expected);
 const manual=JSON.parse(buildManualPrompt(context,[t],'batch').split('\n').at(-1));
 assert.deepEqual(Object.keys(manual.targets[0].options),expected);assert.equal(manual.sentences[0].text,context);
 assert.equal(validateChoices([t],{results:[{target_id:'t0',choice_id:'c3'}]}).accepted.length,0);
 assert.deepEqual(modelTargets([t],{reviewPosFilter:false})[0].options.map(o=>o.choice_id),t.options.map(o=>o.choice_id));
 assert.equal(validateChoices([t],{results:[{target_id:'t0',choice_id:'c3'}]},{reviewPosFilter:false}).accepted.length,1);
 const conflicted=packed(target('NNB',[option('c0','명사'),option('n0','名詞','nonconversion')]));
 assert.equal(conflicted.targets[0].pos_conflict,true);assert.deepEqual(Object.keys(conflicted.targets[0].options),['KEEP','c0','n0']);
 // Ordinary noun occurrences still keep the broader noun category.
 assert.deepEqual(ids(target('NNG',[option('c0','명사'),option('c1','부사')])),['KEEP','c0']);
});

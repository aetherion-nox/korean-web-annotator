import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewPayload,buildReviewInstructions} from '../review-payload.js';
import {validateChoices,validateExperimentalChoices} from '../choice-review.js';
import {createManualReviewSession} from '../manual-review.js';
import {choicePreviewParser,experimentalChoicePreviewParser} from '../model-stream.js';

const target={
 target_id:'word',context:'밤에 돌아왔다.',surface:'밤',start:0,end:1,
 options:[
  {choice_id:'KEEP',type:'keep',replacement:'밤',entry_id:null,definitions:[]},
  {choice_id:'n0',type:'nonconversion',replacement:'밤',entry_id:1,definitions:['night']},
  {choice_id:'n1',type:'nonconversion',replacement:'밤',entry_id:2,definitions:['chestnut']},
  {choice_id:'c0',type:'loanword',replacement:'balm',entry_id:3,definitions:['skin care product']}
 ]};
const response=(id,c)=>({results:[{t:id,c}]});
const choose=(source,c,config={})=>validateChoices([source],response(source.target_id,c),config);
const experimental=(source,c,config)=>validateExperimentalChoices([source],response(source.target_id,c),config);

test('v1.1.56.22 n/c option pools and native sense definitions are unchanged',()=>{
 const {payload}=buildReviewPayload(target.context,[target],{reviewPosFilter:false});
 assert.deepEqual(Object.keys(payload.targets[0].options),['n0','n1','c0']);
 assert.equal(payload.candidates.length,3);
 assert.match(buildReviewInstructions(),/Nonconversion dictionary senses use their n key/);
 assert.match(buildReviewInstructions(),/Any invalid or unavailable choice is treated as null/);
});

test('valid n/c keys keep the exact original dictionary sense; unknown numeric keys mean null',()=>{
 for(const [id,kind] of [['n0','nonconversion'],['n1','nonconversion'],['c0','loanword']]){
  const v=choose(target,id);
  assert.equal(v.accepted[0].option.type,kind);
  assert.equal(v.accepted[0].option.choice_id,id);
 }
 for(const id of ['c1','c99','c000','n2','n999','n0']){
  const source=id==='n0'?{...target,options:target.options.filter(o=>o.choice_id!=='n0')}:target;
  const v=choose(source,id,{reviewPosFilter:false});
  assert.equal(v.accepted.length,1,id);
  assert.equal(v.accepted[0].option.type,'keep',id);
  assert.equal(v.unresolved.length,0,id);
 }
 for(const raw of ['cNo','x0','c0 ']){
  assert.equal(choose(target,raw).accepted[0].option.type,'keep',raw);
  assert.equal(choose(target,raw).unresolved.length,0,raw);
 }
});

test('nonexistent n/c options also mean null with experimental origins enabled',()=>{
 for(const raw of ['n9','c9']){
  const r=experimental(target,raw,{experimentalHanja:true,experimentalLoanword:true,reviewPosFilter:false});
  assert.equal(r.accepted[0].option.type,'keep');
  assert.equal(r.experimentalAccepted,0);
  assert.equal(r.experimentalRejected,0);
 }
 assert.equal(experimental(target,'n0',{experimentalLoanword:true,reviewPosFilter:false}).accepted[0].option.type,'nonconversion');
 const hanja={target_id:'t1',context:'원잠',surface:'원잠',start:0,end:2,options:[
  {choice_id:'KEEP',type:'keep',replacement:'원잠',entry_id:null,definitions:[]}]};
 const valid=experimental(hanja,'原潛',{experimentalHanja:true});
 assert.equal(valid.accepted[0].option.replacement,'原潛');
 assert.equal(valid.accepted[0].option.origin_source,'model-unverified');
 assert.equal(valid.experimentalAccepted,1);
 assert.equal(experimental(hanja,'原子潛水艇',{experimentalHanja:true}).accepted[0].option.type,'keep',
  'unsafe experimental alignment is rejected as a conversion and leaves source unchanged');
 const loan={target_id:'t2',context:'게임',surface:'게임',start:0,end:2,options:[
  {choice_id:'KEEP',type:'keep',replacement:'게임',entry_id:null,definitions:[]}]};
 assert.equal(experimental(loan,'game',{experimentalLoanword:true}).accepted[0].option.replacement,'game');
 assert.equal(experimental(loan,'wrong spelling with <',{experimentalLoanword:true}).accepted[0].option.type,'keep');
});

test('manual review automatically saves invalid numeric c/n answers as JSON null',async()=>{
 const events=[],session=createManualReviewSession({operationId:'manual-numeric',post:e=>events.push(e)});
 const second={...target,target_id:'word2',surface:'호',context:'호',start:0,end:1,
  options:[{choice_id:'KEEP',type:'keep',replacement:'호',entry_id:null,definitions:[]},
   {choice_id:'c0',type:'hanja',replacement:'號',entry_id:4,definitions:['number']}]};
 const promise=session.request({context:'밤 호',reviewPosFilter:false},[target,second]);
 const request=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 const raw={batch_id:request.requestId,results:[{t:'t0',c:'n999'},{t:'t1',c:'c999'}]};
 assert.equal(session.submit({operationId:'manual-numeric',requestId:request.requestId,text:JSON.stringify(raw)}),true);
 assert.deepEqual((await promise).results,[{t:'word',c:null},{t:'word2',c:null}]);
 assert.equal(events.some(e=>e.type==='MANUAL_REVIEW_ERROR'),false);
});

test('manual valid nonconversion option still retains its dictionary key',async()=>{
 const events=[],session=createManualReviewSession({operationId:'manual-n',post:e=>events.push(e)});
 const promise=session.request({context:target.context,reviewPosFilter:false},[target]);
 const ask=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 assert.equal(session.submit({operationId:'manual-n',requestId:ask.requestId,
  text:JSON.stringify([{t:'t0',c:'n1'}])}),true);
 assert.deepEqual((await promise).results,[{t:'word',c:'n1'}]);
});

test('stream preview agrees with final validator, including missing numeric keys',()=>{
 const unknown={...target,target_id:'no',options:target.options.filter(o=>o.type==='keep')};
 const events=[],parser=choicePreviewParser([unknown,target],rows=>events.push(rows.map(x=>x.option.choice_id)));
 parser(JSON.stringify({results:[{t:'no',c:'c12'},{t:'word',c:'n1'}]}));
 assert.deepEqual(events.at(-1),['KEEP','n1']);
 const exp=[],experimentalParser=experimentalChoicePreviewParser([unknown],{experimentalLoanword:true},rows=>
  exp.push(rows.map(x=>x.option.choice_id)));
 experimentalParser(JSON.stringify({results:[{t:'no',c:'n43'}]}));
 assert.deepEqual(exp.at(-1),['KEEP']);
});

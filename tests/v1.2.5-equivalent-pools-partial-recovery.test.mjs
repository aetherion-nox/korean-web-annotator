import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildReviewPayload,normalizePooledChoiceAnswers} from '../review-payload.js';
import {validateChoices} from '../choice-review.js';
import {createManualReviewSession} from '../manual-review.js';

const keep=surface=>({choice_id:null,type:'keep',replacement:surface,entry_id:null,definitions:[]});
const gloss='말하는 이가 대등한 관계에 있는 사람이나 아랫사람을 상대하여 자기를 가리키는 일인칭 대명사. 주격 조사 ‘가’나 보격 조사 ‘가’가 붙으면 ‘내’가 된다.';
const origin=(choice_id,replacement,entry_id=490411,extras={})=>({
 choice_id,type:'nonconversion',replacement,entry_id,definitions:[gloss],
 written_form:'나',part_of_speech:'대명사',...extras
});
const word=(target_id,surface,choice_id,replacement,entry_id=490411,extras={})=>({
 target_id,context:surface,surface,start:0,end:surface.length,
 options:[keep(surface),origin(choice_id,replacement,entry_id,extras)]
});
const config={reviewPosFilter:false,retryInvalidDictionaryChoices:true,discardInvalidReviewResults:false};

test('real-world na/nae morphology: visually equivalent no-op pools are accepted without changing target options',()=>{
 const original=word('t354','나','n2','나'),inflected=word('t379','내','n7','내');
 const built=buildReviewPayload('나 내가',[original,inflected],config);
 const [a,b]=built.payload.targets;
 assert.deepEqual(a.options,['p0']);
 assert.deepEqual(b.options,['p0']);
 assert.equal(a.options.includes('p1'),false);
 assert.equal(b.options.includes('p0'),true,'same base lexeme and no-op output share one pool');
 assert.deepEqual(built.choiceIndex.__noOpPoolIds,['p0']);
 const raw={results:[{t:'t379',c:'p0'}]};
 const resolved=normalizePooledChoiceAnswers(raw,built.choiceIndex);
 assert.deepEqual(resolved.results,[{t:'t379',c:'n7'}]);
 assert.deepEqual(raw.results,[{t:'t379',c:'p0'}],'never mutate original output');
 const accepted=validateChoices([inflected],resolved,config);
 assert.equal(accepted.accepted.length,1);
 assert.equal(accepted.accepted[0].option.type,'nonconversion');
 assert.equal(accepted.accepted[0].option.replacement,'내');
});

test('any nonconversion pool means no visible annotation, even when the source meaning differs',()=>{
 const source=word('source','나','n1','나');
 const target=word('target','내','n8','내',12345,
   {definitions:['unrelated sense'],written_form:'내',part_of_speech:'명사'});
 const {choiceIndex}=buildReviewPayload('나 내',[source,target],config);
 assert.ok(choiceIndex.__noOpPoolIds.includes('p0'));
 assert.deepEqual(normalizePooledChoiceAnswers({results:[{t:'target',c:'p0'}]},choiceIndex).results,
  [{t:'target',c:null}],'the output is unchanged, so the dictionary entry identity does not matter');
 assert.equal(normalizePooledChoiceAnswers({results:[{t:'target',c:'p999'}]},choiceIndex).results[0].c,'p999');
 assert.equal(normalizePooledChoiceAnswers({results:[{t:'target',c:'n0'}]},choiceIndex).results[0].c,'invalid_local_key:n0');
});

const hanja=(choice_id,replacement,entry_id=1)=>({
 choice_id,type:'hanja',replacement,entry_id,definitions:['unrelated dictionary definition'],
 written_form:'경제',part_of_speech:'명사'
});
const hanjaTarget=(target_id,surface,choice_id,replacement,entry_id)=>({
 target_id,context:surface,surface,start:0,end:surface.length,
 options:[keep(surface),hanja(choice_id,replacement,entry_id)]
});

test('Hanja candidates with different dictionary entry IDs match when the actual projected annotation is identical',()=>{
 const src=hanjaTarget('source','경제','c0','經濟',1);
 const dest=hanjaTarget('dest','경제','c9','經濟',999);
 const built=buildReviewPayload('',[src,dest],config);
 assert.deepEqual(built.payload.targets.map(t=>t.options),[['p0'],['p0']]);
 assert.deepEqual(built.choiceIndex.dest.p0,['c9']);
 assert.deepEqual(normalizePooledChoiceAnswers({results:[{t:'dest',c:'p0'}]},built.choiceIndex).results,
  [{t:'dest',c:'c9'}]);
 const selected=validateChoices([dest],{results:[{t:'dest',c:'c9'}]},config);
 assert.equal(selected.accepted.length,1);
});

test('safe suffix inflection: exact same Hanja run may be rebased onto an allowed local target option',()=>{
 const src=hanjaTarget('source','경제','c0','經濟',1);
 const dest=hanjaTarget('dest','경제가','c8','經濟가',999);
 const built=buildReviewPayload('',[src,dest],config);
 assert.deepEqual(built.choiceIndex.dest.p0,['c8']);
 assert.deepEqual(normalizePooledChoiceAnswers({results:[{t:'dest',c:'p0'}]},built.choiceIndex).results,
  [{t:'dest',c:'c8'}]);
});

test('different rendered annotations or ambiguous source locations remain invalid',()=>{
 const source=hanjaTarget('source','경제','c0','經濟',1);
 const mismatched=hanjaTarget('wrong','경제','c1','景帝',2);
 const multi=hanjaTarget('multi','경제경제','c2','經濟경제',3);
 const built=buildReviewPayload('',[source,mismatched,multi],config);
 assert.equal(built.choiceIndex.wrong.p0,undefined);
 assert.equal(built.choiceIndex.multi.p0,undefined,'repeated substring is ambiguous, no automatic alias');
 for(const id of ['wrong','multi']){
  assert.equal(normalizePooledChoiceAnswers({results:[{t:id,c:'p0'}]},built.choiceIndex).results[0].c,'p0');
 }
});

test('original target dictionary conversions remain eligible for exact-result recovery after model-facing POS filtering',()=>{
 const original=hanjaTarget('source','경제','c0','經濟',1);
 const dest={...hanjaTarget('dest','경제','c1','經濟',2),
  morphology:[{form:'경제',tag:'VV',start:0,end:2}],
  options:[keep('경제'),hanja('c1','經濟',2),{
   choice_id:'n1',type:'nonconversion',replacement:'경제',entry_id:3,
   definitions:['verb-like native form'],written_form:'경제',part_of_speech:'동사'
  }]};
 const built=buildReviewPayload('',[original,dest],{reviewPosFilter:true});
 assert.deepEqual(built.payload.targets[1].options.length,1,'POS-filtered Hanja must stay filtered');
 assert.deepEqual(built.choiceIndex.dest.p0,['c1'],'hidden noun sense is accessible only as exact-output recovery');
 const missing={...hanjaTarget('missing','경제','c0','經濟',1),options:[keep('경제')]};
 const builtEmpty=buildReviewPayload('',[original,missing],config);
 assert.equal(builtEmpty.choiceIndex.missing.p0,undefined);
});

test('multiple local choices with the SAME visible output are safe to canonicalize',()=>{
 const source=hanjaTarget('source','경제','c0','經濟',1);
 const dest=hanjaTarget('dest','경제','c1','經濟',2);
 dest.options.push(hanja('c2','經濟',3));
 const built=buildReviewPayload('',[source,dest],config);
 assert.deepEqual(built.choiceIndex.dest.p0,['c1']);
});

test('manual reviewer accepts na/nae same-output alias without requiring an unnecessary correction',async()=>{
 const events=[],session=createManualReviewSession({operationId:'equivalent',post:x=>events.push(x)});
 const done=session.request({...config,context:'나 내가'},[
  word('original0','나','n2','나'),word('original1','내','n7','내')
 ]);
 const prompt=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 assert.deepEqual(prompt.choiceIndex.__noOpPoolIds,['p0']);
 const ok=session.submit({operationId:'equivalent',requestId:prompt.requestId,
  text:JSON.stringify({batch_id:prompt.requestId,results:[{t:'t0',c:'p0'},{t:'t1',c:'p0'}]})});
 assert.equal(ok,true);
 assert.deepEqual((await done).results,[{t:'original0',c:'n2'},{t:'original1',c:'n7'}]);
});

function frameFixture(){
 const entry={id:'p0',text:'가 나',selected:[{start:0,end:3}],
  annotations:[],localAnnotations:[],committedModelAnnotations:[]};
 const task={operationId:'top',mergeGroupId:'frame-group-9',mergedGroup:true,
  finished:false,entries:new Map([['p0',entry]]),
  modes:{hanja:true,loanword:false},manualRequest:null,manualBackup:null,
  paragraphPlan:{sentences:[{id:'p0',text:'가 나'}],
   projectBinding:(b,choice)=>[{
    sentenceId:b.sentenceId,start:b.start,end:b.end,
    surface:b.surface,annotations:choice.annotations
   }]},
  paint:()=>entry.annotations.length};
 const elements=new Map(),panel={querySelector:selector=>{
  if(!elements.has(selector))elements.set(selector,{value:'',textContent:'',disabled:false});
  return elements.get(selector);
 }};
 const context={currentTask:task,document:{querySelector:()=>panel},
  clearTimeout(){},clearInterval(){},status(){},console,JSON};
 vm.createContext(context);
 const src=readFileSync(new URL('../content.js',import.meta.url),'utf8');
 vm.runInContext(src.slice(src.indexOf('  function recoverManualConnection'),
  src.indexOf('  function status(')),context);
 const binding=(target_id,start,surface,choice_id,replacement)=>({
  target_id,sentenceId:'p0',start,end:start+surface.length,surface,
  choices:[{choice_id:null,annotations:[]},{choice_id,
   annotations:[{start,end:start+surface.length,surface,replacement,type:'hanja'}]}]
 });
 const backup={requestId:'batch-9',retryInvalidDictionaryChoices:true,
  discardInvalidReviewResults:false,choiceIndex:{t0:{p0:['c0']},t1:{p1:['c1']}},
  bindings:[binding('t0',0,'가','c0','可'),binding('t1',2,'나','c1','羅')]};
 const frame=(results)=>({frameId:0,operationId:'top',backup,originalPrompt:'',
  answer:JSON.stringify({batch_id:'batch-9',results})});
 const call=(phase,rows,partial=true)=>context.applyMergedOfflineFrame({
  groupId:'frame-group-9',phase,frame:frame(rows),partial});
 return {context,task,entry,elements,call};
}

test('two-phase offline recovery commits only validated answers, then accepts corrections with no replay',async()=>{
 const {task,entry,call}=frameFixture();
 const initial=[{t:'t0',c:'p0'},{t:'t1',c:'p999'}];
 const check=await call('validate',initial);
 assert.equal(check.ok,true,check.error);
 assert.equal(check.checked.accepted,1);
 assert.deepEqual(Array.from(check.checked.missingIds),['t1']);
 assert.equal(entry.annotations.length,0,'validate stage never writes DOM');
 const partial=await call('commit',initial);
 assert.equal(partial.ok,true,partial.error);
 assert.equal(partial.checked.partial,true);
 assert.equal(task.manualRecoveryAccepted.size,1);
 assert.deepEqual(Array.from(entry.annotations,a=>a.replacement),['可']);
 assert.equal(task.manualOfflineCommitted?.has('batch-9')||false,false);
 const repair=[{t:'t1',c:'p1'}];
 assert.equal((await call('validate',repair)).ok,true);
 const completed=await call('commit',repair);
 assert.equal(completed.ok,true,completed.error);
 assert.equal(completed.checked.partial,false);
 assert.equal(task.manualRecoveryAccepted.size,2,'prior validated choice is retained');
 assert.equal(task.manualOfflineCommitted.has('batch-9'),true);
 assert.deepEqual(Array.from(entry.annotations,a=>a.replacement),['可','羅']);
 const again=await call('commit',repair);
 assert.equal(again.alreadyApplied,true,'complete batch cannot be applied twice');
 assert.equal(entry.annotations.length,2);
});

test('partial frame application still refuses stale source spans before writing',async()=>{
 const {entry,call}=frameFixture();
 entry.text='다 나';
 const response=await call('validate',[{t:'t0',c:'p0'},{t:'t1',c:'p999'}]);
 assert.equal(response.ok,true,'unaffected targets may still be valid');
 assert.equal(response.checked.partial,true);
 assert.equal(response.checked.accepted,0,'changed target cannot count as verified');
 const commit=await call('commit',[{t:'t0',c:'p0'},{t:'t1',c:'p999'}]);
 assert.equal(commit.ok,true);
 assert.equal(entry.annotations.length,0);
});

test('worker still validates all frames first, commits safe subsets, and reports missing targets',async()=>{
 const src=readFileSync(new URL('../service-worker.js',import.meta.url),'utf8');
 const code=src.slice(src.indexOf('async function recoverMergedManualBatch('),
   src.indexOf('async function handleAnnotateBatch('));
 const received=[];
 const frames=[{frameId:0,operationId:'a'},{frameId:7,operationId:'b'}];
 const chrome={tabs:{async sendMessage(tabId,message,opts){
  received.push([message.phase,message.frame.frameId,message.partial]);
  if(message.phase==='validate')return {ok:true,checked:{accepted:1,partial:true,missingIds:['t1']}};
  return {ok:true,checked:message.frame.frameId===0?
   {accepted:1,partial:false,missingIds:[]}:
   {accepted:0,partial:true,missingIds:['t1'],missingReasons:{t1:'bad p999'}}};
 }}};
 const context={partitionMergedManualRecovery:()=>frames,chrome};
 vm.createContext(context);vm.runInContext(code,context);
 const reply=await context.recoverMergedManualBatch(3,{
  groupId:'frame-group-9',frameRouting:[],backup:{
   requestId:'batch-9',retryInvalidDictionaryChoices:true,discardInvalidReviewResults:false
  },
  response:{results:[]}
 });
 assert.equal(reply.ok,true);
 assert.equal(reply.partial,true);
 assert.equal(reply.acceptedCount,1);
 assert.deepEqual(Array.from(reply.missingTargetIds),['t1']);
 assert.equal(reply.missingReasons.t1,'bad p999');
 assert.deepEqual(received,[
  ['validate',0,true],['validate',7,true],['commit',0,true],['commit',7,true]
 ]);
});

test('worker never commits if a frame has a stale DOM or invalid batch identity',async()=>{
 const src=readFileSync(new URL('../service-worker.js',import.meta.url),'utf8');
 const code=src.slice(src.indexOf('async function recoverMergedManualBatch('),
   src.indexOf('async function handleAnnotateBatch('));
 const calls=[];
 const frames=[{frameId:0},{frameId:8}];
 const context={partitionMergedManualRecovery:()=>frames,chrome:{tabs:{async sendMessage(_,m){
  calls.push(m.phase+':'+m.frame.frameId);
  if(m.frame.frameId===8)return {ok:false,error:'原文位置失效'};
  return {ok:true,checked:{accepted:1}};
 }}}};
 vm.createContext(context);vm.runInContext(code,context);
 await assert.rejects(
  context.recoverMergedManualBatch(3,{groupId:'frame-group-9',backup:{requestId:'batch-9'},response:{}}),
  /子框架 8校验失败.*原文位置失效/
 );
 assert.deepEqual(calls,['validate:0','validate:8']);
});

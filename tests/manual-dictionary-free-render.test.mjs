import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createParagraphPlan} from '../paragraph-plan.js';
import {normalizeManualAnswer} from '../manual-answer-format.js';
const {JSDOM}=createRequire(import.meta.url)('jsdom');

function environment(){
 const dom=new JSDOM('<body><p>경제 컴퓨터 문화</p><div class="kra-manual-review">'+
  '<textarea class="kra-manual-prompt"></textarea><textarea class="kra-manual-response"></textarea>'+
  '<span class="kra-manual-summary"></span><span class="kra-manual-status"></span>'+
  '<button class="kra-manual-apply"></button><button class="kra-manual-import"></button></div></body>');
 const document=dom.window.document,p=document.querySelector('p'),node=p.firstChild,text=node.data;
 const entry={node,id:'0',text,annotations:[],localAnnotations:[],selected:[{start:0,end:text.length}]};
 const entries=new Map([[node,entry]]);
 const plan=createParagraphPlan(entries,element=>({text:element.textContent,
  runs:[{node,start:0,end:node.data.length}]}),'p');
 assert.equal(plan.sentences[0].id,'p0'); // Paragraph IDs differ from DOM entry IDs.
 const binding=(id,start,end)=>({target_id:id,sentenceId:plan.sentences[0].id,
  start,end,surface:text.slice(start,end),choices:[{choice_id:null,annotations:[]}],
  literalOrigin:{eligible:true,hanja:true,loanword:true,known:[]}});
 const backup={requestId:'batch1',batchNumber:1,batchTotal:1,targetCount:3,text:'original',
  bindings:[binding('t0',0,2),binding('t1',3,6),binding('t2',7,9)]};
 const task={operationId:'op',entries,paragraphPlan:plan,manualRequest:'batch1',manualBackup:backup,
  manualOriginalPrompt:'original',manualPlan:[backup],manualLocalOnly:false,
  manualReadingCheck:Promise.resolve(()=>({status:'match'})),
  manualAnswerNormalizer:Promise.resolve(normalizeManualAnswer),
  modes:{hanja:true,loanword:true},finished:false,operation:[],wholePage:false};
 const panel=document.querySelector('.kra-manual-review');
 panel.dataset.operationId='op';panel.dataset.requestId='batch1';
 const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
 const errors=[];
 const context={document,OWN_RUBY:'ruby[kra-annotated="true"]',currentTask:task,
  ownDomChanges:new WeakSet(),seenSources:new Set(),rememberRecovery(){},uiSettings:{},
  getToolbar:()=>panel,manualPanel:()=>panel,refreshManualReopen(){},publishState(){},
  configureRecovery(){},configureAutomaticAnnotation(){},status(){},addDiagnostic(d){errors.push(d);},
  clearTimeout(){},clearInterval(){},setTimeout:()=>1,finishTask(t){t.finished=true;},console};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('  function loanwordDisplay'),source.indexOf('  function contextState')),context);
 vm.runInContext(source.slice(source.indexOf('  function recoverManualConnection'),
   source.indexOf('  function status(',source.indexOf('  function recoverManualConnection'))),context);
 task.paint=()=>{context.insertConversions(entries,task.operation);
  return document.querySelectorAll('p ruby[kra-annotated="true"]').length;};
 return {dom,document,context,task,panel,errors};
}

const valid=[
 {t:'t0',c:'經濟'},
 {t:'t1',c:'computer'}
];
test('partial no-dictionary accepted raw origins actually render as DOM rubies',async()=>{
 const {dom,document,context,task}=environment();
 const pending={batch_id:'batch1',results:[...valid]};
 await assert.rejects(context.applyManualRecovery(task,JSON.stringify(pending)),/已验证 2\/3/);
 assert.equal(task.manualRecoveryAccepted.size,2,'both generated choices must survive page validation');
 const rubies=[...document.querySelectorAll('p ruby[kra-annotated="true"]')];
 assert.equal(rubies.length,2,'accepted results must create visible annotations now, before retry');
 assert.deepEqual(rubies.map(x=>x.getAttribute('data-kra-type')),['hanja','loanword']);
 assert.deepEqual(rubies.map(x=>x.getAttribute('data-kra-source')),['model-unverified','model-unverified']);
 assert.deepEqual(rubies.map(x=>x.firstChild.textContent),['經濟','컴퓨터']);
 assert.deepEqual(rubies.map(x=>x.querySelector('rt').textContent),['경제','computer']);
 assert.match(document.querySelector('.kra-manual-prompt').value,/t2/);
 assert.equal(task.manualRequest,'batch1');
 await context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',results:[{t:'t2',c:'文化'}]}));
 assert.equal(document.querySelectorAll('p ruby[kra-annotated="true"]').length,3);
 assert.equal(task.finished,true);
 dom.window.close();
});
test('online partial acceptance event previews validated literal origins on the page',async()=>{
 const {dom,document,context,task,panel,errors}=environment();
 context.handleManualEvent(task,{type:'MANUAL_REVIEW_ERROR',requestId:'batch1',
  acceptedRows:valid,acceptedCount:2,repairPrompt:'only t2',error:'本批已保留 2/3 条有效答案，剩余 1 条待补交'});
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(task.manualRecoveryAccepted?.size,2);
 assert.equal(document.querySelectorAll('p ruby[kra-annotated="true"]').length,2);
 assert.match(panel.querySelector('.kra-manual-status').textContent,/已在当前网页正式应用 2 个标注/);
 assert.equal(panel.querySelector('.kra-manual-prompt').value,'only t2');
 assert.equal(panel.querySelector('.kra-manual-apply').disabled,false);
 assert.ok(errors.every(e=>e.level!=='warning'),JSON.stringify(errors));
 dom.window.close();
});

test('disconnected page accepts a bare t/c array without losing source validation',async()=>{
 const {dom,document,context,task}=environment();
 const response=[...valid,{t:'t2',c:'文化'}];
 await context.applyManualRecovery(task,JSON.stringify(response));
 assert.equal(document.querySelectorAll('p ruby[kra-annotated="true"]').length,3);
 assert.equal(task.finished,true);
 dom.window.close();
});

test('disconnected page accepts an object with results and no batch ID',async()=>{
 const {dom,document,context,task}=environment();
 await context.applyManualRecovery(task,JSON.stringify({results:[...valid,{t:'t2',c:'文化'}]}));
 assert.equal(document.querySelectorAll('p ruby[kra-annotated="true"]').length,3);
 assert.equal(task.finished,true);
 dom.window.close();
});

test('disconnected page refuses explicit incorrect batch ID and batchless foreign targets',async()=>{
 const {dom,context,task}=environment();
 for(const payload of [
  {batch_id:'wrong',results:[...valid,{t:'t2',c:'文化'}]},
  {results:[...valid,{t:'t99',c:'文化'}]},
  [{t:'t0',c:'經濟'},{t:'t99',c:null}]
 ])await assert.rejects(context.applyManualRecovery(task,JSON.stringify(payload)),/batch_id|缺少 batch_id/);
 assert.equal(task.manualRecoveryAccepted?.size||0,0);
 dom.window.close();
});

test('offline discard mode accepts nonexistent numbered c/n keys as null without applying an origin',async()=>{
 const {dom,document,context,task}=environment();
 task.manualBackup.discardInvalidReviewResults=true;
 await context.applyManualRecovery(task,JSON.stringify({
  batch_id:'batch1',results:[{t:'t0',c:'c99'},{t:'t1',c:'n0'},{t:'t2',c:'c999'}]
 }));
 assert.equal(document.querySelectorAll('p ruby[kra-annotated="true"]').length,0);
 assert.equal(task.manualRecoveryAccepted.size,3);
 assert.equal(task.manualRecoveryAccepted.get('t0').choice.choice_id,null);
 assert.equal(task.manualRecoveryAccepted.get('t1').choice.choice_id,null);
 assert.equal(task.finished,true);
 dom.window.close();
});

test('offline discard mode preserves a real n sense when it is present',async()=>{
 const {dom,document,context,task}=environment();
 task.manualBackup.discardInvalidReviewResults=true;
 task.manualBackup.bindings[0].choices.push({choice_id:'n0',type:'nonconversion',annotations:[]});
 await context.applyManualRecovery(task,JSON.stringify({
  batch_id:'batch1',results:[{t:'t0',c:'n0'},{t:'t1',c:'n99'},{t:'t2',c:'c99'}]
 }));
 assert.equal(task.manualRecoveryAccepted.get('t0').choice.choice_id,'n0');
 assert.equal(task.manualRecoveryAccepted.get('t1').choice.choice_id,null);
 assert.equal(document.querySelectorAll('p ruby[kra-annotated="true"]').length,0);
 assert.equal(task.finished,true);
 dom.window.close();
});

test('offline discard mode treats unsupported Hangul and protected-person Hanja as null',async()=>{
 const {dom,document,context,task}=environment();
 task.manualBackup.discardInvalidReviewResults=true;
 task.manualBackup.bindings[1].literalOrigin={eligible:false,hanja:true,loanword:true,known:[]};
 await context.applyManualRecovery(task,JSON.stringify({
  batch_id:'batch1',
  results:[{t:'t0',c:'한동훈'},{t:'t1',c:'李承晩'},{t:'t2',c:'c404'}]
 }));
 assert.equal(task.finished,true);
 assert.equal(task.manualRecoveryAccepted.size,3);
 assert.deepEqual([...task.manualRecoveryAccepted.values()].map(x=>x.choice.choice_id),[null,null,null]);
 assert.equal(document.querySelectorAll('p ruby[kra-annotated="true"]').length,0);
 dom.window.close();
});

test('disconnected page uses the dictionary option for a proven person Hanja spelling',async()=>{
 const {dom,document,context,task}=environment();
 const b=task.manualBackup.bindings[0];
 b.dictionaryPersonHanja=['經濟'];
 b.literalOrigin={eligible:false,hanja:false,loanword:false};
 b.choices.push({choice_id:'c0',annotations:[{
   start:0,end:2,surface:'경제',replacement:'經濟',type:'hanja'
 }]});
 await context.applyManualRecovery(task,JSON.stringify({
  batch_id:'batch1',results:[{t:'t0',c:'經濟'},{t:'t1',c:null},{t:'t2',c:null}]
 }));
 assert.equal(task.manualRecoveryAccepted.get('t0').choice.choice_id,'c0');
 assert.equal(document.querySelectorAll('p ruby[kra-annotated="true"]').length,1);
 assert.equal(document.querySelector('p ruby').firstChild.textContent,'經濟');
 assert.equal(document.querySelector('p ruby').getAttribute('data-kra-source'),'dictionary');
 assert.equal(task.finished,true);
 dom.window.close();
});

test('disconnected discard mode still keeps an unsupported person Hanja guess',async()=>{
 const {dom,document,context,task}=environment();
 task.manualBackup.discardInvalidReviewResults=true;
 const b=task.manualBackup.bindings[0];
 b.dictionaryPersonHanja=['經濟'];
 b.literalOrigin={eligible:false,hanja:false,loanword:false};
 b.choices.push({choice_id:'c0',annotations:[{
  start:0,end:2,surface:'경제',replacement:'經濟',type:'hanja'
 }]});
 await context.applyManualRecovery(task,JSON.stringify({
  batch_id:'batch1',results:[{t:'t0',c:'經製'},{t:'t1',c:null},{t:'t2',c:null}]
 }));
 assert.equal(task.manualRecoveryAccepted.get('t0').choice.choice_id,null);
 assert.equal(document.querySelectorAll('p ruby[kra-annotated="true"]').length,0);
 assert.equal(task.finished,true);
 dom.window.close();
});

test('discard mode commits valid manual results and never asks again for invalid or omitted targets',async()=>{
 const {dom,document,context,task,panel}=environment();
 task.manualBackup.retryInvalidDictionaryChoices=false;
 task.manualBackup.discardInvalidReviewResults=true;
 await context.applyManualRecovery(task,JSON.stringify({
  batch_id:'batch1',results:[{t:'t0',c:'經濟'},{t:'t1',c:'c999'}]
 }));
 assert.equal(task.finished,true);
 assert.equal(task.manualRecoveryAccepted.size,3);
 assert.equal(document.querySelectorAll('p ruby[kra-annotated="true"]').length,1);
 assert.doesNotMatch(panel.querySelector('.kra-manual-prompt').value,/仅补交|只回答以下/);
 assert.equal(task.manualRecoveryAccepted.get('t2').choice.choice_id,null);
 dom.window.close();
});

test('discard mode treats case-insensitive quoted null as null offline',async()=>{
 const {dom,document,context,task}=environment();
 task.manualBackup.retryInvalidDictionaryChoices=false;
 task.manualBackup.discardInvalidReviewResults=true;
 await context.applyManualRecovery(task,JSON.stringify({
  batch_id:'batch1',results:[{t:'t0',c:'null'},{t:'t1',c:'NULL'},{t:'t2',c:'Null'}]
 }));
 assert.equal(task.finished,true);
 assert.equal(task.manualRecoveryAccepted.size,3);
 assert.equal(document.querySelectorAll('p ruby[kra-annotated="true"]').length,0);
 dom.window.close();
});

test('duplicate target with malformed companion row is null in offline recovery',async()=>{
 const {dom,document,context,task}=environment();
 task.manualBackup.retryInvalidDictionaryChoices=false;
 task.manualBackup.discardInvalidReviewResults=true;
 const binding=task.manualBackup.bindings[0];
 binding.choices.push({choice_id:'c0',type:'hanja',annotations:[{
  start:0,end:2,surface:'경제',replacement:'經濟',type:'hanja'
 }]});
 await context.applyManualRecovery(task,JSON.stringify({
  batch_id:'batch1',results:[
   {t:'t1',c:'computer'},{t:'t0',c:'c0'},
   {t:'t0',c:'c0',extra:true},{t:'t0',c:'c0'},
   {t:'t0',c:null},{t:'t2',c:'NULL'}
  ]
 }));
 assert.equal(task.finished,true);
 assert.equal(task.manualRecoveryAccepted.size,3);
 assert.equal(task.manualRecoveryAccepted.get('t0').choice.choice_id,null);
 assert.equal(task.manualRecoveryAccepted.get('t1').choice.annotations[0].replacement,'computer');
 assert.equal(task.manualRecoveryAccepted.get('t2').choice.choice_id,null);
 assert.equal(document.querySelectorAll('p ruby[kra-annotated="true"]').length,1);
 dom.window.close();
});

test('offline recovery uses one well-formed choice despite malformed duplicate copies',async()=>{
 const {dom,document,context,task}=environment();
 task.manualBackup.retryInvalidDictionaryChoices=false;
 task.manualBackup.discardInvalidReviewResults=true;
 const binding=task.manualBackup.bindings[0];
 binding.choices.push({choice_id:'c0',type:'hanja',annotations:[{
  start:0,end:2,surface:'경제',replacement:'經濟',type:'hanja'
 }]});
 await context.applyManualRecovery(task,JSON.stringify({
  batch_id:'batch1',results:[
   {t:'t1',c:'computer'},
   {t:'t0',c:'c0',extra:true}, // malformed
   {t:'t0',c:17},             // malformed
   {t:'t0',c:'c0'},           // single valid row
   {t:'t0',n2:'c1'},          // malformed
   {t:'t0',c:''},             // malformed blank
   {t:'t2',c:null}
  ]
 }));
 assert.equal(task.finished,true);
 assert.equal(task.manualRecoveryAccepted.size,3);
 assert.equal(task.manualRecoveryAccepted.get('t0').choice.choice_id,'c0');
 assert.equal(task.manualRecoveryAccepted.get('t1').choice.annotations[0].replacement,'computer');
 assert.equal(task.manualRecoveryAccepted.get('t2').choice.choice_id,null);
 assert.equal(document.querySelectorAll('p ruby[kra-annotated="true"]').length,2);
 dom.window.close();
});

test('offline recovery drops two valid duplicate choices even with malformed copies',async()=>{
 const {dom,document,context,task}=environment();
 task.manualBackup.retryInvalidDictionaryChoices=false;
 task.manualBackup.discardInvalidReviewResults=true;
 const binding=task.manualBackup.bindings[0];
 binding.choices.push({choice_id:'c0',type:'hanja',annotations:[{
  start:0,end:2,surface:'경제',replacement:'經濟',type:'hanja'
 }]});
 await context.applyManualRecovery(task,JSON.stringify({
  batch_id:'batch1',results:[
   {t:'t0',c:'c0'},
   {t:'t0',c:'c0',extra:true},
   {t:'t1',c:'computer'},
   {t:'t0',c:null},
   {t:'t2',c:null}
  ]
 }));
 assert.equal(task.finished,true);
 assert.equal(task.manualRecoveryAccepted.size,3);
 assert.equal(task.manualRecoveryAccepted.get('t0').choice.choice_id,null);
 assert.equal(document.querySelectorAll('p ruby[kra-annotated="true"]').length,1);
 dom.window.close();
});

test('offline recovery de-duplicates exact t/c rows but rejects conflicting valid rows',async()=>{
 const {dom,document,context,task}=environment();
 task.manualBackup.retryInvalidDictionaryChoices=false;
 task.manualBackup.discardInvalidReviewResults=true;
 const binding=task.manualBackup.bindings[0];
 binding.choices.push({choice_id:'c0',type:'hanja',annotations:[{
  start:0,end:2,surface:'경제',replacement:'經濟',type:'hanja'
 }]});
 await context.applyManualRecovery(task,JSON.stringify({
  batch_id:'batch1',results:[
   {t:'t1',c:'computer'},
   {t:'t0',c:'c0'},
   {t:'t0',c:'c0',extra:true}, // malformed: drop before counting
   {t:'t0',c:'c0'}, // identical valid: collapse
   {t:'t2',c:'NULL'},
   {t:'t0',c:'c0'} // identical valid: collapse
  ]
 }));
 assert.equal(task.finished,true);
 assert.equal(task.manualRecoveryAccepted.size,3);
 assert.equal(task.manualRecoveryAccepted.get('t0').choice.choice_id,'c0');
 assert.equal(task.manualRecoveryAccepted.get('t1').choice.annotations[0].replacement,'computer');
 assert.equal(task.manualRecoveryAccepted.get('t2').choice.choice_id,null);
 assert.equal(document.querySelectorAll('p ruby[kra-annotated="true"]').length,2);
 dom.window.close();
});

test('disconnected strict mode rejects invalid p/c/n and unauthorized literal without converting them to null',async()=>{
 const {dom,context,task}=environment();
 for(const choice of ['p4672','c99','n1','漢字不可靠']){
  const raw={batch_id:'batch1',results:[{t:'t0',c:choice},{t:'t1',c:null},{t:'t2',c:null}]};
  await assert.rejects(context.applyManualRecovery(task,JSON.stringify(raw)),/未通过安全校验|不完整|待补交/);
  assert.equal(task.finished,false);
  assert.equal(task.manualRequest,'batch1');
 }
 dom.window.close();
});

test('offline dictionary choice bypasses model-only Hanja reading veto even when enabled',async()=>{
 const {dom,document,context,task}=environment();
 task.manualBackup.hanjaReadingCheck=true;
 task.manualReadingCheck=Promise.resolve(()=>({status:'mismatch'}));
 task.manualBackup.bindings[0].choices.push({choice_id:'c0',type:'hanja',annotations:[{
  start:0,end:2,surface:'경제',replacement:'經濟',type:'hanja',entry_id:1234
 }]});
 await context.applyManualRecovery(task,JSON.stringify({
  batch_id:'batch1',results:[{t:'t0',c:'c0'},{t:'t1',c:null},{t:'t2',c:null}]
 }));
 assert.equal(task.manualRecoveryAccepted.get('t0').choice.choice_id,'c0');
 assert.equal(task.finished,true);
 assert.ok(document.querySelector('p ruby[kra-annotated="true"]'));
 dom.window.close();
});

test('offline direct Hanja still respects optional reading veto',async()=>{
 const {dom,context,task}=environment();
 task.manualBackup.hanjaReadingCheck=true;
 task.manualReadingCheck=Promise.resolve(()=>({status:'mismatch'}));
 const response={batch_id:'batch1',results:[{t:'t0',c:'經濟'},{t:'t1',c:null},{t:'t2',c:null}]};
 await assert.rejects(context.applyManualRecovery(task,JSON.stringify(response)),/已验证 2\/3|待补交/);
 assert.equal(task.manualRecoveryAccepted.has('t0'),false);
 assert.equal(task.finished,false);
 dom.window.close();
});

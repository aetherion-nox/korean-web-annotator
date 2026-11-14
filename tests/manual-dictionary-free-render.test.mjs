import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createParagraphPlan} from '../paragraph-plan.js';
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
  start,end,surface:text.slice(start,end),choices:[{choice_id:'KEEP',annotations:[]}],
  literalOrigin:{eligibleHanja:true,eligibleLoanword:true,hanja:true,loanword:true,known:[]}});
 const backup={requestId:'batch1',batchNumber:1,batchTotal:1,targetCount:3,text:'original',
  bindings:[binding('t0',0,2),binding('t1',3,6),binding('t2',7,9)]};
 const task={operationId:'op',entries,paragraphPlan:plan,manualRequest:'batch1',manualBackup:backup,
  manualOriginalPrompt:'original',manualPlan:[backup],manualLocalOnly:false,
  manualReadingCheck:Promise.resolve(()=>({status:'match'})),
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
 assert.match(panel.querySelector('.kra-manual-status').textContent,/已在当前网页显示 2 个标注/);
 assert.equal(panel.querySelector('.kra-manual-prompt').value,'only t2');
 assert.equal(panel.querySelector('.kra-manual-apply').disabled,false);
 assert.ok(errors.every(e=>e.level!=='warning'),JSON.stringify(errors));
 dom.window.close();
});

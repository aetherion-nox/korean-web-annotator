import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createParagraphPlan} from '../paragraph-plan.js';
import {buildManualPrompt} from '../review-payload.js';
import {validateModelHanjaReadings} from '../hanja-reading-check.js';
import {validateSegmentationRepairsCore} from '../repair-validation-core.js';
const {JSDOM}=createRequire(import.meta.url)('jsdom');

function setup(){
 const dom=new JSDOM('<body><p>과학이야기</p><section class="kra-manual-review">'+
 '<textarea class="kra-manual-prompt"></textarea><textarea class="kra-manual-response"></textarea>'+
 '<span class="kra-manual-summary"></span><span class="kra-manual-status"></span>'+
 '<button class="kra-manual-apply"></button><button class="kra-manual-import"></button></section></body>');
 const document=dom.window.document,p=document.querySelector('p'),node=p.firstChild,text=node.data;
 const entry={node,id:'node0',text,annotations:[],localAnnotations:[],selected:[{start:0,end:text.length}]};
 const entries=new Map([[node,entry]]);
 const paragraphPlan=createParagraphPlan(entries,element=>({text:element.textContent,
  runs:[{node,start:0,end:node.data.length}]}),'p');
 assert.equal(paragraphPlan.sentences[0].id,'p0');
 const choice={choice_id:'KEEP',type:'keep',replacement:text,entry_id:null,definitions:[]};
 const target={target_id:'t0',original_target_id:'t0',repair_sentence_key:'p0',start:0,end:text.length,
  surface:text,context:text,repair_context:{kiwi_tokens:[],protected_ranges:[]},
  options:[choice]};
 const prompt=buildManualPrompt(text,[target],'batch1',{smartSegmentation:true});
 const scope={text,allTargets:[target],localAnnotations:[],protected_ranges:[],
  selected:[{start:0,end:text.length}],existingRepairs:[]};
 const backup={requestId:'batch1',batchNumber:1,batchTotal:1,targetCount:1,text:prompt,
  smartSegmentation:true,hanjaReadingCheck:true,
  repairValidation:{targets:[{target_id:'t0',original_target_id:'t0',
    repair_sentence_key:'p0',start:0,end:text.length,surface:text}],
    scopes:[['p0',scope]]},
  bindings:[{target_id:'t0',sentenceId:'p0',start:0,end:text.length,surface:text,
    choices:[{choice_id:'KEEP',annotations:[]}]}]};
 const task={operationId:'op',entries,paragraphPlan,manualBackup:backup,
  manualRequest:'batch1',manualLocalOnly:true,manualPlan:[backup],
  manualOriginalPrompt:prompt,modes:{hanja:true,loanword:true},
  manualReadingCheck:Promise.resolve(validateModelHanjaReadings),
  manualRepairValidator:Promise.resolve(validateSegmentationRepairsCore),
  operation:[],wholePage:false,finished:false};
 const panel=document.querySelector('.kra-manual-review');
 panel.dataset.operationId='op';panel.dataset.requestId='batch1';
 const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
 const context={chrome:{runtime:{getURL:name=>new URL('../'+name,import.meta.url).href}},document,OWN_RUBY:'ruby[kra-annotated="true"]',currentTask:task,
  ownDomChanges:new WeakSet(),seenSources:new Set(),rememberRecovery(){},uiSettings:{},
  getToolbar:()=>panel,manualPanel:()=>panel,refreshManualReopen(){},publishState(){},
  configureRecovery(){},configureAutomaticAnnotation(){},status(){},addDiagnostic(){},
  clearTimeout(){},clearInterval(){},setTimeout:()=>1,
  finishTask(t){t.finished=true;},console};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('  function loanwordDisplay'),source.indexOf('  function contextState')),context,{importModuleDynamically:specifier=>import(specifier)});
 vm.runInContext(source.slice(source.indexOf('  function recoverManualConnection'),
  source.indexOf('  function status(',source.indexOf('  function recoverManualConnection'))),context,{importModuleDynamically:specifier=>import(specifier)});
 task.paint=()=>{context.insertConversions(entries,task.operation);
  return document.querySelectorAll('p ruby[kra-annotated="true"]').length;};
 return {dom,document,context,task};
}
const repaired={
 results:[false],repairs:[{sentence_id:'s0',op:'replace',old_target_ids:['t0'],
  start:0,end:2,surface:'과학',choice_id:'科學'}]
};
test('disconnected review accepts repair-only answer without old target result and renders Hanja stem',async()=>{
 const {dom,document,context,task}=setup();
 await context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',...repaired}));
 assert.equal(document.querySelectorAll('p ruby[kra-annotated="true"]').length,1);
 const ruby=document.querySelector('p ruby');
 assert.equal(ruby.firstChild.textContent,'科學');
 assert.equal(ruby.querySelector('rt').textContent,'과학');
 assert.match(document.querySelector('p').textContent,/이야기/);
 assert.equal(task.manualRecoveryRepairs.length,1);
 assert.equal(task.finished,true);
 dom.window.close();
});
test('invalid repair in disconnected mode cannot retire the original or write a false annotation',async()=>{
 const {dom,document,context,task}=setup();
 const bad={results:[],repairs:[{...repaired.repairs[0],choice_id:'韓國'}]};
 await assert.rejects(context.applyManualRecovery(task,JSON.stringify({batch_id:'batch1',...bad})),/不完整|长度或原始位置错误/);
 assert.equal(task.manualRecoveryRepairs.length,0);
 assert.equal(document.querySelectorAll('p ruby[kra-annotated="true"]').length,0);
 assert.equal(task.finished,false);
 dom.window.close();
});

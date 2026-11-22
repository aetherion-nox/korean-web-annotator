import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createParagraphPlan} from '../paragraph-plan.js';

const {JSDOM}=createRequire(import.meta.url)('jsdom');
const SOURCE=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
function fixture(){
 const dom=new JSDOM('<main><p id="story">학교에 게임을 한다.</p></main>',{url:'https://fixture.test/read'});
 const ctx={
  document:dom.window.document,NodeFilter:dom.window.NodeFilter,
  MAX_RECOVERY_BLOCKS:12000,OWN_RUBY:'ruby[kra-annotated="true"]',
  seenSources:new Set(),analyzedNodeVersions:new WeakMap(),recoveryBlocks:new Set(),
  ownDomChanges:new WeakSet(),autoResumeAttempts:0,pageIdentity:()=>'',lastScanStats:null,
  recoveryAnchor:()=>null,rememberRecovery(){},
  stopHydrationGrace(){},startHydrationGrace(){},refreshTabHistoryCounter(){},
  send(){},cancelTask(){},status(){},finishTask(){},configureRecovery(){},
  configureAutomaticAnnotation(){},addDiagnostic(){},publishState(){},
  setInterval:()=>1,clearInterval(){},clearTimeout(){},setTimeout:()=>1,
  uiSettings:{progressiveAnnotation:false,hanjaMode:true,loanwordMode:true},
  sequence:0,history:[],redoStack:[],HISTORY_LIMIT:100,
  diagnostics:[],currentTask:null,createParagraphPlan,
  BLOCK_TAGS:'p,li,h1,h2,blockquote',
  console
 };
 let listener,request;
 ctx.chrome={runtime:{connect:()=>({
  postMessage:m=>{request=m;},
  onMessage:{addListener:f=>{listener=f;}},
  onDisconnect:{addListener(){}},disconnect(){}
 })}};
 vm.createContext(ctx);
 vm.runInContext(SOURCE.slice(SOURCE.indexOf('  function sourceOf'),SOURCE.indexOf('  function pageIdentity')),ctx);
 vm.runInContext(SOURCE.slice(SOURCE.indexOf('  function selectedIntervals'),SOURCE.indexOf('  function applySettings')),ctx);
 vm.runInContext(SOURCE.slice(SOURCE.indexOf('  function openTextRoots'),SOURCE.indexOf('  function isKnownRecoverySource')),ctx);
 vm.runInContext(SOURCE.slice(SOURCE.indexOf('  function loanwordDisplay'),SOURCE.indexOf('  function contextState')),ctx);
 vm.runInContext(SOURCE.slice(SOURCE.indexOf('  function startAnnotation'),SOURCE.indexOf('  chrome.runtime.onMessage.addListener')),ctx);
 const result=ctx.startAnnotation({modes:{hanja:true,loanword:true}});
 assert.equal(result.started,true);
 const entry=[...ctx.currentTask.entries.values()][0];
 const text=entry.text;
 const school=text.indexOf('학교'),game=text.indexOf('게임');
 const local=[
  {start:school,end:school+2,surface:'학교',replacement:'學校',type:'hanja'},
  {start:game,end:game+2,surface:'게임',replacement:'game',type:'loanword'}
 ];
 const send=(source,annotations,reviewed=[],provisional=false)=>{
  assert.ok(listener);
  listener({type:'RESULTS',operationId:request.operationId,source,provisional,
   results:[{id:request.sentences[0].id,annotations,reviewed}],
   completedSentences:1,totalSentences:1,percent:100});
 };
 send('local',local);
 return {ctx,dom,entry,send,local,school,game,close:()=>dom.window.close()};
}
const spans=f=>[{start:f.school,end:f.school+2,surface:'학교'}];

test('web normal RESULTS: model null/KEEP drops local annotation only in its reviewed source span',()=>{
 const f=fixture();
 try{
  assert.equal(f.entry.annotations.length,2);
  f.send('model',[],spans(f));
  assert.deepEqual(Array.from(f.entry.annotations,a=>a.surface),['게임']);
  assert.deepEqual(Array.from(f.entry.modelReviewedRanges,r=>r.surface),['학교']);
  assert.deepEqual(Array.from(f.entry.committedModelReviewedRanges,r=>r.surface),['학교']);
  assert.equal(f.entry.modelReviewed,true);
  assert.equal(f.entry.hasPreview,false);
 }finally{f.close();}
});

test('web normal RESULTS: model positive replacement overrides the local spelling and retains other local annotations',()=>{
 const f=fixture();
 try{
  f.send('model',[{start:f.school,end:f.school+2,surface:'학교',replacement:'學敎',type:'hanja'}],spans(f));
  assert.deepEqual(Array.from(f.entry.annotations,a=>a.replacement),['game','學敎']);
 }finally{f.close();}
});

test('web normal RESULTS: empty or invalid reviewed ranges must never wipe local annotations',()=>{
 for(const reviewed of [[],[{start:0,end:2,surface:'틀림'}],[{start:-1,end:2,surface:'학교'}],
   [{start:0,end:200,surface:'학교'}]]){
  const f=fixture();
  try{
   f.send('model',[],reviewed);
   assert.equal(f.entry.annotations.length,2);
  }finally{f.close();}
 }
});

test('web preview: cancelled model KEEP restores local annotation; confirmed disconnect preserves it',()=>{
 for(const preserve of [false,true]){
  const f=fixture();
  try{
   f.send('model',[],spans(f),true);
   assert.deepEqual(Array.from(f.entry.annotations,a=>a.surface),['게임']);
   assert.equal(f.entry.hasPreview,true);
   assert.equal(f.entry.committedModelReviewedRanges.length,0);
   f.ctx.currentTask.reconcile(preserve);
   assert.deepEqual(Array.from(f.entry.annotations,a=>a.surface),
    preserve?['게임']:['학교','게임']);
   assert.equal(f.entry.hasPreview,false);
   assert.equal(f.entry.committedModelReviewedRanges.length,preserve?1:0);
  }finally{f.close();}
 }
});

test('paragraph projections separate current reviewed spans from previously committed spans',()=>{
 const dom=new JSDOM('<main><p>학교에 게임을 한다.</p></main>');
 const e=dom.window.document.querySelector('p').firstChild;
 const entry={node:e,id:'x',text:e.data,selected:[{start:0,end:e.data.length}]};
 const entries=new Map([[e,entry]]);
 const read=el=>({text:el.textContent,runs:[{node:e,start:0,end:e.data.length}]});
 const plan=createParagraphPlan(entries,read,'p');
 const sid=plan.sentences[0].id;
 const r={id:sid,annotations:[],reviewed:[{start:0,end:2,surface:'학교'}]};
 const preview=plan.projectResult(r,{source:'model',provisional:true})[0];
 assert.equal(preview.hasPreview,true);
 assert.equal(preview.reviewed.length,1);
 assert.equal(preview.committedReviewedRanges.length,0);
 const applied=plan.projectResult(r,{source:'model',provisional:false})[0];
 assert.equal(applied.hasPreview,false);
 assert.equal(applied.committedReviewedRanges.length,1);
 dom.window.close();
});

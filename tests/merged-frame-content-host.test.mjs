import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
const snippet=source.slice(source.indexOf('  let createParagraphPlan;'),
 source.indexOf('  chrome.runtime.onMessage.addListener',source.indexOf('  let createParagraphPlan;')));
function environment(){
 const starts=[],status=[],listeners={};
 const port={
  onDisconnect:{addListener:fn=>listeners.disconnect=fn},
  onMessage:{addListener:fn=>listeners.message=fn},
  postMessage:msg=>starts.push(msg),
  disconnect:()=>{}
 };
 const c={
  currentTask:null,sequence:0,uiSettings:{},history:[],diagnostics:[],
  document:{querySelector:()=>null,location:{href:'https://example.test/article'}},
  location:{href:'https://example.test/article'},chrome:{runtime:{connect:()=>port,getURL:s=>s}},
  collectTextNodes:()=>new Map(),lastScanStats:{textNodes:0,hangulNodes:0},
  cancelTask:()=>{},addDiagnostic:()=>{},status:(x)=>status.push(x),
  sourceOf:()=>{},BLOCK_TAGS:'p',setInterval:()=>11,
  clearInterval:()=>{},clearTimeout:()=>{},getToolbar:()=>({}),
  seenSources:new Set(),publishState:()=>{},configureRecovery:()=>{}
 };
 vm.createContext(c);
 vm.runInContext(snippet,c);
 vm.runInContext('createParagraphPlan=()=>({sentences:[],context:""})',c);
 return {c,starts,status,listeners};
}
test('empty top-level document still joins merged group and can host the single review window',async()=>{
 const e=environment();
 const result=await e.c.startAnnotation({modes:{hanja:true,loanword:true},
  mergeGroupId:'frame-group-1',mergeHost:true});
 assert.equal(result.ok,true);
 assert.equal(result.started,true);
 assert.equal(e.starts.length,1);
 assert.equal(e.starts[0].mergeGroupId,'frame-group-1');
 assert.equal(e.starts[0].sentences.length,0);
 assert.equal(vm.runInContext('currentTask.mergedHost',e.c),true);
 assert.equal(vm.runInContext('currentTask.mergedGroup',e.c),true);
});
test('ordinary single-frame empty page keeps no-work fast exit without opening stream',async()=>{
 const e=environment();
 const result=await e.c.startAnnotation({modes:{hanja:true,loanword:true}});
 assert.equal(result.ok,true);assert.equal(result.started,false);
 assert.equal(e.starts.length,0);
});
test('merged API task does not launch a second independent main-frame hydration pass',()=>{
 assert.match(source,/if\(!ranges&&!task\.mergedGroup&&!task\.startedAutomatically/);
});

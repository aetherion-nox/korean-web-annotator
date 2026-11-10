import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
import {runSentencePipeline} from '../annotation-pipeline.js';

test('filter dictionary person names defaults enabled and persists opt-out in all five locales',async()=>{
 const html=await fs.readFile(new URL('../options.html',import.meta.url),'utf8');
 const js=await fs.readFile(new URL('../engine-settings.js',import.meta.url),'utf8');
 for(const initial of [undefined,false,true]){
  const dom=new JSDOM(html);
  const state={enableModelReview:false,filterDictionaryPeople:initial};
  const context={document:dom.window.document,console,
   normalizeBatchContextTier:x=>x||'32k',
   readDictionaryInfo:async()=>({imported:false}),
   chrome:{storage:{local:{get:async()=>state,set:async changes=>Object.assign(state,changes)}}}};
  vm.runInNewContext(js.replace(/^import[^\n]*\n/gm,''),context);
  await new Promise(resolve=>setTimeout(resolve,10));
  try{
   const checkbox=dom.window.document.getElementById('filterDictionaryPeople');
   assert.ok(checkbox);
   assert.equal(checkbox.checked,initial!==false);
   assert.equal(dom.window.document.getElementById('enableModelReview').checked,false);
   checkbox.checked=false;checkbox.dispatchEvent(new dom.window.Event('change'));
   await new Promise(resolve=>setTimeout(resolve,10));
   assert.equal(state.filterDictionaryPeople,false);
   for(const locale of ['zh-CN','zh-TW','en','ja','ko']){
    const picker=dom.window.document.getElementById('uiLocale');picker.value=locale;
    picker.dispatchEvent(new dom.window.Event('change'));
    assert.ok(dom.window.document.querySelector('[data-engine-i18n="filterDictionaryPeopleHint"]').textContent.length>30);
   }
  }finally{dom.window.close();}
 }
});

test('local analysis receives filter by default and cache changes if toggled off',async()=>{
 const seen=[],cache=new Map(),text='학교';
 const identity={engine_version:'example',dictionary_fingerprint:'fingerprint'};
 const analyze=async(_,modes)=>{seen.push(modes.filterDictionaryPeople);return {...identity,annotations:[],targets:[],stats:{pending:0}}};
 const options={analyze,status:async()=>identity,cache};
 for(const setting of [undefined,false,undefined]){
  await runSentencePipeline({operationId:'filter-'+seen.length,sentences:[{id:'s',text}],
   modes:{hanja:true},filterDictionaryPeople:setting},()=>{},options);
 }
 assert.deepEqual(seen,[true,false],'reenabling should reuse original cache');
});

test('upgraded biography filter never reuses local results created before the fix',async()=>{
 const text='장보고',identity={engine_version:'fixture',dictionary_fingerprint:'fingerprint'};
 const modes={hanja:true,loanword:false,nameProtection:true,filterDictionaryPeople:true};
 const oldKey=JSON.stringify(['dictionary-v3-alignment',false,identity.engine_version,identity.dictionary_fingerprint,modes,text]);
 const outdated={...identity,annotations:[],targets:[{target_id:'old',surface:text,start:0,end:3,
  context:text,options:[{choice_id:'KEEP',type:'keep',replacement:text,entry_id:null,definitions:[]},
   {choice_id:'c0',type:'hanja',replacement:'張保皐',entry_id:262577,definitions:['historical general']}]}],stats:{pending:1}};
 const cache=new Map([[oldKey,outdated]]);
 let analyzed=0;
 const result=await runSentencePipeline({operationId:'after-fix',sentences:[{id:'s',text}],modes:{hanja:true}},()=>{},{
  status:async()=>identity,
  analyze:async()=>{analyzed++;return {...identity,annotations:[],targets:[],stats:{pending:0}};},
  cache
 });
 assert.equal(analyzed,1,'old cache must not resurrect the person entry');
 assert.equal(result.pending,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {engineConfig} from '../local-engine.js';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
const html=await fs.readFile(new URL('../options.html',import.meta.url),'utf8');
const settings=await fs.readFile(new URL('../engine-settings.js',import.meta.url),'utf8');
const wait=()=>new Promise(resolve=>setTimeout(resolve,10));

test('smart segmentation defaults OFF, independently toggles on, persists, and turns on model review',async()=>{
 for(const initial of [undefined,false,true]){
  const dom=new JSDOM(html),state={enableModelReview:false,smartSegmentation:initial};
  const context={document:dom.window.document,console,normalizeBatchContextTier:x=>x||'32k',
   readDictionaryInfo:async()=>({imported:false}),
   chrome:{storage:{local:{get:async()=>state,set:async v=>Object.assign(state,v)}}}};
  vm.runInNewContext(settings.replace(/^import[^\n]*\n/gm,''),context);
  await wait();
  try{
   const checkbox=dom.window.document.getElementById('smartSegmentation');
   assert.equal(checkbox.checked,initial===true);
   checkbox.checked=true;checkbox.dispatchEvent(new dom.window.Event('change'));await wait();
   assert.equal(state.smartSegmentation,true);
   assert.equal(state.enableModelReview,true);
   const model=dom.window.document.getElementById('enableModelReview');
   model.checked=false;model.dispatchEvent(new dom.window.Event('change'));await wait();
   assert.equal(state.smartSegmentation,false);
   for(const locale of ['zh-CN','zh-TW','en','ja','ko']){
    const picker=dom.window.document.getElementById('uiLocale');
    picker.value=locale;picker.dispatchEvent(new dom.window.Event('change'));
    assert.ok(dom.window.document.querySelector('[data-engine-i18n="smartSegmentationHint"]').textContent.length>25,locale);
   }
  }finally{dom.window.close();}
 }
});

test('engineConfig respects feature isolation and does not enable experimental origin flags',async()=>{
 const previous=globalThis.chrome;
 try{
  for(const value of [undefined,false,true]){
   globalThis.chrome={storage:{local:{get:async()=>({smartSegmentation:value})}}};
   const config=await engineConfig();
   assert.equal(config.smartSegmentation,value===true);
   assert.equal(config.enableModelReview,value===true);
   assert.equal(config.experimentalHanja,false);
   assert.equal(config.experimentalLoanword,false);
  }
 }finally{globalThis.chrome=previous;}
});

test('smart repair option does not change the existing context-tier list',()=>{
 const dom=new JSDOM(html);
 try{
  assert.deepEqual([...dom.window.document.querySelector('#batchContextTier').options].map(o=>o.value),
   ['32k','128k','256k','512k','1m']);
 }finally{dom.window.close();}
});

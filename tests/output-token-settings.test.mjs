import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {engineConfig} from '../local-engine.js';
import {describeBatchBudget} from '../batch-budget.js';

const {JSDOM}=createRequire(import.meta.url)('jsdom');
const html=await fs.readFile(new URL('../options.html',import.meta.url),'utf8');
const js=await fs.readFile(new URL('../engine-settings.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,12));

test('API/manual token controls restore saved values and default to 16384/65536',async()=>{
 for(const stored of [{},{apiOutputTokenLimit:32768,manualOutputTokenLimit:131072}]){
  const dom=new JSDOM(html);
  const state={enableModelReview:false,...stored};
  const sandbox={document:dom.window.document,console,normalizeBatchContextTier:x=>x||'32k',
   readDictionaryInfo:async()=>({imported:false}),
   chrome:{storage:{local:{get:async()=>({...state}),set:async obj=>Object.assign(state,obj)}}}};
  vm.runInNewContext(js.replace(/^import[^\n]*\n/gm,''),sandbox);
  await tick();
  try{
   const api=dom.window.document.getElementById('apiOutputTokenLimit');
   const manual=dom.window.document.getElementById('manualOutputTokenLimit');
   assert.equal(Number(api.value),stored.apiOutputTokenLimit||16384);
   assert.equal(Number(manual.value),stored.manualOutputTokenLimit||65536);
   api.value='64000';api.dispatchEvent(new dom.window.Event('change'));await tick();
   assert.equal(state.apiOutputTokenLimit,64000);
   assert.equal(state.manualOutputTokenLimit,stored.manualOutputTokenLimit||65536);
   manual.value='200000';manual.dispatchEvent(new dom.window.Event('change'));await tick();
   assert.equal(state.manualOutputTokenLimit,200000);
   for(const locale of ['zh-CN','zh-TW','en','ja','ko']){
    const picker=dom.window.document.getElementById('uiLocale');picker.value=locale;
    picker.dispatchEvent(new dom.window.Event('change'));
    for(const key of ['apiOutputTokenLimitLabel','manualOutputTokenLimitLabel','outputTokenLimitHint']){
     assert.ok(dom.window.document.querySelector('[data-engine-i18n="'+key+'"]').textContent.length>12,locale+' '+key);
    }
   }
   api.value='1000001';api.dispatchEvent(new dom.window.Event('change'));await tick();
   assert.equal(state.apiOutputTokenLimit,64000,'invalid value must not overwrite prior setting');
   assert.ok(dom.window.document.getElementById('engineStatus').textContent.includes('1,000,000'));
  }finally{dom.window.close();}
 }
});

test('engineConfig uses configured values and falls back safely for old installations',async()=>{
 const saved=globalThis.chrome;
 try{
  for(const data of [
   {apiOutputTokenLimit:44100,manualOutputTokenLimit:120000},
   {},
   {apiOutputTokenLimit:'bad',manualOutputTokenLimit:2000000}
  ]){
   globalThis.chrome={storage:{local:{get:async()=>data}}};
   const config=await engineConfig();
   assert.equal(config.apiOutputTokenLimit,data.apiOutputTokenLimit===44100?44100:16384);
   assert.equal(config.manualOutputTokenLimit,data.manualOutputTokenLimit===120000?120000:65536);
  }
 }finally{globalThis.chrome=saved;}
});

test('custom reply caps affect output budget, never pretend to override actual chat UI cap',()=>{
 const t={target_id:'t0',surface:'원잠',context:'원잠',start:0,end:2,options:[
  {choice_id:'KEEP',type:'keep',replacement:'원잠',entry_id:null,definitions:[]}]};
 const manual=describeBatchBudget('원잠',[t],{tier:'512k',manual:true,manualOutputTokenLimit:130000});
 const api=describeBatchBudget('원잠',[t],{tier:'512k',manual:false,apiOutputTokenLimit:30000});
 assert.equal(manual.outputLimit,130000);assert.equal(api.outputLimit,30000);
 assert.ok(api.reservedOutputTokens<30000&&api.reservedOutputTokens>=api.outputTokens);
 assert.ok(manual.reservedOutputTokens<130000,'manual cap is a ceiling, not forced reservation');
});

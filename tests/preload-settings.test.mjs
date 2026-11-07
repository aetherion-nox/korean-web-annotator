import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const root=process.env.KRA_PRELOAD_TEST_ROOT?pathToFileURL(process.env.KRA_PRELOAD_TEST_ROOT+'/'):new URL('../',import.meta.url);
const {JSDOM}=createRequire(import.meta.url)('jsdom');
test('preload setting defaults on, restores off, saves immediately and translates in every locale',async()=>{
 for(const initial of [undefined,false,true]){
  const dom=new JSDOM(fs.readFileSync(new URL('options.html',root),'utf8'));const state={enableModelReview:false,preloadEngineOnStartup:initial};const c={document:dom.window.document,console,normalizeBatchContextTier:x=>x||'32k',readDictionaryInfo:async()=>({imported:false}),chrome:{storage:{local:{get:async()=>state,set:async s=>Object.assign(state,s)}}}};
  vm.runInNewContext(fs.readFileSync(new URL('engine-settings.js',root),'utf8').replace(/^import[^\n]+\n/gm,''),c);await new Promise(r=>setTimeout(r,5));
  try{
   const input=dom.window.document.getElementById('preloadEngineOnStartup');assert.ok(input);assert.equal(input.checked,initial!==false);input.checked=false;input.dispatchEvent(new dom.window.Event('change'));await new Promise(r=>setTimeout(r,5));assert.equal(state.preloadEngineOnStartup,false);
   for(const locale of ['zh-CN','zh-TW','en','ja','ko']){const picker=dom.window.document.getElementById('uiLocale');picker.value=locale;picker.dispatchEvent(new dom.window.Event('change'));assert.ok(dom.window.document.querySelector('[data-engine-i18n="preloadEngineOnStartup"]').textContent.length>5);}
  }finally{dom.window.close();}
 }
});

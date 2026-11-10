import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const {JSDOM}=createRequire(import.meta.url)('jsdom');

test('selective local review starts on, persists opt-out, and does not force API review on',async()=>{
 const html=await fs.readFile(new URL('../options.html',import.meta.url),'utf8');
 const js=await fs.readFile(new URL('../engine-settings.js',import.meta.url),'utf8');
 for(const initial of [undefined,false,true]){
  const dom=new JSDOM(html);
  const state={enableModelReview:false,reviewLocalConversions:initial};
  const context={
   document:dom.window.document,console,
   normalizeBatchContextTier:x=>x||'32k',
   readDictionaryInfo:async()=>({imported:false}),
   chrome:{storage:{local:{get:async()=>state,set:async changes=>Object.assign(state,changes)}}}
  };
  vm.runInNewContext(js.replace(/^import[^\n]*\n/gm,''),context);
  await new Promise(resolve=>setTimeout(resolve,10));
  const checkbox=dom.window.document.getElementById('reviewLocalConversions');
  assert.ok(checkbox);
  assert.equal(checkbox.checked,initial!==false);
  assert.equal(dom.window.document.getElementById('enableModelReview').checked,false);
  checkbox.checked=false;
  checkbox.dispatchEvent(new dom.window.Event('change'));
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(state.reviewLocalConversions,false);
  for(const locale of ['zh-CN','zh-TW','en','ja','ko']){
   const picker=dom.window.document.getElementById('uiLocale');
   picker.value=locale;
   picker.dispatchEvent(new dom.window.Event('change'));
   assert.ok(dom.window.document.querySelector('[data-engine-i18n="reviewLocalConversionsHint"]').textContent.length>30);
  }
  dom.window.close();
 }
});

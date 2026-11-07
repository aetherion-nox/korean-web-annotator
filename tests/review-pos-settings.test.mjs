import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
for(const root of [process.env.KRA_POS_TEST_ROOT?pathToFileURL(process.env.KRA_POS_TEST_ROOT+'/'):new URL('../',import.meta.url)]){
 test(root.pathname+' review POS setting defaults on, saves off and restores',async()=>{
  for(const initial of [undefined,false]){
   const dom=new JSDOM(fs.readFileSync(new URL('options.html',root),'utf8'));let stored={reviewPosFilter:initial};
   const context={document:dom.window.document,console,normalizeBatchContextTier:x=>x||'32k',readDictionaryInfo:async()=>({imported:false}),chrome:{storage:{local:{get:async()=>stored,set:async s=>Object.assign(stored,s)}}}};
   vm.runInNewContext(fs.readFileSync(new URL('engine-settings.js',root),'utf8').replace(/^import[^\n]+\n/gm,''),context);
   await new Promise(r=>setTimeout(r,1));const input=dom.window.document.getElementById('reviewPosFilter');assert.ok(input);assert.equal(input.checked,initial!==false);
   input.checked=false;input.dispatchEvent(new dom.window.Event('change'));await new Promise(r=>setTimeout(r,1));assert.equal(stored.reviewPosFilter,false);
   dom.window.document.getElementById('uiLocale').value='en';dom.window.document.getElementById('uiLocale').dispatchEvent(new dom.window.Event('change'));assert.match(dom.window.document.querySelector('[data-engine-i18n="reviewPosFilter"]').textContent,/POS/);
   const {engineConfig}=await import(new URL('local-engine.js',root));globalThis.chrome=context.chrome;assert.equal((await engineConfig()).reviewPosFilter,false);delete stored.reviewPosFilter;assert.equal((await engineConfig()).reviewPosFilter,true);delete globalThis.chrome;
   dom.window.close();
  }
 });
}

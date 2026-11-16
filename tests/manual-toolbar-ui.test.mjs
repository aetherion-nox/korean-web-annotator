import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {createRequire} from 'node:module';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
test('popup defaults on, saves off, and retains setting when saving run config',async()=>{
 for(const initial of [undefined,false]){
  const dom=new JSDOM(fs.readFileSync(new URL('../popup.html',import.meta.url),'utf8'));let stored={uiSettings:{hideToolbarOnFirstManual:initial}};
  const c={document:dom.window.document,console,chrome:{storage:{local:{get:async()=>stored,set:async x=>Object.assign(stored,x)}},tabs:{query:async()=>[]},runtime:{sendMessage:async()=>({ok:false})}}};vm.createContext(c);vm.runInContext(fs.readFileSync(new URL('../popup.js',import.meta.url),'utf8'),c);await new Promise(r=>setTimeout(r,1));
  const input=dom.window.document.querySelector('#hideToolbarOnFirstManual');assert.equal(input.checked,initial!==false);
  input.checked=false;input.dispatchEvent(new dom.window.Event('change'));await new Promise(r=>setTimeout(r,1));assert.equal(stored.uiSettings.hideToolbarOnFirstManual,false);
  assert.equal(vm.runInContext('currentUiSettings()',c).hideToolbarOnFirstManual,false);
  await vm.runInContext('saveAndGetRunSettings().catch(()=>{})',c);assert.equal(stored.uiSettings.hideToolbarOnFirstManual,false);dom.window.close();
 }
});
test('background settings forward the flag and default to true',()=>{
 const src=fs.readFileSync(new URL('../service-worker.js',import.meta.url),'utf8');const c={normalizeUiLocale:()=> 'zh-CN'};vm.createContext(c);vm.runInContext(src.slice(src.indexOf('function sanitizeUiSettings'),src.indexOf('function normalizeUiLocale')),c);
 assert.equal(c.sanitizeUiSettings({}).hideToolbarOnFirstManual,true);assert.equal(c.sanitizeUiSettings({hideToolbarOnFirstManual:false}).hideToolbarOnFirstManual,false);
});

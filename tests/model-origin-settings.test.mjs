import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {engineConfig} from '../local-engine.js';
test('independent experimental settings off by default, and present in five locales',async()=>{
 const html=fs.readFileSync(new URL('../options.html',import.meta.url),'utf8');
 const ui=fs.readFileSync(new URL('../engine-settings.js',import.meta.url),'utf8');
 for(const key of ['allowModelHanja','allowModelLoanword']){
  assert.match(html,new RegExp('id="'+key+'"[^>]*type="checkbox"'));
  assert.match(ui,new RegExp(key+':'));
 }
 for(const lang of ['zh-CN','zh-TW','en','ja','ko'])assert.ok(ui.includes(lang+':')||ui.includes("'"+lang+"':"));
 globalThis.chrome={storage:{local:{get:async()=>({})}}};
 const off=await engineConfig();assert.equal(off.allowModelHanja,false);assert.equal(off.allowModelLoanword,false);
 globalThis.chrome={storage:{local:{get:async()=>({allowModelHanja:true,allowModelLoanword:false})}}};
 const on=await engineConfig();assert.equal(on.allowModelHanja,true);assert.equal(on.allowModelLoanword,false);
 delete globalThis.chrome;
});

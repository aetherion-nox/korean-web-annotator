import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {engineConfig} from '../local-engine.js';
test('requested screenshot defaults and independent experimental overrides, in five locales',async()=>{
 const html=fs.readFileSync(new URL('../options.html',import.meta.url),'utf8');
 const ui=fs.readFileSync(new URL('../engine-settings.js',import.meta.url),'utf8');
 for(const key of ['allowModelHanja','allowModelLoanword','allowModelSegmentation','singleHangulLocalGuard']){
  assert.match(html,new RegExp('id="'+key+'"[^>]*type="checkbox"'));
  assert.match(ui,new RegExp(key+':'));
 }
 for(const lang of ['zh-CN','zh-TW','en','ja','ko'])assert.ok(ui.includes(lang+':')||ui.includes("'"+lang+"':"));
 globalThis.chrome={storage:{local:{get:async()=>({})}}};
 const off=await engineConfig();assert.equal(off.allowModelHanja,true);assert.equal(off.allowModelLoanword,true);
 assert.equal(off.allowModelSegmentation,true);assert.equal(off.singleHangulLocalGuard,true);
 assert.equal(off.enableModelReview,true);assert.equal(off.manualModelReview,true);
 assert.equal(off.reviewAllCandidates,false);assert.equal(off.reviewPosFilter,false);
 assert.equal(off.nameProtection,true);
 globalThis.chrome={storage:{local:{get:async()=>({allowModelHanja:true,allowModelLoanword:false})}}};
 const on=await engineConfig();assert.equal(on.allowModelHanja,true);assert.equal(on.allowModelLoanword,false);
 globalThis.chrome={storage:{local:{get:async()=>({allowModelHanja:false,allowModelLoanword:false,
 allowModelSegmentation:false,singleHangulLocalGuard:false,enableModelReview:false,manualModelReview:false,reviewPosFilter:true,nameProtection:false})}}};
 const overridden=await engineConfig();
 assert.equal(overridden.allowModelHanja,false);assert.equal(overridden.allowModelLoanword,false);
 assert.equal(overridden.allowModelSegmentation,false);assert.equal(overridden.singleHangulLocalGuard,false);
 assert.equal(overridden.enableModelReview,false);assert.equal(overridden.manualModelReview,false);
 assert.equal(overridden.reviewPosFilter,true);assert.equal(overridden.nameProtection,false);
 delete globalThis.chrome;
});

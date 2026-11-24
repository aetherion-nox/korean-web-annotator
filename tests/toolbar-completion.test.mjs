import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
const popup=fs.readFileSync(new URL('../popup.js',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../service-worker.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../popup.html',import.meta.url),'utf8');
function fixture(settings={},pageHasHangul=true,child=false){
 const window={};window.top=child?{}:window;
 let hidden=0;
 const ctx={uiSettings:settings,pageHasHangul,window,dismissToolbar(){hidden++;}};
 vm.runInNewContext(src.slice(src.indexOf('  function collapseCompletedToolbar('),src.indexOf('  function dismissToolbar()')),ctx);
 return {run:ctx.collapseCompletedToolbar,hidden:()=>hidden};
}
test('default successful completion collapses, including explicitly enabled',()=>{
 for(const settings of [{},{hideToolbarOnCompletion:true,toolbarDisplay:'always'}]){
  const f=fixture(settings);f.run(true);assert.equal(f.hidden(),1);
 }
});
test('incomplete review, missing receipts and explicit off retain toolbar',()=>{
 const f=fixture();f.run(false);f.run(true,true);assert.equal(f.hidden(),0);
 const off=fixture({hideToolbarOnCompletion:false});off.run(true);assert.equal(off.hidden(),0);
});
test('do not collapse when there is no usable floating button or in a child frame',()=>{
 for(const f of [fixture({floatingBallEnabled:false}),fixture({mobileSelectionToolbar:false}),fixture({},false),fixture({},true,true)]){
  f.run(true);assert.equal(f.hidden(),0);
 }
});
test('popup control is default-on and persists through all settings paths',()=>{
 assert.match(html,/id="hideToolbarOnCompletion" type="checkbox" checked/);
 assert.match(popup,/hideToolbarOnCompletion\.checked=uiSettings\.hideToolbarOnCompletion!==false/);
 assert.equal((popup.match(/hideToolbarOnCompletion:hideToolbarOnCompletion\.checked/g)||[]).length,3);
 assert.match(popup,/toolbarDisplay, hideToolbarOnCompletion, stopAutoAfterPageComplete/);
 const context={};
 vm.runInNewContext(worker.slice(worker.indexOf('function sanitizeUiSettings('),worker.indexOf('function normalizeUiLocale('))+'\nfunction normalizeUiLocale(v){return v;}',context);
 assert.equal(context.sanitizeUiSettings({}).hideToolbarOnCompletion,true);
 assert.equal(context.sanitizeUiSettings({hideToolbarOnCompletion:false}).hideToolbarOnCompletion,false);
});

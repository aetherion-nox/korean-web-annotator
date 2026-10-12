const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function visible({text='', originals=[], settings={}, pageHasHangul=true, task=false, selected=true}={}) {
  const range = {cloneContents:()=>({textContent:text,querySelectorAll:()=>originals.map(original=>({getAttribute:()=>original}))}),commonAncestorContainer:{nodeType:1,closest:()=>null}};
  const bar = {hidden:true,querySelectorAll:()=>[]};
  const context = {document:{body:{},getSelection:()=>selected?{isCollapsed:false,rangeCount:1,getRangeAt:()=>({cloneRange:()=>range})}:null,addEventListener(){}},chrome:{runtime:{sendMessage:()=>Promise.resolve(null),onMessage:{addListener(){}}}}};
  vm.createContext(context);
  let source = fs.readFileSync(require('node:path').join(__dirname,'../content.js'),'utf8');
  source=source.replace(/\}\)\(\);\s*$/,`globalThis.check=(settings,hasHangul,task,bar)=>{uiSettings={...uiSettings,...settings};pageHasHangul=hasHangul;currentTask=task;getToolbar=()=>bar;refreshToolbar();return !bar.hidden;};})();`);
  vm.runInContext(source,context);
  return context.check({toolbarDisplay:'selection',toolbarHangulOnly:true,...settings},pageHasHangul,task,bar);
}

test('selection mode checks the selection instead of Korean elsewhere on the page',()=>{
  assert.equal(visible({text:'English 中文'}),false);
  assert.equal(visible({text:'English 한국어'}),true);
  assert.equal(visible({text:'한국어',pageHasHangul:false}),true);
  assert.equal(visible({text:'한 ㄱ'}),true);
});
test('annotated selections retain their original Hangul eligibility',()=>{
  assert.equal(visible({text:'韓國',originals:['한국']}),true);
});
test('other toolbar settings and task progress retain their behavior',()=>{
  assert.equal(visible({text:'English',settings:{toolbarHangulOnly:false}}),true);
  assert.equal(visible({selected:false}),false);
  assert.equal(visible({selected:false,settings:{toolbarDisplay:'always'}}),true);
  assert.equal(visible({selected:false,pageHasHangul:false,settings:{toolbarDisplay:'always'}}),false);
  assert.equal(visible({text:'English',task:true}),true);
  assert.equal(visible({text:'한국어',settings:{mobileSelectionToolbar:false}}),false);
});

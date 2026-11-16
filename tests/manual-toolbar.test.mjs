import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function env(setting){
 const controls=new Map();const panel={hidden:true,dataset:{},querySelector:s=>{if(!controls.has(s))controls.set(s,{value:'',disabled:false});return controls.get(s);}};
 const toolbar={hidden:false,isConnected:true,querySelector:()=>({hidden:false})};
 const c={uiSettings:{hideToolbarOnFirstManual:setting},toolbar,manualPanel:()=>panel,document:{querySelector:()=>null},getToolbar:()=>toolbar,clearTimeout(){},configureRecovery(){},status(){},refreshManualReopen(){},dismissToolbar(){toolbar.hidden=true;c.hides++;},hides:0};vm.createContext(c);
 const src=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');vm.runInContext(src.slice(src.indexOf('  function handleManualEvent'),src.indexOf('  function status(')),c);
 const request=n=>({type:'MANUAL_REVIEW_REQUEST',requestId:'r'+n,batchNumber:n,batchTotal:2,targetCount:1,text:'prompt'});
 return {c,panel,toolbar,request};
}
test('default first manual popup hides toolbar but leaves editor open',()=>{const {c,panel,toolbar,request}=env();const task={operationId:'op'};c.handleManualEvent(task,request(1));assert.equal(toolbar.hidden,true);assert.equal(panel.hidden,false);assert.equal(task.manualRequest,'r1');});
test('later batches preserve a toolbar reopened by user; new tasks hide again',()=>{const {c,toolbar,request}=env(true);const task={operationId:'op'};c.handleManualEvent(task,request(1));toolbar.hidden=false;c.handleManualEvent(task,request(2));assert.equal(toolbar.hidden,false);assert.equal(c.hides,1);c.handleManualEvent({operationId:'op2'},request(1));assert.equal(c.hides,2);});
test('switch off keeps toolbar visible through all manual batches',()=>{const {c,toolbar,request}=env(false);const task={operationId:'op'};c.handleManualEvent(task,request(1));c.handleManualEvent(task,request(2));assert.equal(toolbar.hidden,false);assert.equal(c.hides,0);});

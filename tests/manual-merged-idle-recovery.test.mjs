import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {partitionMergedManualRecovery} from '../manual-merged-recovery.js';

const routing=[
 {sentenceId:'f0_s0',frameId:0,operationId:'op-main',localId:'p0'},
 {sentenceId:'f3_s0',frameId:3,operationId:'op-child',localId:'p0'}
];
const choice=(target_id,sentenceId,surface)=>({target_id,sentenceId,surface,start:0,end:surface.length,
 choices:[{choice_id:'KEEP',annotations:[]},{choice_id:'c0',annotations:[{
  start:0,end:surface.length,surface,replacement:'韓國',type:'hanja'
 }]}]});
const backup={requestId:'batch-long-wait',bindings:[choice('t0','f0_s0','한국'),choice('t1','f3_s0','한국')],
 smartSegmentation:false,hanjaReadingCheck:true,batchNumber:1,batchTotal:1};
const originalResponse={batch_id:backup.requestId,
 results:[{t:'t0',c:'c0'},{t:'t1',c:null}]};

test('manual backup survives worker death and targets each ORIGINAL frame source',()=>{
 const parts=partitionMergedManualRecovery(routing,backup,originalResponse);
 assert.deepEqual(parts.map(x=>x.frameId),[0,3]);
 assert.deepEqual(parts.map(x=>x.operationId),['op-main','op-child']);
 for(const p of parts){
  assert.equal(p.backup.requestId,backup.requestId);
  assert.equal(p.backup.bindings.length,1);
  assert.equal(p.backup.bindings[0].sentenceId,'p0');
  assert.equal(JSON.parse(p.answer).batch_id,backup.requestId);
 }
 assert.deepEqual(JSON.parse(parts[0].answer).results,[{t:'t0',c:'c0'}]);
 assert.deepEqual(JSON.parse(parts[1].answer).results,[{t:'t1',c:null}]);
 assert.equal(backup.bindings[0].sentenceId,'f0_s0','do not mutate the original replay snapshot');
});

test('never route ambiguous, duplicated, spoofed or stale ID rows',()=>{
 for(const response of [
  {...originalResponse,batch_id:'wrong'},
  {...originalResponse,results:[{target_id:'t0',choice_id:'c0'}]},
  {...originalResponse,results:[{t:'t0',c:'c0'},{t:'t0',c:null}]},
  {...originalResponse,results:[{t:'t999',c:null}]},
  {...originalResponse,results:[{t:'t0',c:0}]},
  {...originalResponse,results:[{t:'t0',c:'c0',extra:true}]}
 ])assert.throws(()=>partitionMergedManualRecovery(routing,backup,response),undefined,JSON.stringify(response));
 assert.throws(()=>partitionMergedManualRecovery(routing.slice(1),backup,originalResponse));
});

test('smart segmentation backup and repair positions are localized per frame',()=>{
 const smartBackup={...backup,smartSegmentation:true,repairValidation:{
  targets:[
   {target_id:'t0',repair_sentence_key:'f0_s0',surface:'한국'},
   {target_id:'t1',repair_sentence_key:'f3_s0',surface:'한국'}],
  scopes:[['f0_s0',{text:'한국'}],['f3_s0',{text:'한국'}]]
 }};
 const prompt='INSTRUCTIONS\n'+JSON.stringify({format:'shared-pools-v4',batch_id:backup.requestId,
  sentences:routing.map(r=>({sentence_id:r.sentenceId,text:'한국'})),
  targets:[
   {target_id:'t0',sentence_id:'f0_s0',options:{c0:'p0'}},
   {target_id:'t1',sentence_id:'f3_s0',options:{c0:'p0'}}],
  candidates:[{candidate_id:'p0',replacement:'韓國'}]});
 const response={batch_id:backup.requestId,results:[{t:'t0',c:'c0'}],
  repairs:[{sentence_id:'f3_s0',op:'delete',old_target_ids:['t1'],start:0,end:2,surface:'한국'}]};
 const parts=partitionMergedManualRecovery(routing,smartBackup,response,prompt);
 assert.equal(parts.length,2);
 const child=parts.find(p=>p.frameId===3);
 assert.equal(JSON.parse(child.answer).repairs[0].sentence_id,'p0');
 assert.deepEqual(child.backup.repairValidation.scopes,[['p0',{text:'한국'}]]);
 assert.equal(child.backup.repairValidation.targets[0].repair_sentence_key,'p0');
 const parsed=JSON.parse(child.originalPrompt.slice(child.originalPrompt.indexOf('{"format":')));
 assert.deepEqual(parsed.targets.map(t=>t.target_id),['t1']);
 assert.deepEqual(parsed.sentences.map(t=>t.sentence_id),['p0']);
 assert.throws(()=>partitionMergedManualRecovery(routing,smartBackup,{
  batch_id:backup.requestId,results:[],repairs:[{sentence_id:'f3_s0',old_target_ids:['t0']}]
 },prompt),/不能跨越/);
});

const src=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
const snippet=src.slice(src.indexOf('  function recoverManualConnection'),
 src.indexOf('  // Same input/reading constraints',src.indexOf('  function recoverManualConnection')));

function idleFixture(mergedHost=true){
 const nodes=new Map();
 const panel={dataset:{operationId:'op-main'},querySelector:s=>{
  if(!nodes.has(s))nodes.set(s,{disabled:false,value:'',textContent:''});
  return nodes.get(s);
 }};
 panel.querySelector('.kra-manual-response').value='important late answer';
 let disconnects=0;
 const task={operationId:'op-main',mergedGroup:true,mergedHost,
  mergeGroupId:'frame-group-live',manualFrameRouting:routing,
  manualBackup:mergedHost?backup:undefined,
  manualRequest:mergedHost?backup.requestId:undefined,
  manualPlan:[{requestId:backup.requestId}],port:{disconnect(){disconnects++;}},
  finished:false};
 const c={currentTask:task,document:{querySelector:()=>panel},
  clearTimeout(){},clearInterval(){},status(){},panelStatus(){},chrome:{runtime:{}},
  console,JSON};
 vm.createContext(c);vm.runInContext(snippet,c);
 return {c,task,panel,disconnected:()=>disconnects};
}

test('long idle disconnect keeps the editor actionable and its answer intact',()=>{
 const {c,task,panel,disconnected}=idleFixture();
 panel.querySelector('.kra-manual-apply').disabled=true;
 panel.querySelector('.kra-manual-import').disabled=true;
 assert.equal(c.recoverManualConnection(task,'background suspended'),true);
 assert.equal(task.finished,false);
 assert.equal(task.manualLocalOnly,true);
 assert.equal(task.manualRequest,backup.requestId);
 assert.equal(panel.querySelector('.kra-manual-apply').disabled,false);
 assert.equal(panel.querySelector('.kra-manual-import').disabled,false);
 assert.equal(panel.querySelector('.kra-manual-response').value,'important late answer');
 assert.equal(disconnected(),1);
});

test('child frame retains its DOM during idle worker disconnection',()=>{
 const {c,task}=idleFixture(false);
 task.manualFrameStandby=true;
 assert.equal(c.recoverManualConnection(task,'worker asleep'),true);
 assert.equal(task.manualLocalOnly,true);
 assert.equal(task.finished,false);
});

test('do not offer a phantom offline apply if frame routing was never recorded',()=>{
 const {c,task,panel}=idleFixture();
 task.manualFrameRouting=null;
 assert.equal(c.recoverManualConnection(task,'lost'),false);
 assert.equal(task.manualLocalOnly,undefined);
 assert.equal(panel.querySelector('.kra-manual-response').value,'important late answer');
});

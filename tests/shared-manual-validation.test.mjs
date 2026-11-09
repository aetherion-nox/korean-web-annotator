import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateChoices} from '../choice-review.js';
import {validateGeneratedSegmentsRow,diagnoseGeneratedRow} from '../model-origin.js';
import {createManualReviewSession} from '../manual-review.js';
const core=globalThis.KRA_REVIEW_VALIDATION_CORE;
const flags={allowModelSegmentation:true,allowModelHanja:true,allowModelLoanword:true};
const modes={hanja:true,loanword:true};
const keep=s=>({choice_id:'KEEP',type:'keep',replacement:s,entry_id:null,definitions:[]});
const segmentation=(id,surface,component_candidates=[],morphology=[])=>({
 target_id:id,segmentation_review:true,options:[keep(surface)],surface,component_candidates,morphology
});
const binding=t=>({target_id:t.target_id,start:10,end:10+t.surface.length,surface:t.surface,
 segmentationReview:true,generatedChoices:['GEN_SEGMENTS'],
 componentCandidates:t.component_candidates,morphology:t.morphology,choices:[{choice_id:'KEEP',annotations:[]}]
});
const row=(id,segments,evidence)=>({target_id:id,choice_id:'GEN_SEGMENTS',segments,
 confidence:'high',evidence});
test('real 402-target incident: an identity annotation is losslessly discarded, preserving valid neighbors',()=>{
 const t=segmentation('t0','구독안내지면보기종합신문');
 const answer=row('t0',[
 {start:0,end:2,surface:'구독',type:'hanja',replacement:'購讀'},
 {start:2,end:4,surface:'안내',type:'hanja',replacement:'案內'},
 {start:4,end:6,surface:'지면',type:'hanja',replacement:'紙面'},
 {start:6,end:8,surface:'보기',type:'hanja',replacement:'보기'}
 ],'Dictionary-supported origin where available, leave native words alone.');
 const worker=validateGeneratedSegmentsRow(t,answer,flags);
 const browser=core.validateBindingRow(binding(t),answer,modes);
 assert.ok(worker);assert.equal(worker.segments.length,3);
 assert.equal(worker.replacement,'購讀案內紙面보기종합신문');
 assert.equal(browser.ok,true);assert.equal(browser.normalizedRow.segments.length,3);
 assert.deepEqual(browser.value.annotations.map(a=>a.replacement),['購讀','案內','紙面']);
 assert.equal(validateChoices([t],{results:[answer]},flags).accepted.length,1);
});
test('single-syllable nominal modifier with ETM can end an uninflected compound',()=>{
 const c={start:2,end:3,surface:'색',options:[keep('색'),
 {choice_id:'c2',entry_id:442270,type:'hanja',replacement:'色',written_form:'색',definitions:['빛깔.']}]};
 const t=segmentation('t157','붉은색',[c],[
  {start:0,end:1,form:'붉',tag:'VA'},
  {start:1,end:2,form:'은',tag:'ETM'},
  {start:2,end:3,form:'색',tag:'NNG'}
 ]);
 const answer=row('t157',[{start:2,end:3,surface:'색',type:'hanja',replacement:'色'}],
 'Dictionary noun 色 with attributive ETM preceding it.');
 assert.equal(validateGeneratedSegmentsRow(t,answer,flags)?.replacement,'붉은色');
 assert.equal(core.validateBindingRow(binding(t),answer,modes).ok,true);
});
test('do not infer an isolated homophone without matching dictionary and grammar',()=>{
 const t=segmentation('t157','붉은색',[],[
  {start:0,end:1,form:'붉',tag:'VA'},
  {start:1,end:2,form:'은',tag:'ETM'},
  {start:2,end:3,form:'색',tag:'NNG'}
 ]);
 const answer=row('t157',[{start:2,end:3,surface:'색',type:'hanja',replacement:'色'}],
 'Model suggests an origin, but dictionary did not attest.');
 assert.equal(core.validateBindingRow(binding(t),answer,modes).code,'ISOLATED_SYLLABLE');
 assert.equal(validateGeneratedSegmentsRow(t,answer,flags),null);
});
test('model explanation asserting a different full original spelling is rejected, never silently applied',()=>{
 const t=segmentation('t384','중의병원');
 const answer=row('t384',[
  {start:0,end:1,surface:'중',type:'hanja',replacement:'中'},
  {start:2,end:4,surface:'병원',type:'hanja',replacement:'病院'}
 ],'중의병원(中醫院)은 확립된 기관 명칭.');
 const checked=core.validateBindingRow(binding(t),answer,modes);
 assert.equal(checked.code,'EVIDENCE_CONTRADICTION');
 assert.equal(diagnoseGeneratedRow(t,answer,flags).code,'EVIDENCE_CONTRADICTION');
});
test('invalid model character is rejected per target but is not confused with wrong ID',()=>{
 const t=segmentation('t0','보기');
 const answer=row('t0',[{start:0,end:2,surface:'보기',type:'hanja',replacement:'보경'}],
 'Source is not a Sino-Korean word.');
 assert.equal(core.validateBindingRow(binding(t),answer,modes).code,'HANJA_ALIGNMENT');
 assert.equal(diagnoseGeneratedRow(t,answer,flags).code,'HANJA_ALIGNMENT');
});
test('shared verifier produces consistent 402-row manual snapshot with only one necessary repair',async()=>{
 const entries=Array.from({length:402},(_,i)=>segmentation('t'+i,'학교'));
 entries[0]=segmentation('t0','구독안내지면보기종합신문');
 entries[157]=segmentation('t157','붉은색',[{start:2,end:3,surface:'색',options:[
  {choice_id:'c2',entry_id:442270,type:'hanja',replacement:'色',written_form:'색'}]}],[
   {start:0,end:1,form:'붉',tag:'VA'},{start:1,end:2,form:'은',tag:'ETM'},{start:2,end:3,form:'색',tag:'NNG'}]);
 entries[384]=segmentation('t384','중의병원');
 const events=[],session=createManualReviewSession({operationId:'full',post:e=>events.push(e)});
 const pending=session.request({context:'article',...flags},entries);
 const request=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 const rows=entries.map(e=>({target_id:e.target_id,choice_id:'KEEP'}));
 rows[0]=row('t0',[
  {start:0,end:2,surface:'구독',type:'hanja',replacement:'購讀'},
  {start:6,end:8,surface:'보기',type:'hanja',replacement:'보기'}],
  'Known vocabulary and no-op native suffix.');
 rows[157]=row('t157',[{start:2,end:3,surface:'색',type:'hanja',replacement:'色'}],
  'Dictionary and nominal syntax match.');
 rows[384]=row('t384',[
  {start:0,end:1,surface:'중',type:'hanja',replacement:'中'},
  {start:2,end:4,surface:'병원',type:'hanja',replacement:'病院'}],
  '중의병원(中醫院) is the full origin.');
 const answer=JSON.stringify({batch_id:request.requestId,results:rows});
 assert.equal(session.submit({operationId:'full',requestId:request.requestId,text:answer}),false);
 const error=events.at(-1);
 assert.deepEqual(error.invalidTargetIds,['t384']);
 assert.equal(error.acceptedCount,401);
 assert.equal(error.acceptedRows.find(r=>r.target_id==='t0').segments.length,1);
 assert.deepEqual(error.acceptedRows.find(r=>r.target_id==='t157').segments[0].replacement,'色');
 assert.match(error.error,/EVIDENCE_CONTRADICTION/);
 assert.match(error.repairPrompt,/"target_id":"t384"/);
 const patch={batch_id:request.requestId,results:[{target_id:'t384',choice_id:'KEEP'}]};
 assert.equal(session.submit({operationId:'full',requestId:request.requestId,text:JSON.stringify(patch)}),true);
 const resolved=await pending;
 assert.equal(resolved.results.length,402);
 assert.equal(resolved.results[0].choice_id,'GEN_SEGMENTS');
 assert.equal(Object.hasOwn(resolved.results[0],'replacement'),false);
});
test('DOM link and list boundaries are inserted without changing text-node coordinate consistency',()=>{
 const s=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
 const a=s.indexOf('  function sourceOf(element) {'),b=s.indexOf('  function pageIdentity()',a);
 const sandbox={OWN_RUBY:'ruby[kra-annotated="true"]'};vm.createContext(sandbox);
 vm.runInContext(s.slice(a,b),sandbox);
 const txt=data=>({nodeType:3,data});
 const el=(tag,...children)=>({nodeType:1,childNodes:children,tagName:tag.toUpperCase(),
  matches(selector){return selector.split(',').includes(tag);},
  get textContent(){return children.map(c=>c.nodeType===3?c.data:c.textContent).join('');}
 });
 const first=txt('구독'),second=txt('안내'),third=txt('지면');
 const root=el('div',el('a',first),el('a',second),el('li',third));
 const result=sandbox.sourceOf(root);
 assert.equal(result.text,'구독\n안내\n지면');
 assert.deepEqual(result.runs.map(r=>[r.start,r.end]),[[0,2],[3,5],[6,8]]);
});

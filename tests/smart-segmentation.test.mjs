import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewPayload,buildReviewInstructions,buildManualPrompt} from '../review-payload.js';
import {validateSegmentationRepairs} from '../segmentation-repairs.js';
import {runSentencePipeline} from '../annotation-pipeline.js';
import {createManualReviewSession} from '../manual-review.js';
import {choicePreviewParser} from '../model-stream.js';
import {contextReviewBatches} from '../batch-budget.js';

const keep=s=>({choice_id:'KEEP',type:'keep',replacement:s,entry_id:null,definitions:[]});
const target=(id,text,start,end,choice='可')=>({
 target_id:id,original_target_id:id,repair_sentence_key:'sentence1',context:text,
 start,end,surface:text.slice(start,end),
 repair_context:{kiwi_tokens:[],protected_ranges:[]},
 options:[keep(text.slice(start,end)),{choice_id:'c0',type:'hanja',replacement:choice,
   entry_id:1,definitions:['a lexical sense']}]
});
const row=(sentence_id,op,old_target_ids,start,end,surface,choice_id)=>({
 sentence_id,op,old_target_ids,start,end,surface,choice_id
});
function fixture(text,targets,opts={}){
 const scopes=new Map(targets.map(t=>[t.target_id,{
  text,allTargets:targets.filter(x=>!x.scan_only),localAnnotations:opts.localAnnotations||[],
  protected_ranges:opts.protected_ranges||[],selected:opts.selected||null,
  existingRepairs:opts.existingRepairs||[]
 }]));
 const config={context:text,smartSegmentation:true,reviewPosFilter:false,
  repairModes:{hanja:true,loanword:true},repairScopes:scopes};
 const wire=buildReviewPayload(text,targets,config).payload;
 return {config,targets,sid:wire.sentences[0].sentence_id};
}
const validate=(f,repairs)=>validateSegmentationRepairs(f.targets,{results:[],repairs},f.config);

test('wrong Kiwi split: merge two old targets into one reliable Hanja span',()=>{
 const text='이산화탄소',f=fixture(text,[target('t0',text,0,3,'二酸化'),target('t1',text,3,5,'炭素')]);
 const r=validate(f,[row(f.sid,'replace',['t0','t1'],0,5,text,'二酸化炭素')]);
 assert.equal(r.rejected.length,0);
 assert.equal(r.accepted.length,1);
 assert.deepEqual(r.accepted[0].source_target_ids,['t0','t1']);
 assert.deepEqual(r.accepted[0].annotations.map(a=>[a.start,a.end,a.replacement]),[[0,5,'二酸化炭素']]);
});

test('wrong merged target: split it into independently checked nonoverlapping replacements',()=>{
 const text='과학기술',f=fixture(text,[target('t0',text,0,4,'科學技術')]);
 const r=validate(f,[row(f.sid,'replace',['t0'],0,2,'과학','科學'),
  row(f.sid,'replace',['t0'],2,4,'기술','技術')]);
 assert.equal(r.rejected.length,0);assert.equal(r.accepted.length,2);
 assert.deepEqual(r.accepted.flatMap(x=>x.annotations.map(a=>a.replacement)),['科學','技術']);
});

test('source spaces remain untouched in a cross-space boundary repair',()=>{
 const text='한국 정부',f=fixture(text,[target('t0',text,0,text.length,'韓國 政府')]);
 const r=validate(f,[row(f.sid,'replace',['t0'],0,2,'한국','韓國'),
  row(f.sid,'replace',['t0'],3,5,'정부','政府')]);
 assert.equal(r.rejected.length,0);
 assert.deepEqual(r.accepted.flatMap(x=>x.annotations.map(a=>[a.start,a.end,a.replacement])),
  [[0,2,'韓國'],[3,5,'政府']]);
 const invalid=validate(f,[row(f.sid,'replace',['t0'],0,5,text,'韓國政府')]);
 assert.equal(invalid.accepted.length,1,'a complete phrase with source-preserving space is also possible');
 assert.deepEqual(invalid.accepted[0].annotations.map(a=>a.replacement),['韓國','政府']);
});

test('wrong POS does not prevent repair, but protected proper names are never invented',()=>{
 const text='게임',t={...target('t0',text,0,2,'可'),morphology:[{tag:'NNP',form:text,start:0,end:2}]};
 const f=fixture(text,[t]);
 assert.equal(validate(f,[row(f.sid,'replace',['t0'],0,2,text,'game')]).accepted.length,1);
 const name=fixture(text,[t],{protected_ranges:[[0,2]]});
 assert.equal(validate(name,[row(name.sid,'replace',['t0'],0,2,text,'game')]).accepted.length,0);
 assert.equal(validate(name,[row(name.sid,'replace',['t0'],0,2,text,'KEEP')]).accepted.length,1);
});

test('omitted word with no existing target can be added in a one-pass scan-only sentence',()=>{
 const text='게임',scan={...target('scan',text,0,text.length),scan_only:true,options:[keep(text)]};
 const f=fixture(text,[scan]);
 const r=validate(f,[row(f.sid,'add',[],0,2,text,'game')]);
 assert.equal(r.accepted.length,1);assert.equal(r.accepted[0].annotations[0].replacement,'game');
 assert.equal(validate(f,[row(f.sid,'replace',['scan'],0,2,text,'game')]).accepted.length,0);
 const unknown=validate(f,[row(f.sid,'add',[],0,2,text,'KEEP')]);
 assert.equal(unknown.accepted.length,0,'native text must not be added as an artificial KEEP repair');
});

test('a dictionary flagged as a person cannot be re-originated but can be kept',()=>{
 const text='이수민',t={...target('t0',text,0,3,'李壽民'),dictionary_person_name:true};
 const f=fixture(text,[t],{protected_ranges:[]});
 assert.equal(validate(f,[row(f.sid,'replace',['t0'],0,3,text,'李壽民')]).accepted.length,0);
 assert.equal(validate(f,[row(f.sid,'replace',['t0'],0,3,text,'KEEP')]).accepted.length,1);
});

test('repaired Hanja stems may retain exact unchanged Korean endings but may not fabricate them',()=>{
 const text='가나다',f=fixture(text,[target('t0',text,0,3,'可那多')]);
 const good=validate(f,[row(f.sid,'replace',['t0'],0,3,text,'可那다')]);
 assert.equal(good.accepted.length,1);
 assert.deepEqual(good.accepted[0].annotations.map(a=>[a.start,a.end,a.surface,a.replacement]),
  [[0,2,'가나','可那']]);
 assert.equal(validate(f,[row(f.sid,'replace',['t0'],0,3,text,'可那라')]).accepted.length,0);
});

test('delete and KEEP may safely suppress malformed spans containing punctuation',()=>{
 const text='한국, 정부',f=fixture(text,[target('t0',text,0,text.length,'韓國政府')]);
 const deleted=validate(f,[row(f.sid,'delete',['t0'],0,text.length,text,'KEEP')]);
 assert.equal(deleted.accepted.length,1);
 assert.deepEqual(deleted.accepted[0].annotations,[]);
 const keep=validate(f,[row(f.sid,'replace',['t0'],0,text.length,text,'KEEP')]);
 assert.equal(keep.accepted.length,1);
 const unsafe=validate(f,[row(f.sid,'replace',['t0'],0,text.length,text,'韓國政府')]);
 assert.equal(unsafe.accepted.length,0);
});

test('UTF-16 source indices, wrong offsets, missing/duplicate IDs and unsafe formats fail individually',()=>{
 const text='😀게임',f=fixture(text,[{...target('scan',text,0,text.length),scan_only:true,options:[keep(text)]}]);
 const good=row(f.sid,'add',[],2,4,'게임','game');
 const repaired=validate(f,[row(f.sid,'add',[],1,3,'게임','game')]);
 assert.equal(repaired.accepted.length,1,'unique nearby UTF16 offset should be corrected');
 assert.equal(repaired.accepted[0].offset_corrected,true);
 const invalid=[
  row('other','add',[],2,4,'게임','game'),
  row(f.sid,'replace',['unlisted'],2,4,'게임','game'),
  {...good,extra:true},
  row(f.sid,'delete',[],2,4,'게임','KEEP'),
  row(f.sid,'add',[],2,4,'게임','word😀'),
 ];
 const result=validate(f,[...invalid,good]);
 assert.equal(result.accepted.length,1);
 assert.equal(result.rejected.length,invalid.length);
 assert.equal(result.accepted[0].annotations[0].start,2);
});

test('conflicting overlapping repairs reject both and keep old normal target decisions intact',()=>{
 const text='과학기술',f=fixture(text,[target('t0',text,0,4,'科學技術')]);
 const r=validate(f,[row(f.sid,'replace',['t0'],0,3,'과학기','科學技'),
  row(f.sid,'replace',['t0'],1,4,'학기술','學技術')]);
 assert.equal(r.accepted.length,0);assert.equal(r.rejected.length,2);
 const malformed=validate(f,[row(f.sid,'replace',['t0'],0,2,'과학','科學'),
  row(f.sid,'replace',['t0'],2,4,'기술','invalid😀')]);
 assert.equal(malformed.accepted.length,0,'bad split sibling cannot discard original target');
 const deleteReplace=validate(f,[row(f.sid,'delete',['t0'],0,4,text,'KEEP'),
  row(f.sid,'replace',['t0'],0,2,'과학','科學')]);
 assert.equal(deleteReplace.accepted.length,0);
});

test('cannot overlap a different target, a locally certain annotation, or a prior repair',()=>{
 const text='이산화탄소',targets=[target('t0',text,0,3,'二酸化'),target('t1',text,3,5,'炭素')];
 let f=fixture(text,targets);
 assert.equal(validate(f,[row(f.sid,'add',[],2,5,'화탄소','化炭素')]).accepted.length,0);
 f=fixture(text,[target('scan',text,0,5,'二酸化炭素')],{localAnnotations:[{start:0,end:3,surface:'이산화',replacement:'二酸化'}]});
 assert.equal(validate(f,[row(f.sid,'add',[],0,5,text,'二酸化炭素')]).accepted.length,0);
 f=fixture(text,targets,{existingRepairs:[{start:0,end:3,old_target_ids:['t0']}]});
 assert.equal(validate(f,[row(f.sid,'replace',['t0'],0,3,'이산화','二酸化')]).accepted.length,0);
});

test('selected text confinement, person-names and no second lookup for repaired terms',()=>{
 const text='가나다나마바사',f=fixture(text,[{...target('scan',text,0,7,'可'),scan_only:true,options:[keep(text)]}],{selected:[{start:2,end:5}]});
 assert.equal(validate(f,[row(f.sid,'add',[],0,2,'가나','可那')]).accepted.length,0);
 assert.equal(validate(f,[row(f.sid,'add',[],2,4,'다나','多羅')]).accepted.length,1);
 const f2=fixture(text,[{...target('scan',text,0,7,'可'),scan_only:true,options:[keep(text)]}],{protected_ranges:[[2,4]]});
 assert.equal(validate(f2,[row(f2.sid,'add',[],2,4,'다라','多羅')]).accepted.length,0);
 assert.equal(validate(f2,[row(f2.sid,'add',[],2,4,'다나','KEEP')]).accepted.length,0);
});

test('a partial split safely retires the old target while leaving unmatched native text in Korean',()=>{
 const text='과학기술',f=fixture(text,[target('t0',text,0,4,'科學技術')]);
 const partial=validate(f,[row(f.sid,'replace',['t0'],0,2,'과학','科學')]);
 assert.equal(partial.accepted.length,1);
 assert.deepEqual(partial.accepted[0].annotations.map(a=>a.replacement),['科學']);
 const complete=validate(f,[row(f.sid,'replace',['t0'],0,2,'과학','科學'),
  row(f.sid,'replace',['t0'],2,4,'기술','KEEP')]);
 assert.equal(complete.accepted.length,2);
 assert.deepEqual(complete.accepted.flatMap(r=>r.annotations.map(a=>a.replacement)),['科學']);
});

test('KEEP cannot consume unrelated text outside referenced old target',()=>{
 const text='한국 정부',f=fixture(text,[target('t0',text,0,2,'韓國')]);
 assert.equal(validate(f,[row(f.sid,'replace',['t0'],0,5,text,'KEEP')]).accepted.length,0);
 assert.equal(validate(f,[row(f.sid,'delete',['t0'],0,2,'한국','KEEP')]).accepted.length,1);
});

test('nearby offset correction accepts only unique source substring',()=>{
 const text='가 가',t={...target('scan',text,0,text.length),scan_only:true,options:[keep(text)]};
 const f=fixture(text,[t]);
 assert.equal(validate(f,[row(f.sid,'add',[],1,2,'가','可')]).accepted.length,0);
 const selected=validate(f,[row(f.sid,'add',[],2,3,'가','可')]);
 assert.equal(selected.accepted.length,1,'an exact offset remains valid even when the surface occurs elsewhere');
});

test('more than 48 repairs preserves the safe prefix rather than discarding the batch',()=>{
 const text='가'.repeat(49),scan={...target('scan',text,0,text.length),scan_only:true,options:[keep(text)]};
 const f=fixture(text,[scan]);
 const rows=Array.from({length:49},(_,i)=>row(f.sid,'add',[],i,i+1,'가','可'));
 const result=validate(f,rows);
 assert.equal(result.accepted.length,48);
 assert.equal(result.rejected.length,1);
 assert.equal(result.rejected[0].index,48);
});

test('repair Hanja is checked phonetically but ordinary dictionary choices stay unchanged',()=>{
 const bad=fixture('사과',[target('t0','사과',0,2,'韓國')]);
 assert.equal(validate(bad,[row(bad.sid,'replace',['t0'],0,2,'사과','韓國')]).accepted.length,0);
 const good=fixture('한국',[target('t0','한국',0,2,'韓國')]);
 const resolved=validate(good,[row(good.sid,'replace',['t0'],0,2,'한국','韓國')]);
 assert.equal(resolved.accepted.length,1);
 assert.equal(resolved.accepted[0].annotations[0].origin_source,'model-unverified');
});

test('the feature toggle controls prompt and input without enabling ordinary experimental modes',()=>{
 const text='게임',t=target('t0',text,0,2);
 const off=buildReviewPayload(text,[t],{}).payload;
 const on=buildReviewPayload(text,[t],{smartSegmentation:true}).payload;
 assert.equal(off.sentences[0].kiwi_tokens,undefined);
 assert.deepEqual(on.sentences[0].kiwi_tokens,[]);
 assert.ok(!buildReviewInstructions({}).includes('repairs'));
 assert.ok(buildReviewInstructions({smartSegmentation:true}).includes('Actively audit EVERY original sentence'));
 assert.ok(buildReviewInstructions({smartSegmentation:true}).includes('You SHOULD submit repairs for EVERY genuine, well-supported'));
 assert.ok(buildReviewInstructions({smartSegmentation:true}).includes('Never invent repairs to reach a quota'));
 assert.ok(buildReviewInstructions({smartSegmentation:true}).includes('plus optional repairs'));
 assert.ok(!buildReviewInstructions({smartSegmentation:true}).includes('no explanations or extra fields'));
 assert.ok(!buildReviewInstructions({}).includes('Actively audit EVERY original sentence'));
 assert.ok(!buildReviewInstructions({}).includes('you SHOULD write that origin'));
 assert.ok(!buildReviewInstructions({smartSegmentation:true}).includes('genuine Hanja spelling'));
 assert.ok(buildManualPrompt(text,[t],'batch',{smartSegmentation:true}).includes('repairs'));
 assert.ok(!buildManualPrompt(text,[t],'batch',{}).includes('repairs'));
 const combined=buildReviewInstructions({smartSegmentation:true,experimentalHanja:true,experimentalLoanword:true});
 assert.ok(combined.includes('Actively audit EVERY original sentence'));
 assert.ok(combined.includes('THIRD, if NO supplied dictionary option correctly represents'));
 assert.ok(combined.includes('DIRECTLY into results[].choice_id'));
 assert.equal((combined.match(/You SHOULD submit repairs/g)||[]).length,1);
 assert.equal((combined.match(/FIRST infer its meaning/g)||[]).length,1);
});

test('manual mode returns normal target choices and repairs in a single response',async()=>{
 const text='게임',t=target('local',text,0,2,'可'),events=[];
 const session=createManualReviewSession({operationId:'manual-repair',post:x=>events.push(x)});
 const f=fixture(text,[t]);
 const awaiting=session.request(f.config,[t]);
 const request=events.find(e=>e.type==='MANUAL_REVIEW_REQUEST');
 const message={batch_id:request.requestId,results:[{target_id:'t0',choice_id:'c0'}],
  repairs:[row('s0','replace',['t0'],0,2,text,'game')]};
 assert.equal(session.submit({operationId:'manual-repair',requestId:request.requestId,text:JSON.stringify(message)}),true);
 const resolved=await awaiting;
 assert.deepEqual(resolved.results,[],'a validated repair supersedes the old dictionary choice');
 assert.equal(resolved.repairs[0].old_target_ids[0],'local');
 assert.equal(events.filter(e=>e.type==='MANUAL_REVIEW_REQUEST').length,1);
});

test('pipeline uses exactly one model call and valid repair supersedes old dictionary result',async()=>{
 const text='게임',t=target('local0',text,0,2,'可伊'),events=[],calls=[];
 const identity={engine_version:'repair-fixture',dictionary_fingerprint:'dict'};
 const result=await runSentencePipeline({operationId:'smart-one',sentences:[{id:'s1',text}],
  modes:{hanja:true,loanword:true},smartSegmentation:true},event=>events.push(event),{
  enabled:true,cache:new Map(),status:async()=>identity,
  analyze:async(_text,modes)=>{assert.equal(modes.smartSegmentation,true);return {...identity,annotations:[],targets:[t],
    repair_context:{kiwi_tokens:[],protected_ranges:[]},stats:{pending:1}};},
  modelConfig:async()=>({smartSegmentation:true,batchContextTier:'32k',model:'fixture',endpoint:'fixture://model',
   request:async(config,rows)=>{calls.push(rows);return {results:[{target_id:rows[0].target_id,choice_id:'c0'}],
    repairs:[row('s0','replace',[rows[0].target_id],0,2,text,'game')]};}})
 });
 assert.equal(calls.length,1);
 assert.equal(result.repair_applied,1,JSON.stringify(events.filter(e=>e.type==='DIAGNOSTIC').map(e=>e.diagnostic)));
 const final=events.filter(e=>e.type==='RESULTS'&&e.source==='model').at(-1).results[0];
 assert.deepEqual(final.annotations.map(a=>a.replacement),['game']);
 assert.deepEqual(final.reviewed.map(r=>r.surface),[text,text]);
});

test('pipeline can inspect a whole Hangul sentence even if local dictionary produced zero targets',async()=>{
 const text='게임',events=[],identity={engine_version:'engine',dictionary_fingerprint:'dict'};
 let calls=0;
 await runSentencePipeline({operationId:'scan-only',sentences:[{id:'s',text}],modes:{loanword:true},
  smartSegmentation:true},e=>events.push(e),{
  enabled:true,cache:new Map(),status:async()=>identity,
  analyze:async()=>({...identity,annotations:[],targets:[],repair_context:{kiwi_tokens:[],protected_ranges:[]},stats:{pending:0}}),
  modelConfig:async()=>({smartSegmentation:true,model:'fixture',endpoint:'fixture://model',
   request:async(_,rows)=>{calls++;assert.equal(rows[0].scan_only,true);return {
    results:[{target_id:rows[0].target_id,choice_id:'KEEP'}],
    repairs:[row('s0','add',[],0,2,text,'game')]
   };}})
 });
 assert.equal(calls,1);
 const final=events.filter(e=>e.type==='RESULTS'&&e.source==='model').at(-1).results[0];
 assert.equal(final.annotations[0].replacement,'game');
});

test('invalid repair does not invalidate a normal choice or cause a second model request',async()=>{
 const text='학교',t=target('local',text,0,2,'學校'),identity={engine_version:'v',dictionary_fingerprint:'d'};
 let calls=0,events=[];
 const stats=await runSentencePipeline({operationId:'invalid-repair',sentences:[{id:'s',text}],
  modes:{hanja:true},smartSegmentation:true},e=>events.push(e),{
  enabled:true,cache:new Map(),status:async()=>identity,
  analyze:async()=>({...identity,targets:[t],annotations:[],repair_context:{kiwi_tokens:[],protected_ranges:[]},stats:{pending:1}}),
  modelConfig:async()=>({smartSegmentation:true,model:'fixture',endpoint:'fixture://model',
   request:async(_,rows)=>{calls++;return {results:[{target_id:rows[0].target_id,choice_id:'c0'}],
     repairs:[row('s999','add',[],0,2,text,'學校')]};}})
 });
 assert.equal(calls,1);
 assert.equal(stats.repair_rejected,1);
 assert.deepEqual(events.filter(e=>e.type==='RESULTS'&&e.source==='model').at(-1).results[0].annotations.map(a=>a.replacement),['學校']);
 assert.ok(events.some(e=>e.type==='DIAGNOSTIC'&&e.diagnostic.stage==='segmentation'&&e.diagnostic.level==='warning'));
});

test('streaming parser does not apply incomplete repair data as a visible annotation',()=>{
 const text='게임',t=target('t0',text,0,2),snapshots=[];
 const parser=choicePreviewParser([t],rows=>snapshots.push(rows.map(a=>a.option.choice_id)));
 const content='{"results":[{"target_id":"t0","choice_id":"KEEP"}],"repairs":[{"sentence_id":"s0"';
 parser(content.slice(0,24));assert.equal(snapshots.length,0);
 parser(content.slice(24));
 assert.deepEqual(snapshots.at(-1),['KEEP']);
 // A partial repair is never parsed into DOM edits: only completed JSON is
 // passed through the independent repair validator.
 const f=fixture(text,[t]);
 assert.equal(validate(f,[{sentence_id:f.sid}]).accepted.length,0);
});

test('batch packing retains configured context tiers with repair mode enabled',()=>{
 const text='학교',t=target('t0',text,0,2,'學校');
 const [batch]=contextReviewBatches([{result:{unresolved:[t]}}],text,{tier:'32k',smartSegmentation:true});
 assert.equal(batch.budget.label,'32K');
 assert.ok(batch.budget.inputTokens>0&&batch.budget.outputTokens>0);
 assert.ok(batch.budget.totalTokens<=32000);
});

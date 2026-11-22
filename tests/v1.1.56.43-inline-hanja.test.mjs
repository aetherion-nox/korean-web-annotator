import test from 'node:test';
import assert from 'node:assert/strict';
import {extractInlineHanjaPairs,applyInlineHanjaAnnotations} from '../inline-hanja-evidence.js';
import {runSentencePipeline} from '../annotation-pipeline.js';

const keep=surface=>({choice_id:null,type:'keep',entry_id:null,replacement:surface,definitions:[]});
const choice=(surface,hanja,id=3)=>({choice_id:'c0',type:'hanja',entry_id:id,replacement:hanja,definitions:['dictionary']});
const target=(text,surface,start,hanja)=>({target_id:'t0',start,end:start+surface.length,surface,context:text,options:[keep(surface),choice(surface,hanja)]});
const analysis=(text,targets=[],annotations=[])=>({
 engine_version:'fixture',dictionary_fingerprint:'fixture',
 annotations,targets,stats:{local_determined:annotations.length,pending:targets.length}
});

test('explicit quoted and bare Hangul(漢字) pairs match, preserving compatibility glyphs',()=>{
 const text='‘사주정설’(四柱精說)과 백영관(白靈觀)';
 const pairs=extractInlineHanjaPairs(text);
 assert.deepEqual(pairs.map(p=>[p.surface,p.hanja]),[
  ['사주정설','四柱精說'],['백영관','白靈觀']]);
 assert.ok(pairs[0].citation.includes('四柱精說'));
 assert.ok(pairs[1].citation.includes('白靈觀'));
 assert.equal(pairs[0].start,text.indexOf('사주정설'));
});

test('accept a short stretch of parentheses, punctuation, quotes and horizontal whitespace',()=>{
 for(const text of [
  '백영관】 (白靈觀)',
  '『백영관』 ：(白靈觀)',
  '백영관 [ ] : (白靈觀)',
  '백영관  ——  (白靈觀)',
  '‘사주정설’[ ]（四柱精說）',
  '백영관,(白靈觀)'
 ]){
  const pairs=extractInlineHanjaPairs(text);
  assert.equal(pairs.length,1,text);
 }
});

test('do not cross words, longer punctuation gaps, lines, full stops or differently formatted brackets',()=>{
 for(const text of [
  '백영관 즉 (白靈觀)',
  '백영관(가칭) (白靈觀)',
  '백영관 123 (白靈觀)',
  '백영관................(白靈觀)',
  '백영관'+'\u3000'.repeat(20)+'(白靈觀)',
  '백영관\n(白靈觀)',
  '백영관. (白靈觀)',
  '영발’(靈發: spiritual power)',
  '백영관(白靈觀: spirit)',
  '백영관(白靈觀)',
  '사주정설(四柱精)',
  '사주정설(四柱精說)',
  '백영관(白靈觀）',
  '백영관（白靈觀)',
  '백영관(Tesla)',
  '백영관(白靈觀 ABC)'
 ]){
  const pairs=extractInlineHanjaPairs(text);
  // The exact pair is intentionally valid, other lines are invalid.
  const allowed=['백영관(白靈觀)','사주정설(四柱精說)',
   // v1.1.56.46 accepts a leading Hanja run followed by a note.
   '영발’(靈發: spiritual power)','백영관(白靈觀: spirit)','백영관(白靈觀 ABC)'];
  assert.equal(pairs.length,allowed.includes(text)?1:0,text);
 }
});

test('pure Hanja pair becomes local annotation and removes a same-span model target',()=>{
 const text='‘사주정설’(四柱精說)과 백영관(白靈觀)';
 const at=text.indexOf('사주정설'),t=target(text,'사주정설',at,'四柱政說');
 const updated=applyInlineHanjaAnnotations(text,analysis(text,[t]));
 assert.equal(updated.stats.converted,2);
 assert.equal(updated.stats.removedTargets,1);
 assert.equal(updated.analysis.targets.length,0);
 assert.equal(updated.analysis.annotations.length,2);
 assert.deepEqual(updated.analysis.annotations.map(a=>a.replacement),['四柱精說','白靈觀']);
 assert.ok(updated.analysis.annotations.every(a=>text.slice(a.start,a.end)===a.surface));
 assert.ok(updated.analysis.annotations.every(a=>a.evidence_source==='inline_hanja_parentheses'));
 assert.ok(text.includes('(四柱精說)'),"original article's Hanja remains untouched");
});

test('different or overlapping larger targets are preserved rather than erased',()=>{
 const text='백영관(白靈觀)';
 const overlapping=target(text,'백영관(',0,'白靈觀(');
 const before=analysis(text,[overlapping]);
 const changed=applyInlineHanjaAnnotations(text,before);
 assert.equal(changed.stats.skipped,1);
 assert.equal(changed.stats.converted,0);
 assert.equal(changed.analysis.targets[0],overlapping);
});

test('selected review covers original Hangul only; excludes truncated selection',()=>{
 const text='백영관(白靈觀)';
 const full=applyInlineHanjaAnnotations(text,analysis(text),{selected:[{start:0,end:3}]});
 assert.equal(full.stats.converted,1);
 const partial=applyInlineHanjaAnnotations(text,analysis(text),{selected:[{start:1,end:3}]});
 assert.equal(partial.stats.converted,0);
});

test('citation excerpt is bounded even for long article sentences',()=>{
 const text='주변의 맥락 '.repeat(200)+'백영관(白靈觀)'+' 이후의 설명'.repeat(200);
 const pairs=extractInlineHanjaPairs(text);
 assert.equal(pairs.length,1);
 assert.ok(pairs[0].citation.includes('백영관(白靈觀)'));
 assert.ok(pairs[0].citation.length<=182);
});

test('offline conversion works without a model API; direct Hanja is not sent to LLM',async()=>{
 const text='백영관(白靈觀) 그리고 학교';
 const targetSchool=target(text,'학교',text.indexOf('학교'),'學校');
 const targetB=target(text,'백영관',0,'白靈館');
 targetSchool.target_id='school';
 const events=[],requested=[];
 const identity={engine_version:'fixture',dictionary_fingerprint:'fixture'};
 await runSentencePipeline({operationId:'direct-hanja',sentences:[{id:'p0',text}],
  modes:{hanja:true,loanword:false},progressiveAnnotation:false
 },e=>events.push(e),{
  enabled:true,status:async()=>identity,analyze:async()=>analysis(text,[targetB,targetSchool]),
  modelConfig:async()=>({provider:'fixture',model:'test',endpoint:'https://fixture.test',
   request:async(_,rows)=>{
    requested.push(rows.map(r=>r.surface));
    return {results:rows.map(r=>({t:r.target_id,c:'c0'}))};
   }})
 });
 const local=events.find(e=>e.type==='RESULTS'&&e.source==='local');
 assert.equal(local.results[0].annotations[0].replacement,'白靈觀');
 assert.deepEqual(requested,[['학교']]);
 const done=events.find(e=>e.type==='DONE');
 assert.equal(done.stats.inline_hanja_local_converted,1);
 assert.equal(done.stats.inline_hanja_removed_targets,1);
 assert.equal(done.stats.model_conversion_choices,1);
 assert.equal(done.stats.model_nonconversion,0);
 assert.equal(done.stats.model_projected_fragments,2-1);
});

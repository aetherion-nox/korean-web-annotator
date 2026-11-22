import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSessionHanjaGlossary,applySessionHanjaGlossary} from '../session-hanja-glossary.js';
import {applyInlineHanjaAnnotations} from '../inline-hanja-evidence.js';
import {runSentencePipeline} from '../annotation-pipeline.js';
import {splitText} from '../text-chunks.js';
const keep=s=>({choice_id:null,type:'keep',replacement:s,entry_id:null,definitions:[]});
const candidate=(id,spelling,meaning='original dictionary sense')=>({
 choice_id:id,type:'hanja',replacement:spelling,entry_id:99,definitions:[meaning]
});
const analysis=(text,targets=[],annotations=[])=>({
 engine_version:'fixture',dictionary_fingerprint:'fixture',
 targets,annotations,stats:{pending:targets.length,local_determined:annotations.length}
});
const one=(text,surface,start,options=[])=>({
 target_id:'t0',start,end:start+surface.length,surface,context:text,
 options:[keep(surface),...options]
});
const glossary=(...texts)=>buildSessionHanjaGlossary(
 texts.map((text,i)=>({id:'p'+i,text})),{context:texts.join('\n')});

test('a later author-provided Hanja spelling enriches an earlier same-term occurrence',()=>{
 const g=glossary('백영관을 다시 찾았다.', '그 건물은 백영관(白靈觀)이라고 불렸다.');
 assert.equal(g.terms,1);assert.equal(g.variants,1);assert.equal(g.conflicts,0);
 const earlier='백영관을 다시 찾았다.';
 const res=applySessionHanjaGlossary(earlier,analysis(earlier),g);
 assert.equal(res.stats.newTargets,1);
 assert.equal(res.stats.newChoices,1);
 const [target]=res.analysis.targets;
 assert.equal(target.surface,'백영관');
 assert.equal(target.start,0);assert.equal(target.end,3);
 assert.deepEqual(target.options.map(o=>o.type),['keep','hanja']);
 assert.equal(target.options[1].replacement,'白靈觀');
 assert.equal(target.options[1].entry_id,'session-inline-hanja:백영관:白靈觀');
 assert.match(target.options[1].definitions[0],/本文汉字括注/);
 assert.match(target.options[1].definitions[0],/백영관\(白靈觀\)/);
 assert.equal(res.analysis.annotations.length,0,'other occurrences require a model choice');
});

test('augment an existing dictionary spelling with citation without erasing its definition or meaning',()=>{
 const text='백영관은 관광객에게 유명하다.',t=one(text,'백영관',0,[
  candidate('c0','白靈觀','existing sense'),candidate('c1','白靈館','other sense')]);
 const g=glossary('백영관(白靈觀)');
 const res=applySessionHanjaGlossary(text,analysis(text,[t]),g);
 assert.equal(res.stats.newChoices,0);
 assert.equal(res.stats.enhancedChoices,1);
 assert.equal(res.analysis.targets.length,1);
 assert.deepEqual(res.analysis.targets[0].options.map(o=>o.choice_id),[null,'c0','c1']);
 assert.deepEqual(res.analysis.targets[0].options[1].definitions[0],'existing sense');
 assert.match(res.analysis.targets[0].options[1].definitions[1],/본문|本文/);
 assert.equal(t.options[1].definitions.length,1,'do not mutate cached engine objects');
});

test('when article conflicts, keep separate candidates for model disambiguation',()=>{
 const text='사주정설이 소개되었다.';
 const g=glossary('‘사주정설’(四柱精說)', '사주정설(四柱正說)');
 assert.equal(g.conflicts,1);assert.equal(g.variants,2);
 const res=applySessionHanjaGlossary(text,analysis(text),g);
 assert.deepEqual(res.analysis.targets[0].options.map(o=>o.replacement),
  ['사주정설','四柱精說','四柱正說']);
 assert.equal(res.analysis.annotations.length,0);
});

test('bracketed source directly converts locally but is never offered to the model again',()=>{
 const text='백영관(白靈觀) 그리고 백영관';
 const direct=applyInlineHanjaAnnotations(text,analysis(text));
 const g=glossary(text);
 const result=applySessionHanjaGlossary(text,direct.analysis,g);
 assert.equal(result.analysis.annotations.length,1);
 assert.equal(result.analysis.annotations[0].replacement,'白靈觀');
 assert.equal(result.analysis.targets.length,1);
 assert.equal(result.analysis.targets[0].start,text.lastIndexOf('백영관'));
 assert.equal(result.analysis.targets[0].options[1].replacement,'白靈觀');
});

test('a surname or dictionary homograph target retains name-protection metadata and all original options',()=>{
 const text='백영관을 다시 불렀다.';
 const owner=one(text,'백영관',0,[candidate('c0','白永官')]);
 owner.dictionary_name_homograph=true;
 owner.suspected_person_name=true;
 const result=applySessionHanjaGlossary(text,analysis(text,[owner]),glossary('백영관(白靈觀)'));
 const target=result.analysis.targets[0];
 assert.equal(target.dictionary_name_homograph,true);
 assert.equal(target.suspected_person_name,true);
 assert.deepEqual(target.options.map(o=>o.replacement),
  ['백영관','白永官','白靈觀']);
 assert.equal(result.analysis.annotations.length,0);
});

test('preserve larger overlaps and protected names, but allow exact protected-name targets to receive a choice',()=>{
 const text='백영관을 다시 불렀다.';
 const larger=one(text,'백영관을',0,[candidate('c0','白永官을')]);
 const g=glossary('백영관(白靈觀)');
 const res=applySessionHanjaGlossary(text,analysis(text,[larger]),g);
 assert.equal(res.stats.newTargets,0);
 assert.equal(res.stats.newChoices,1);
 assert.equal(res.analysis.targets[0].options[2].replacement,'白靈觀을');
 const partial=one(text,'백영관을 다시',0,[candidate('c0','白永官을 다시')]);
 const skip=applySessionHanjaGlossary(text,analysis(text,[partial]),g);
 assert.equal(skip.stats.newChoices,0);
 assert.equal(skip.stats.newTargets,0);
 const protectedAnalysis={...analysis(text),repair_context:{protected_ranges:[[0,3]]}};
 const guarded=applySessionHanjaGlossary(text,protectedAnalysis,g);
 assert.equal(guarded.stats.newTargets,0);
});

test('no accidental substring matches inside longer Hangul compounds, punctuation-only matches or numbers',()=>{
 const g=glossary('백영관(白靈觀)');
 for(const text of ['유백영관','백영관장','백영관A','백영관1']){
  const result=applySessionHanjaGlossary(text,analysis(text),g);
  assert.equal(result.analysis.targets.length,0,text);
 }
 const punctuation='「백영관」은 좋다';
 const result=applySessionHanjaGlossary(punctuation,analysis(punctuation),g);
 assert.equal(result.analysis.targets.length,1);
 assert.equal(result.analysis.targets[0].start,1);
});

test('recognize leading Hanja followed by an explanation, ignore non-Hanja starts, and bound citations',()=>{
 const large='가나다 '.repeat(200)+'사주정설(四柱精說)'+' 라마바 '.repeat(200);
 const g=glossary(large,'영발(靈發: spiritual power)','트위터(Twitter)');
 assert.equal(g.terms,2);
 assert.equal(g.entries.has('영발'),true);
 assert.equal(g.entries.has('트위터'),false);
 const entry=g.entries.get('사주정설').get('四柱精說');
 assert.equal(entry.citations.length,1);
 assert.ok(entry.citations[0].length<=182);
});

test('selected review only learns Hanja references inside selected Korean spans',()=>{
 const a='백영관(白靈觀) 다른 단어',b='사주정설(四柱精說)';
 const g=buildSessionHanjaGlossary([
  {id:'a',text:a,selected:[{start:0,end:3}]},
  {id:'b',text:b,selected:[{start:2,end:4}]}
 ],{context:a+'\n'+b,restrictToSelection:true});
 assert.equal(g.terms,1);
 assert.equal(g.entries.has('백영관'),true);
 assert.equal(g.entries.has('사주정설'),false);
});

test('glossary built from unsplit context detects a pair even when 20k chunks divide it',()=>{
 const all='가 '.repeat(9997)+'백영관(白靈觀) 본문에서 백영관이 언급된다.';
 const chunks=splitText(all);
 assert.ok(chunks.length>1);
 const g=buildSessionHanjaGlossary(chunks,{context:all});
 assert.equal(g.entries.has('백영관'),true);
});

test('two independent operations have no shared mutable vocabulary',()=>{
 const source=glossary('백영관(白靈觀)');
 const newTask=glossary('학교(學校)');
 const text='백영관을 다시 찾았다';
 assert.equal(applySessionHanjaGlossary(text,analysis(text),source).analysis.targets.length,1);
 assert.equal(applySessionHanjaGlossary(text,analysis(text),newTask).analysis.targets.length,0);
});

test('full pipeline learns at first encounter, not retroactively; only later sentence receives source option',async()=>{
 const earlier='백영관을 다시 찾았다.',source='그곳은 백영관(白靈觀)이다.';
 const after='그 후 백영관도 다시 찾았다.';
 const sentences=[{id:'p0',text:earlier},{id:'p1',text:source},{id:'p2',text:after}];
 const seen=[],events=[],cache=new Map();
 const identity={engine_version:'fixture',dictionary_fingerprint:'fixture'};
 await runSentencePipeline({operationId:'session',sentences,
  context:sentences.map(s=>s.text).join('\n'),modes:{hanja:true,loanword:false},
  progressiveAnnotation:false},event=>events.push(event),{
  enabled:true,status:async()=>identity,cache,analyze:async text=>analysis(text),
  modelConfig:async()=>({provider:'fixture',model:'test',endpoint:'https://fixture.test/api',
   request:async(_,rows)=>{
    seen.push(...rows);
    return {results:rows.map(row=>({t:row.target_id,c:row.options[1].choice_id}))};
   }})
 });
 assert.equal(seen.length,1);
 assert.equal(seen[0].surface,'백영관');
 assert.equal(seen[0].context,after);
 assert.equal(seen[0].options[1].definitions[0].includes('本文汉字括注'),true);
 assert.equal(events.find(e=>e.type==='DONE').stats.session_hanja_glossary_terms,1);
 assert.equal(events.find(e=>e.type==='DONE').stats.session_hanja_new_targets,1);
 assert.equal(events.find(e=>e.type==='DONE').stats.inline_hanja_local_converted,1);
 const local=events.find(e=>e.type==='RESULTS'&&e.source==='local'&&e.results[0].id==='p1');
 assert.equal(local.results[0].annotations[0].replacement,'白靈觀');
 const model=events.filter(e=>e.type==='RESULTS'&&e.source==='model');
 assert.ok(model.some(e=>e.results.some(r=>r.id==='p2'&&r.annotations.some(a=>a.replacement==='白靈觀'))));
 assert.ok(model.every(e=>e.results.every(r=>r.id!=='p0'||r.annotations.length===0)));
 assert.equal([...cache.keys()].some(key=>key.includes('session-inline-hanja:')),false,
  'ephemeral article origin must not enter persisted review cache');
 assert.equal([...cache.values()].some(value=>JSON.stringify(value).includes('session-inline-hanja:')),false);
});

test('when model selects null for a later homograph, no other occurrence is forced to convert',async()=>{
 const first='백영관이라는 말이다.',source='백영관(白靈觀)';
 const after='또 다른 백영관이라는 말이다.';
 const events=[],identity={engine_version:'fixture',dictionary_fingerprint:'fixture'};
 await runSentencePipeline({operationId:'null-occurrence',sentences:[
  {id:'first',text:first},{id:'source',text:source},{id:'later',text:after}
 ],modes:{hanja:true},progressiveAnnotation:false
 },e=>events.push(e),{
  enabled:true,status:async()=>identity,analyze:async text=>analysis(text),
  modelConfig:async()=>({provider:'fixture',model:'test',endpoint:'https://fixture.test/api',
   request:async(_,rows)=>({results:rows.map(row=>({t:row.target_id,c:null}))})})
 });
 const model=events.filter(e=>e.type==='RESULTS'&&e.source==='model');
 assert.ok(model.every(e=>e.results.every(item=>item.annotations.length===0)));
 const done=events.find(e=>e.type==='DONE');
 assert.equal(done.stats.model_keep,1);
 assert.equal(done.stats.inline_hanja_local_converted,1);
 assert.equal(done.stats.session_hanja_new_targets,1);
});

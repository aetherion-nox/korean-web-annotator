import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createSessionHanjaGlossary,learnSessionHanjaGlossary,applySessionHanjaGlossary
} from '../session-hanja-glossary.js';
import {extractInlineHanjaPairs,applyInlineHanjaAnnotations} from '../inline-hanja-evidence.js';
import {runSentencePipeline} from '../annotation-pipeline.js';

const original=s=>({choice_id:null,type:'keep',replacement:s,entry_id:null,definitions:[]});
const raw=(text,targets=[],annotations=[])=>({
 engine_version:'test',dictionary_fingerprint:'test',targets,annotations,
 stats:{pending:targets.length,local_determined:annotations.length}
});
const target=(text,start,surface,spelling)=>({
 target_id:'t'+start,start,end:start+surface.length,surface,context:text,
 options:[original(surface),{choice_id:'c0',type:'hanja',
  entry_id:17,replacement:spelling,definitions:['Original dictionary sense']}]
});
function encounter(glossary,text,paragraphIndex=0,analysis=raw(text),selected=null){
 const pairs=extractInlineHanjaPairs(text);
 const applied=applyInlineHanjaAnnotations(text,analysis,{pairs,selected});
 const learned=learnSessionHanjaGlossary(text,applied.analysis,glossary,{
  paragraphIndex,pairs,selected});
 const injected=applySessionHanjaGlossary(text,applied.analysis,glossary,{
  paragraphIndex,selected});
 return {learned,applied,results:injected};
}

test('initial glossary is empty, and words before the first source get no new candidates',()=>{
 const glossary=createSessionHanjaGlossary();
 const text='백영관을 다시 찾았다';
 const result=applySessionHanjaGlossary(text,raw(text),glossary,{paragraphIndex:0});
 assert.equal(result.analysis.targets.length,0);
 assert.equal(glossary.terms,0);
 const source=encounter(glossary,'백영관(白靈觀)',1);
 assert.equal(source.learned,1);
 assert.equal(glossary.terms,1);
 assert.equal(source.applied.analysis.annotations[0].replacement,'白靈觀');
 const later=encounter(glossary,'다시 백영관을 찾았다.',2);
 assert.equal(later.results.analysis.targets.length,1);
 assert.equal(later.results.analysis.targets[0].options[1].replacement,'白靈觀');
});

test('inside one paragraph, new source affects subsequent occurrences but not preceding text',()=>{
 const text='백영관을 먼저 방문했다. 백영관(白靈觀)을 보고 백영관을 다시 찾았다.';
 const glossary=createSessionHanjaGlossary();
 const {learned,applied,results}=encounter(glossary,text,0);
 assert.equal(learned,1);
 assert.equal(applied.analysis.annotations.length,1);
 const targets=results.analysis.targets;
 assert.equal(targets.length,1,'the earlier instance must not receive a synthesized target');
 assert.equal(targets[0].start,text.lastIndexOf('백영관'));
 assert.equal(targets[0].options[1].replacement,'白靈觀');
 assert.equal(results.stats.newTargets,1);
});

test('even a pre-existing earlier dictionary target does not gain later source citation',()=>{
 const text='백영관은 언급된다. 백영관(白靈觀) 뒤에 백영관도 나온다.';
 const first=target(text,0,'백영관','白永館'),glossary=createSessionHanjaGlossary();
 const {results}=encounter(glossary,text,0,raw(text,[first]));
 assert.equal(results.analysis.targets.length,2);
 assert.deepEqual(results.analysis.targets[0].options.map(o=>o.replacement),
  ['백영관','白永館']);
 assert.equal(results.analysis.targets[1].start,text.lastIndexOf('백영관'));
 assert.equal(results.analysis.targets[1].options[1].replacement,'白靈觀');
});

test('new Hanja variant becomes available only after its own source, not after earlier spelling',()=>{
 const text='사주정설(四柱精說) 앞의 사주정설은 사주정설(四柱正說) 뒤의 사주정설은';
 const glossary=createSessionHanjaGlossary();
 const {results}=encounter(glossary,text,0);
 const targets=results.analysis.targets;
 assert.equal(glossary.conflicts,1);
 assert.equal(targets.length,2);
 assert.deepEqual(targets[0].options.map(o=>o.replacement),
  ['사주정설','四柱精說']);
 assert.deepEqual(targets[1].options.map(o=>o.replacement),
  ['사주정설','四柱精說','四柱正說']);
 assert.ok(targets[1].options[1].definitions.every(x=>x.includes('本文汉字括注')));
});

test('source is not learned if direct markup was rejected due to structural overlap',()=>{
 const text='백영관(白靈觀) 그리고 백영관';
 const blocking=target(text,0,'백영관(','白永館(');
 const glossary=createSessionHanjaGlossary();
 const {learned,results}=encounter(glossary,text,0,raw(text,[blocking]));
 assert.equal(learned,0);
 assert.equal(glossary.terms,0);
 assert.equal(results.analysis.targets.length,1);
 assert.equal(results.stats.newTargets,0);
});

test('unselected source is not learned; unrelated selections do not inherit evidence',()=>{
 const text='백영관(白靈觀) 그리고 백영관';
 const glossary=createSessionHanjaGlossary();
 const later=text.lastIndexOf('백영관');
 const result=encounter(glossary,text,0,raw(text),[{start:later,end:later+3}]);
 assert.equal(result.learned,0);
 assert.equal(glossary.terms,0);
 assert.equal(result.results.analysis.targets.length,0);
});

test('no cross-operation state leakage',()=>{
 const glossary=createSessionHanjaGlossary();
 encounter(glossary,'백영관(白靈觀)',0);
 const other=createSessionHanjaGlossary();
 const text='백영관도 언급되었다';
 assert.equal(applySessionHanjaGlossary(text,raw(text),glossary,{paragraphIndex:1}).analysis.targets.length,1);
 assert.equal(applySessionHanjaGlossary(text,raw(text),other,{paragraphIndex:1}).analysis.targets.length,0);
});

test('same-paragraph direct pair is applied locally, and other mentions still require model review',async()=>{
 const text='백영관은 먼저 언급되었다. 백영관(白靈觀) 이후 백영관도 등장한다.';
 const events=[],requests=[];
 await runSentencePipeline({operationId:'within-paragraph-order',sentences:[{id:'p0',text}],
  context:text,modes:{hanja:true,loanword:false},progressiveAnnotation:false},e=>events.push(e),{
  enabled:true,status:async()=>({engine_version:'test',dictionary_fingerprint:'test'}),
  analyze:async source=>raw(source),
  modelConfig:async()=>({provider:'fixture',model:'test',endpoint:'https://fixture.invalid',
   request:async(_,rows)=>{
    requests.push(...rows);
    return {results:rows.map(r=>({t:r.target_id,c:'c0'}))};
   }})
 });
 const local=events.find(e=>e.type==='RESULTS'&&e.source==='local');
 assert.equal(local.results[0].annotations.length,1);
 assert.equal(local.results[0].annotations[0].replacement,'白靈觀');
 assert.equal(requests.length,1);
 assert.equal(requests[0].start,text.lastIndexOf('백영관'));
 assert.equal(events.find(e=>e.type==='DONE').stats.session_hanja_new_targets,1);
});

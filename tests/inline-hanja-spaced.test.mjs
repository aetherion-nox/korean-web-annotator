import test from 'node:test';
import assert from 'node:assert/strict';
import {extractInlineHanjaPairs,applyInlineHanjaAnnotations} from '../inline-hanja-evidence.js';
import {createSessionHanjaGlossary,learnSessionHanjaGlossary} from '../session-hanja-glossary.js';
import {primaryHangulReading} from '../hanja-reading-data.js';
import {runSentencePipeline} from '../annotation-pipeline.js';
import {buildReviewPayload} from '../review-payload.js';

const identity={engine_version:'fixture',dictionary_fingerprint:'fixture'};
const emptyAnalysis=()=>({...identity,annotations:[],targets:[],stats:{local_determined:0,pending:0}});

test('a spaced source produces separate, aligned annotations with the same full evidence',()=>{
 const text='먼저 한자\u00a0문화권 (漢字文化圈: 설명)을 언급했다.';
 const pairs=extractInlineHanjaPairs(text);
 assert.deepEqual(pairs.map(p=>[text.slice(p.start,p.end),p.hanja]),[
  ['한자','漢字'],['문화권','文化圈']]);
 assert.equal(pairs[0].citation,pairs[1].citation);
 assert.match(pairs[0].citation,/한자\u00a0문화권 \(漢字文化圈: 설명\)/);
 assert.match(pairs[0].citation,/한자 → 漢字，문화권 → 文化圈/);
 assert.ok(pairs.every(p=>p.parenthesisEnd===text.indexOf(')')+1));
 assert.deepEqual(applyInlineHanjaAnnotations(text,emptyAnalysis(),{pairs}).analysis.annotations.map(a=>[
  a.surface,a.replacement]),[['한자','漢字'],['문화권','文化圈']]);
});

test('alignment never consumes a partial word or crosses a newline or separator',()=>{
 for(const text of ['한자 문화권(漢字文化)','한자\n문화권(漢字文化圈)',
  '한자, 문화권(漢字文化圈)','한자\n 문화권(漢字文化圈)']){
  assert.deepEqual(extractInlineHanjaPairs(text),[],text);
 }
 assert.deepEqual(extractInlineHanjaPairs('한자 문화권(文化圈)').map(p=>p.surface),['문화권']);
});

test('the existing reading rule applies separately to each glossary entry',()=>{
 const rare='𱁬';
 assert.ok(!primaryHangulReading(rare));
 for(const [text,entries] of [
  [`한자 문화권(漢${rare}文化圈)`,['한자','문화권']],
  ['한자 문화권(日本文化圈)',['문화권']]
 ]){
  const glossary=createSessionHanjaGlossary();
  const {analysis}=applyInlineHanjaAnnotations(text,emptyAnalysis());
  assert.equal(analysis.annotations.length,2);
  assert.equal(learnSessionHanjaGlossary(text,analysis,glossary),entries.length);
  assert.deepEqual([...glossary.entries.keys()],entries);
 }
});

test('only later occurrences receive separate review targets with the shared citation',async()=>{
 const sentences=[
  {id:'before',text:'한자 문화권이 나왔다.'},
  {id:'source',text:'한자 문화권(漢字文化圈)이 나왔다.'},
  {id:'after',text:'한자 문화권이 다시 나왔다.'}
 ];
 const events=[],targets=[];
 await runSentencePipeline({operationId:'spaced-hanja',sentences,
  modes:{hanja:true,loanword:false},progressiveAnnotation:false},e=>events.push(e),{
  enabled:true,status:async()=>identity,analyze:async()=>emptyAnalysis(),
  modelConfig:async()=>({provider:'fixture',model:'test',endpoint:'https://fixture.invalid',
   request:async(config,rows)=>{
    targets.push(...rows);
    const {payload}=buildReviewPayload(config.context,rows,config);
    return {results:payload.targets.map(target=>({t:target.target_id,c:target.options[0]}))};
   }})
 });
 assert.deepEqual(targets.map(target=>[target.surface,target.context]),[
  ['한자',sentences[2].text],['문화권',sentences[2].text]]);
 for(const target of targets){
  const option=target.options.find(candidate=>candidate.entry_id?.startsWith('session-inline-hanja:'));
  assert.match(option.definitions[0],/한자 문화권\(漢字文化圈\)이 나왔다\./);
  assert.match(option.definitions[0],/한자 → 漢字，문화권 → 文化圈/);
 }
 const {stats}=events.find(e=>e.type==='DONE');
 assert.equal(stats.inline_hanja_local_converted,2);
 assert.equal(stats.model_projected_fragments,2);
});

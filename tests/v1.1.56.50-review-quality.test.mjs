import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateChoices,validateExperimentalChoices} from '../choice-review.js';
import {literalOriginOption} from '../experimental-options.js';
import {buildSessionHanjaGlossary} from '../session-hanja-glossary.js';
import {protectRepeatedArticleNames} from '../article-name-consistency.js';
import {buildReviewInstructions} from '../review-payload.js';

const keep=surface=>({choice_id:null,type:'keep',replacement:surface,entry_id:null,definitions:[]});
const hanja=(id,replacement)=>({choice_id:id,type:'hanja',replacement,entry_id:id,definitions:['dictionary entry']});
const target=(surface,options,extra={})=>({
 target_id:'t0',surface,start:0,end:surface.length,context:surface,options:[keep(surface),...options],...extra
});

test('quoted JSON null is never painted as a Latin model origin',()=>{
 const row={t:'t0',c:'null'};
 const t=target('도',[],{experimental_loanword_audit:true});
 assert.equal(literalOriginOption(t,'null',{experimentalLoanword:true}),null);
 const reply=validateExperimentalChoices([t],{results:[row]},{experimentalLoanword:true});
 assert.equal(reply.accepted[0].option.type,'keep');
 const content=readFileSync(new URL('../content.js',import.meta.url),'utf8');
 assert.match(content,/choiceId\.toLowerCase\(\)==='null'/);
});

test('dictionary c/n selection does not depend on the experimental reading checker',()=>{
 const t=target('곽면우',[hanja('c0','郭傘宇')]);
 for(const hanjaReadingCheck of [false,true]){
  const reply=validateChoices([t],{results:[{t:'t0',c:'c0'}]},{hanjaReadingCheck});
  assert.equal(reply.accepted.length,1);
  assert.equal(reply.accepted[0].option.choice_id,'c0');
  assert.deepEqual(reply.unresolved,[]);
 }
});

test('incorrect inline parenthetical spelling remains local but is not reused',()=>{
 const g=buildSessionHanjaGlossary([],{
  context:'곽면우(郭傘宇) 선생은 떠났다. 곽면우가 다시 왔다.'});
 assert.equal(g.entries.has('곽면우'),false);
 const other=buildSessionHanjaGlossary([],{context:'학교(學校)에서 공부한다.'});
 assert.equal(other.entries.has('학교'),true);
});

test('corroborated name and compound-part segmentation suppress ordinary homographs',()=>{
 const text='제산 박재현. 제산은 제산의 말을 듣는다.';
 const a=text.indexOf('제산'),person=text.indexOf('박재현');
 const b=text.indexOf('제산',a+2),d=text.lastIndexOf('제산');
 const make=(id,start,surface,opts)=>({
  target_id:id,start,end:start+surface.length,surface,context:text,options:[keep(surface),...opts]
 });
 const analysis={
  targets:[
   make('a',a,'제산',[hanja('c0','祭山')]),
   make('b',b,'제',[hanja('c0','帝')]),
   make('c',d,'제산',[hanja('c0','祭山')])
  ],
  repair_context:{kiwi_tokens:[
   {form:'제산',tag:'NNP',start:a,end:a+2},
   {form:'박재현',tag:'NNP',start:person,end:person+3}]},
  stats:{pending:3,protected_names:0}
 };
 const output=protectRepeatedArticleNames(text,analysis);
 assert.equal(output.protectedCount,3);
 assert.equal(output.analysis.targets.every(t=>t.options.length===1),true);
 assert.equal(output.analysis.targets.every(t=>t.suspected_person_name===true),true);
 assert.equal(analysis.targets[0].options.length,2,'original dictionary analysis stays untouched');
});

test('repeated name before an honorific protects later name+particle collision',()=>{
 const text='정봉강 선생의 글이다. 정봉강도 읽었다.';
 const start=text.indexOf('강도'),t={
  target_id:'t0',start,end:start+2,surface:'강도',context:text,
  options:[keep('강도'),hanja('c0','強盜')]
 };
 const res=protectRepeatedArticleNames(text,{
  targets:[t],repair_context:{kiwi_tokens:[]},stats:{pending:1}
 });
 assert.equal(res.protectedCount,1);
 assert.equal(res.analysis.targets[0].options.length,1);
});

test('person-name protection preserves phonetic author Hanja glossary evidence',()=>{
 const text='백영관 선생이 말했다. 백영관은 돌아왔다.';
 const start=text.lastIndexOf('백영관');
 const source={target_id:'t0',start,end:start+3,surface:'백영관',context:text,
  options:[
   keep('백영관'),
   {...hanja('c0','白靈觀'),entry_id:'session-inline-hanja:백영관:白靈觀'},
   hanja('c1','白永館')
  ]};
 const result=protectRepeatedArticleNames(text,{
  targets:[source],repair_context:{kiwi_tokens:[]},stats:{pending:1}
 });
 assert.equal(result.protectedCount,1);
 assert.deepEqual(result.analysis.targets[0].options.map(o=>o.choice_id),[null,'c0']);
});

test('two ordinary place names without independent person evidence are unaffected',()=>{
 const text='대구가 좋다. 대구에도 간다.';
 const source={targets:[target('대구',[hanja('c0','大邱')])],
  repair_context:{kiwi_tokens:[{form:'대구',tag:'NNP',start:0,end:2}]},stats:{}};
 assert.equal(protectRepeatedArticleNames(text,source).protectedCount,0);
});

test('first-pass prompt does not require a second model request',()=>{
 const prompt=buildReviewInstructions({experimentalHanja:true,experimentalLoanword:true,smartSegmentation:true});
 assert.match(prompt,/Dictionary options are proposals, not proof/);
 assert.match(prompt,/empty options object \{\}/);
 assert.match(prompt,/SAME response/);
});

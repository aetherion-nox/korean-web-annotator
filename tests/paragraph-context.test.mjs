import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {createRequire} from 'node:module';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
import {createParagraphPlan} from '../paragraph-plan.js';
import {runSentencePipeline} from '../annotation-pipeline.js';
import {validateAnalysis} from '../local-engine.js';
function setup(html){
 const dom=new JSDOM(html);const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
 const context={document:dom.window.document,NodeFilter:dom.window.NodeFilter,MAX_ENTRIES:3000,OWN_RUBY:'ruby[kra-annotated="true"]',seenSources:new Set()};vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('  function sourceOf'),source.indexOf('  function pageIdentity')),context);
 vm.runInContext(source.slice(source.indexOf('  function selectedIntervals'),source.indexOf('  function applySettings')),context);
 vm.runInContext(source.slice(source.indexOf('  function collectTextNodes'),source.indexOf('  function isKnownRecoverySource')),context);
 const entries=context.collectTextNodes();return {dom,entries,plan:createParagraphPlan(entries,context.sourceOf,'p,li,h1,h2,blockquote')};
}
const ruby=(s,h)=>`<ruby kra-annotated="true" data-kra-original="${s}">${h}<rt>${s}</rt></ruby>`;
const identity={engine_version:'test',dictionary_fingerprint:'dict'};
test('full paragraph includes original words of existing annotations and inline links',async()=>{
 const {dom,entries,plan}=setup('<p>일본 정부는 '+ruby('재무','財務')+'상 '+ruby('명의','名義')+'로 <a href="/jt">JT</a> '+ruby('주식','株式')+' 37.55%를 보유하고 있어...</p>');
 const full='일본 정부는 재무상 명의로 JT 주식 37.55%를 보유하고 있어...';assert.equal(plan.context,full);assert.equal(plan.sentences.length,1);
 const observed=[];await runSentencePipeline({operationId:'op',sentences:plan.sentences,restrictToSelection:true,modes:{hanja:true}},()=>{},{status:async()=>identity,analyze:async text=>{observed.push(text);return {...identity,annotations:[],targets:[],stats:{}};}});
 assert.deepEqual(observed,[full]);assert.ok(dom.window.document.querySelector('a'));dom.window.close();
});
test('Hanja mapping spans inline markup and preserves source offsets',()=>{
 const {dom,plan,entries}=setup('<p>😀 <b>학</b><a href="/school">교</a>에 갔다.</p>');const text=plan.sentences[0].text;const start=text.indexOf('학교');
 const output=plan.projectResult({id:'p0',annotations:[{start,end:start+2,surface:'학교',replacement:'學校',type:'hanja'}]});
 const parts=output.flatMap(r=>r.annotations);assert.deepEqual(parts.map(a=>a.replacement),['學','校']);
 for(const r of output){const e=[...entries.values()].find(e=>e.id===r.id);for(const a of r.annotations)assert.equal(e.text.slice(a.start,a.end),a.surface);}
 assert.equal(dom.window.document.querySelector('a').getAttribute('href'),'/school');dom.window.close();
});
test('already annotated text supplies context but is not selected again',async()=>{
 const {dom,plan}=setup('<p>'+ruby('명의','名義')+'로 학교</p>');const text=plan.sentences[0].text;const events=[];
 await runSentencePipeline({operationId:'op',sentences:plan.sentences,restrictToSelection:true,modes:{hanja:true}},e=>events.push(e),{status:async()=>identity,analyze:async()=>({...identity,annotations:[{start:0,end:2,surface:'명의',replacement:'名義',type:'hanja'},{start:4,end:6,surface:'학교',replacement:'學校',type:'hanja'}],targets:[],stats:{}})});
 const a=events.filter(e=>e.source==='local').flatMap(e=>e.results.flatMap(r=>r.annotations));assert.deepEqual(a.map(a=>a.surface),['학교']);dom.window.close();
});
test('manual recovery bindings project to original text entries',()=>{
 const {dom,plan}=setup('<p><b>학</b>교</p>');const binding={sentenceId:'p0',start:0,end:2,surface:'학교'};
 const pieces=plan.projectBinding(binding,{annotations:[{start:0,end:2,surface:'학교',replacement:'學校',type:'hanja'}]});assert.equal(pieces.length,2);assert.deepEqual(pieces.map(p=>p.annotations[0].replacement),['學','校']);dom.window.close();
});
test('dictionary category metadata passes validation for identity review',()=>{
 const target={target_id:'t0',start:0,end:3,surface:'이수민',context:'이수민',dictionary_person_name:true,options:[{choice_id:'KEEP',type:'keep',replacement:'이수민',entry_id:null,definitions:[]},{choice_id:'c0',type:'hanja',replacement:'李壽民',entry_id:1,definitions:['인물'],subject_category:'인명',semantic_category:null}]};
 assert.equal(validateAnalysis('이수민',{...identity,annotations:[],targets:[target],stats:{}}).targets[0].options[1].subject_category,'인명');
});

test('real rendering keeps links and inline structure after paragraph projection',()=>{
 const {dom,entries,plan}=setup('<p><b>학</b><a href="/school">교</a>에 갔다.</p>');
 const projected=plan.projectResult({id:'p0',annotations:[{start:0,end:2,surface:'학교',replacement:'學校',type:'hanja'}]});
 for(const item of projected){const entry=[...entries.values()].find(e=>e.id===item.id);entry.annotations=item.annotations;}
 const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');const context={OWN_RUBY:'ruby[kra-annotated="true"]',document:dom.window.document,ownDomChanges:new WeakSet(),seenSources:new Set(),rememberRecovery:()=>{}};vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('  function loanwordDisplay'),source.indexOf('  function contextState')),context);
 context.insertConversions(entries,[]);
 assert.equal(dom.window.document.querySelectorAll('ruby').length,2);
 assert.equal(dom.window.document.querySelector('a').getAttribute('href'),'/school');assert.ok(dom.window.document.querySelector('b ruby'));
 dom.window.close();
});

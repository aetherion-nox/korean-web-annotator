import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createParagraphPlan} from '../paragraph-plan.js';

const {JSDOM}=createRequire(import.meta.url)('jsdom');
const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');

function page(){
 const dom=new JSDOM('<!DOCTYPE html><body><article itemprop="articleBody" id="article-view-content-div">'+
  '<table cellspacing="2"><tbody><tr><td>그림 설명</td></tr></tbody></table>'+
  ' '+('학교 '.repeat(310))+'<br>'+
  ' '+('학교 '.repeat(310))+'</article></body>',{url:'https://example.test/article'});
 const document=dom.window.document;
 const ctx={document,
  OWN_RUBY:'ruby[kra-annotated="true"]',
  ownDomChanges:new WeakSet(),analyzedNodeVersions:new WeakMap(),
  seenSources:new Set(),rememberRecovery(){},console};
 vm.createContext(ctx);
 const srcSource=source.slice(source.indexOf('  function sourceOf('),
   source.indexOf('  function pageIdentity('));
 const srcRender=source.slice(source.indexOf('  function loanwordDisplay('),
   source.indexOf('  // Cheap, read-only child-frame preflight.'));
 vm.runInContext(srcSource+'\n'+srcRender,ctx);
 const article=document.querySelector('#article-view-content-div');
 const nodes=[...article.childNodes].filter(x=>x.nodeType===3&&x.data.includes('학교'));
 assert.equal(nodes.length,2);
 const entries=new Map(nodes.map((node,i)=>[node,{id:String(i),node,text:node.data,
  annotations:[],selected:[{start:0,end:node.data.length}]}]));
 const plan=createParagraphPlan(entries,ctx.sourceOf,
  'p,li,dt,dd,td,th,h1,h2,h3,h4,h5,h6,blockquote,pre,figcaption');
 return {dom,document,article,ctx,nodes,entries,plan};
}
function allHanja(text){
 return [...text.matchAll(/학교/gu)].map(m=>({start:m.index,end:m.index+2,
  surface:'학교',replacement:'學校',type:'hanja'}));
}
test('large article with a floated caption table projects 620 conversions to original direct text nodes',()=>{
 const p=page();
 try{
  assert.equal(p.plan.sentences.length,1);
  const sentence=p.plan.sentences[0],expected=allHanja(sentence.text);
  assert.equal(expected.length,620);
  const original=p.ctx.sourceOf(p.article).text;
  const mapped=p.plan.projectResult({id:sentence.id,annotations:expected},{source:'model'});
  assert.equal(mapped.reduce((n,item)=>n+item.annotations.length,0),620);
  const byId=new Map([...p.entries.values()].map(e=>[e.id,e]));
  for(const item of mapped)byId.get(item.id).annotations=item.annotations;
  assert.equal(p.ctx.insertConversions(p.entries,[]),620);
  assert.equal(p.article.querySelectorAll('ruby[kra-annotated="true"]').length,620);
  assert.equal(p.ctx.sourceOf(p.article).text,original,'annotations preserve original article coordinates');
  assert.ok([...p.entries.values()].every(e=>e.renderFailure==null&&!e.invalidated));
 }finally{p.dom.window.close();}
});
test('streaming repaint grows same long article from a few previews to all 620 without clearing it',()=>{
 const p=page();
 try{
  const sentence=p.plan.sentences[0];
  const original=p.ctx.sourceOf(p.article).text;
  const annotations=allHanja(sentence.text);
  const byId=new Map([...p.entries.values()].map(e=>[e.id,e]));
  const operation=[];
  for(const version of [annotations.slice(0,3),annotations.slice(0,100),annotations]){
   const mapped=p.plan.projectResult({id:sentence.id,annotations:version},
     {source:'model',provisional:version.length!==annotations.length});
   for(const item of mapped){
    const entry=byId.get(item.id);
    entry.annotations=item.annotations;
    entry.hasPreview=version.length!==annotations.length;
   }
   p.ctx.insertConversions(p.entries,operation);
  }
  assert.equal(p.article.querySelectorAll('ruby[kra-annotated="true"]').length,620);
  assert.equal(p.ctx.sourceOf(p.article).text,original);
  assert.equal(operation.length,2);
 }finally{p.dom.window.close();}
});

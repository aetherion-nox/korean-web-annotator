import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
const own='ruby[kra-annotated="true"]';
function fixture(html='<main><p id="p"><ruby class="kra-ruby" kra-annotated="true" data-kra-original="학교" data-kra-type="hanja">學校<rt>학교</rt></ruby>에 가요.</p></main>'){
 const dom=new JSDOM(html,{url:'https://fixture.test/article/1'});
 const history=[],blocks=new Set(),events=[];
 const c={document:dom.window.document,OWN_RUBY:own,ownDomChanges:new WeakSet(),
  analyzedNodeVersions:new WeakMap(),seenSources:new Set(),history,recoveryBlocks:blocks,
  uiSettings:{restoreExistingAnnotations:true},pageCompleted:true,
  currentTask:null,console,
  rememberRecovery:undefined,
  configureRecovery(){events.push('recovery')},
  configureAutomaticAnnotation(){},
  cancelTask(){events.push('cancel')},
  status(value){events.push(value)},
  publishState(){},send(){},resetRecovery(){blocks.clear()},
  openTextRoots(){return [dom.window.document.body]}
 };
 vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('  function rememberRecovery'),
  source.indexOf('  function isOwnMutation')),c);
 vm.runInContext(source.slice(source.indexOf('  function loanwordDisplay'),
  source.indexOf('  // Cheap, read-only child-frame preflight')),c);
 vm.runInContext(source.slice(source.indexOf('  function restorePage()'),
  source.indexOf('  function startSelection(')),c);
 return {c,dom,history,blocks,events};
}
function oldAnnotation(){
 return {start:0,end:2,surface:'학교',replacement:'學校',type:'hanja'};
}
function sourceEntry(f,reviewed=true){
 const node=f.dom.window.document.querySelector('ruby');
 const block={annotations:new Map([['0:2',{...oldAnnotation()}]])};
 f.blocks.add(block);
 const entry={node,text:'학교',isRuby:true,selected:[{start:0,end:2}],
  originalHTML:node.innerHTML,originalOuterHTML:node.outerHTML,
  modelReviewed:reviewed,localAnnotations:[],annotations:[],
  recoveryAnchor:{block,start:0}};
 return {node,block,entry};
}
test('review selecting null removes the current Hanja; undo restores exact PRIOR ruby',()=>{
 const f=fixture(),{node,block,entry}=sourceEntry(f),op=[];
 op.groupId='recheck';op.startedAt=100;
 assert.equal(f.c.insertConversions(new Map([[node,entry]]),op),0);
 assert.equal(f.dom.window.document.querySelectorAll(own).length,0);
 assert.equal(op.length,1,'a real overwrite must be undoable');
 assert.equal(block.annotations.size,0,'committed keep supersedes old recovery');
 f.history.push(op);
 assert.deepEqual(JSON.parse(JSON.stringify(f.c.latestUndoState())),
  {ok:true,groupId:'recheck',startedAt:100,depth:1});
 assert.equal(f.c.undoLast('recheck').ok,true);
 assert.equal(f.dom.window.document.querySelectorAll(own).length,1);
 assert.equal(f.dom.window.document.querySelector(own).textContent,'學校학교');
 assert.equal(block.annotations.size,1,'undo must restore previous dynamic recovery snapshot');
 assert.equal(f.history.length,0);
 f.dom.window.close();
});
test('reanalysis without any audited or converted result does NOT erase prior annotation',()=>{
 const f=fixture(),{node,block,entry}=sourceEntry(f,false),op=[];
 op.groupId='no-audit';op.startedAt=200;
 f.c.insertConversions(new Map([[node,entry]]),op);
 assert.equal(f.dom.window.document.querySelectorAll(own).length,1);
 assert.equal(f.dom.window.document.querySelector(own).textContent,'學校학교');
 assert.equal(block.annotations.size,1);
 assert.equal(op.length,0);
 assert.equal(op.recoveryBefore,undefined,'no unverified render must mutate recovery cache');
 f.dom.window.close();
});
test('invalidated DOM does not modify older annotation cache or create false history',()=>{
 const f=fixture(),{node,block,entry}=sourceEntry(f);
 node.replaceWith(f.dom.window.document.createTextNode('外部変更'));
 f.c.insertConversions(new Map([[node,entry]]),[]);
 assert.equal(entry.invalidated,true);
 assert.equal(block.annotations.size,1);
 f.dom.window.close();
});
test('restore all removes owned rubies from this frame, clears history and snapshots',()=>{
 const f=fixture(),{node,block,entry}=sourceEntry(f);
 f.history.push(Object.assign([],{groupId:'A',startedAt:1}));
 const response=f.c.restorePage();
 assert.equal(response.ok,true);
 assert.equal(response.removed,1);
 assert.equal(f.dom.window.document.querySelectorAll(own).length,0);
 assert.equal(f.dom.window.document.querySelector('#p').textContent,'학교에 가요.');
 assert.equal(f.history.length,0);
 assert.equal(f.blocks.size,0);
 f.dom.window.close();
});
test('a group-mismatched undo cannot consume an unrelated prior selection',()=>{
 const f=fixture();
 f.history.push(Object.assign([],{groupId:'older-selected-range',startedAt:10}));
 const result=f.c.undoLast('whole-page-group');
 assert.equal(result.ok,false);assert.equal(result.skipped,true);
 assert.equal(f.history.length,1);
 assert.equal(f.events.includes('cancel'),false);
 f.dom.window.close();
});

test('undo refuses to pop an older record when task completion changes the history stack',()=>{
 const f=fixture();
 const previous=Object.assign([],{groupId:'older',startedAt:1});
 f.history.push(previous);
 const newcomer=Object.assign([],{groupId:'latest',startedAt:2});
 f.c.cancelTask=()=>f.history.push(newcomer);
 const result=f.c.undoLast('older');
 assert.equal(result.ok,false);
 assert.match(result.error,/新结果/);
 assert.equal(f.history.length,2);
 assert.equal(f.history[0],previous);
 assert.equal(f.history[1],newcomer);
 f.dom.window.close();
});

test('restore removes extension rubies from open Shadow DOM as well as main document',()=>{
 const f=fixture();
 const host=f.dom.window.document.createElement('section');
 const shadow=host.attachShadow({mode:'open'});
 shadow.innerHTML='<p><ruby kra-annotated="true" data-kra-original="언어">言語<rt>언어</rt></ruby></p>';
 f.dom.window.document.body.append(host);
 f.c.openTextRoots=()=>[f.dom.window.document.body,shadow];
 const result=f.c.restorePage();
 assert.equal(result.removed,2);
 assert.equal(f.dom.window.document.querySelectorAll(own).length,0);
 assert.equal(shadow.querySelectorAll(own).length,0);
 assert.equal(shadow.textContent,'언어');
 f.dom.window.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Dependency-free DOM shim, modeling the APIs the content writer actually uses.
// In particular a connected root may have parentNode=null, whereas its child
// anchor has a parent. Detached roots can also retain the old inserted nodes.
function createFixture(){
  const selected=[];
  function makeNode(text,parent=null){
    const n={data:text,parentNode:parent,isConnected:parent?.isConnected??false};
    n.isEqualNode=(other)=>n.data===other?.data;
    n.cloneNode=()=>makeNode(n.data);
    n.before=(fragment)=>{
      const i=n.parentNode.children.indexOf(n);
      assert.ok(i>=0);
      for(const child of fragment.childNodes){child.parentNode=n.parentNode;child.isConnected=n.parentNode.isConnected;}
      n.parentNode.children.splice(i,0,...fragment.childNodes);
    };
    n.remove=()=>{
      const siblings=n.parentNode?.children;
      if(siblings){const i=siblings.indexOf(n);if(i>=0)siblings.splice(i,1);}
      n.parentNode=null;n.isConnected=false;
    };
    return n;
  }
  function root(connected=true){return {parentNode:null,isConnected:connected,children:[]};}
  function child(parent,text='학교는 좋다'){
    const node=makeNode(text,parent);parent.children.push(node);return node;
  }
  const context={
    document:{createRange(){return {
      selectNode(node){if(!node?.parentNode)throw new Error('Failed to execute selectNode: the given Node has no parent');selected.push(node);},
      createContextualFragment(html){const child=makeNode(html);return {childNodes:[child],querySelectorAll(){return [{}];}};}
    };}},
    rememberRecovery(){},findRepaintedTextNode(){return null},conversionHTML(entry){return 'converted:'+entry.annotations[0]?.replacement;},
    ownDomChanges:new WeakSet(),seenSources:new Set(),OWN_RUBY:'ruby[kra-annotated="true"]'
  };
  vm.createContext(context);
  const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
  vm.runInContext(source.slice(source.indexOf('  function insertConversions('),source.indexOf('  function contextState()')),context);
  function entry(node){return {node,text:node.data,selected:[{start:0,end:node.data.length}],annotations:[{replacement:'學校'}]};}
  function paint(node,e,history=[]){return context.insertConversions(new Map([[node,e]]),history);}
  return {selected,makeNode,root,child,entry,paint};
}

test('connected root without parent may contain a live text anchor',()=>{
  const f=createFixture();const parent=f.root(),node=f.child(parent),e=f.entry(node),history=[];
  assert.equal(f.paint(node,e,history),1);
  assert.equal(f.selected[0],node,'Range must select the child anchor, never the root parent');
  assert.equal(history.length,1);
  assert.equal(parent.children.length,1);
  assert.equal(parent.children[0].data,'converted:學校');
  e.annotations=[{replacement:'校園'}];
  assert.equal(f.paint(node,e,history),1);
  assert.equal(parent.children[0].data,'converted:校園');
});

test('detached parent retaining the old fragment is skipped before selectNode',()=>{
  const f=createFixture();const parent=f.root(),node=f.child(parent),e=f.entry(node);
  f.paint(node,e);
  assert.equal(f.selected.length,1);
  parent.isConnected=false;for(const n of parent.children)n.isConnected=false;
  e.annotations=[{replacement:'學園'}];
  assert.equal(f.paint(node,e),1);
  assert.equal(e.invalidated,true);
  assert.equal(f.selected.length,1,'must not create a Range for stale result');
});

test('original text removed before first result is ignored',()=>{
  const f=createFixture();const parent=f.root(),node=f.child(parent),e=f.entry(node);
  node.remove();
  assert.equal(f.paint(node,e),0);
  assert.equal(e.invalidated,true);
  assert.equal(f.selected.length,0);
});

test('replaced fragment with valid but different source is not overwritten',()=>{
  const f=createFixture();const parent=f.root(),node=f.child(parent),e=f.entry(node);
  f.paint(node,e);
  const replacement=parent.children[0];replacement.data='website changed text';
  e.annotations=[{replacement:'學園'}];
  assert.equal(f.paint(node,e),1);
  assert.equal(e.invalidated,true);
  assert.equal(replacement.data,'website changed text');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../engine-settings.js',import.meta.url),'utf8');
const start=source.indexOf('function syncHanjaReadingCheckUI(){');
const end=source.indexOf('const dictionaryLabels=',start);
assert.ok(start>0&&end>start,'the real settings controller must include the reading and review policy sync functions');
const code=source.slice(start,end);

function fixture({api='0',manual='65536',retry=true,discard=false}={}){
 const els=new Map();
 const el=id=>{
  if(!els.has(id))els.set(id,{checked:false,value:''});
  return els.get(id);
 };
 el('uiLocale').value='zh-CN';
 el('apiOutputTokenLimit').value=api;
 el('manualOutputTokenLimit').value=manual;
 el('retryInvalidDictionaryChoices').checked=retry;
 el('discardInvalidReviewResults').checked=discard;
 const saved=[];
 const status={textContent:''};
 const context={
  $,status,chrome:{storage:{local:{set:async change=>saved.push({...change})}}},
  t:key=>({
   outputTokenLimitError:'输出 Token 限额不合法',
   reviewStrategySavedWithInvalidTokens:'审核策略已单独保存',
   saved:'已保存'
  }[key]||key),
  syncOutputInputs(){},
  show(){},
  importedDictionary:false,
  normalizeBatchContextTier:v=>v,
  console
 };
 function $(id){return el(id)}
 vm.createContext(context);
 vm.runInContext(code,context);
 const states=()=>({
  retry:el('retryInvalidDictionaryChoices').checked,
  discard:el('discardInvalidReviewResults').checked
 });
 const oneMode=()=>{
  const {retry,discard}=states();
  assert.equal(Number(retry)+Number(discard),1,'exactly one checkbox must visibly be checked');
 };
 return {el,context,saved,status,states,oneMode};
}

test('invalid API Token limit cannot prevent checkbox mutual exclusion or saving the chosen strategy',async()=>{
 const x=fixture();
 x.el('discardInvalidReviewResults').checked=true;
 await x.context.save('discardInvalidReviewResults');
 assert.deepEqual(x.states(),{retry:false,discard:true});
 x.oneMode();
 assert.equal(x.saved.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(x.saved[0])),{
  retryInvalidDictionaryChoices:false,
  discardInvalidReviewResults:true
 });
 assert.ok(!Object.hasOwn(x.saved[0],'apiOutputTokenLimit'));
 assert.ok(!Object.hasOwn(x.saved[0],'manualOutputTokenLimit'));
 assert.match(x.status.textContent,/Token.*不合法/);
 assert.match(x.status.textContent,/策略已单独保存/);

 x.el('discardInvalidReviewResults').checked=false;
 await x.context.save('discardInvalidReviewResults');
 assert.deepEqual(x.states(),{retry:true,discard:false});
 x.oneMode();
 assert.equal(x.saved.length,2);
 assert.equal(x.saved[1].retryInvalidDictionaryChoices,true);

 x.el('retryInvalidDictionaryChoices').checked=false;
 await x.context.save('retryInvalidDictionaryChoices');
 assert.deepEqual(x.states(),{retry:false,discard:true});
 x.oneMode();
 assert.equal(x.saved.length,3);
});

test('invalid manual Token field also permits a review-strategy change but blocks unrelated settings writes',async()=>{
 const x=fixture({api:'16384',manual:'abc'});
 x.el('retryInvalidDictionaryChoices').checked=false;
 await x.context.save('retryInvalidDictionaryChoices');
 assert.deepEqual(x.states(),{retry:false,discard:true});
 x.oneMode();
 assert.equal(x.saved.length,1);
 assert.deepEqual(Object.keys(x.saved[0]).sort(),
  ['discardInvalidReviewResults','retryInvalidDictionaryChoices']);

 x.el('reviewPosFilter').checked=true;
 await x.context.save('reviewPosFilter');
 x.oneMode();
 assert.equal(x.saved.length,1,'other settings must still be blocked by invalid Token input');
});

test('legacy both-off and both-on states visibly normalize even before unrelated Token validation',async()=>{
 for(const state of [
  {retry:false,discard:false,expected:{retry:true,discard:false}},
  {retry:true,discard:true,expected:{retry:false,discard:true}}
 ]){
  const x=fixture(state);
  await x.context.save('reviewPosFilter');
  assert.deepEqual(x.states(),state.expected);
  x.oneMode();
 }
});

test('ordinary valid limits still save all normal controls and preserve exactly one review mode',async()=>{
 const x=fixture({api:'16384',manual:'65536'});
 x.el('discardInvalidReviewResults').checked=true;
 await x.context.save('discardInvalidReviewResults');
 assert.deepEqual(x.states(),{retry:false,discard:true});
 x.oneMode();
 assert.equal(x.saved.length,1);
 assert.equal(x.saved[0].apiOutputTokenLimit,16384);
 assert.equal(x.saved[0].manualOutputTokenLimit,65536);
 assert.equal(x.saved[0].retryInvalidDictionaryChoices,false);
 assert.equal(x.saved[0].discardInvalidReviewResults,true);
 assert.equal(x.saved[0].reviewPosFilter,false);
});

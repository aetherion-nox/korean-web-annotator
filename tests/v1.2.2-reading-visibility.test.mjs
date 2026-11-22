import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {ENGINE_SWITCH_DEFAULTS,engineSwitchValues} from '../engine-defaults.js';

const html=readFileSync(new URL('../options.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../engine-settings.js',import.meta.url),'utf8');
const start=js.indexOf('function syncHanjaReadingCheckUI(){');
const end=js.indexOf('const dictionaryLabels=',start);
assert.ok(start>0&&end>start);

function fixture({experimentalHanja=false,reading=false,api='16384'}={}){
 const elements=new Map();
 const $=id=>{if(!elements.has(id))elements.set(id,{checked:false,hidden:false,disabled:false,value:''});return elements.get(id);};
 $('uiLocale').value='zh-CN';
 $('experimentalHanja').checked=experimentalHanja;
 $('hanjaReadingCheck').checked=reading;
 $('enableModelReview').checked=true;
 $('retryInvalidDictionaryChoices').checked=true;
 $('apiOutputTokenLimit').value=api;
 $('manualOutputTokenLimit').value='65536';
 const saved=[];
 const context={$,
  status:{textContent:''},
  chrome:{storage:{local:{set:async values=>saved.push({...values})}}},
  t:key=>key,
  syncOutputInputs(){},show(){},
  importedDictionary:false,
  normalizeBatchContextTier:value=>value
 };
 vm.createContext(context);
 vm.runInContext(js.slice(start,end),context);
 return {$,saved,context};
}

test('hidden on load and OFF by default, regardless of stale opt-in when experiment is disabled',()=>{
 assert.match(html,/<div id="hanjaReadingCheckRow" hidden>/);
 assert.match(html,/<input id="hanjaReadingCheck" type="checkbox" aria-describedby="hanjaReadingCheckHint">/);
 assert.equal(ENGINE_SWITCH_DEFAULTS.hanjaReadingCheck,false);
 assert.equal(engineSwitchValues({}).hanjaReadingCheck,false);
 assert.equal(engineSwitchValues({experimentalHanja:false,hanjaReadingCheck:true}).hanjaReadingCheck,false);
 assert.equal(engineSwitchValues({experimentalHanja:true,hanjaReadingCheck:true}).hanjaReadingCheck,true);
});

test('turning experimental Hanja OFF hides, disables, clears and persists the dependent switch',async()=>{
 const x=fixture({experimentalHanja:true,reading:true});
 x.context.syncHanjaReadingCheckUI();
 assert.equal(x.$('hanjaReadingCheckRow').hidden,false);
 assert.equal(x.$('hanjaReadingCheck').checked,true);
 x.$('experimentalHanja').checked=false;
 await x.context.save('experimentalHanja');
 assert.equal(x.$('hanjaReadingCheckRow').hidden,true);
 assert.equal(x.$('hanjaReadingCheck').disabled,true);
 assert.equal(x.$('hanjaReadingCheck').checked,false);
 assert.equal(x.saved.at(-1).experimentalHanja,false);
 assert.equal(x.saved.at(-1).hanjaReadingCheck,false);
 x.$('experimentalHanja').checked=true;
 await x.context.save('experimentalHanja');
 assert.equal(x.$('hanjaReadingCheckRow').hidden,false);
 assert.equal(x.$('hanjaReadingCheck').disabled,false);
 assert.equal(x.$('hanjaReadingCheck').checked,false);
});

test('explicit opt-in is preserved when experimental Hanja remains enabled',async()=>{
 const x=fixture({experimentalHanja:true,reading:true});
 x.context.syncHanjaReadingCheckUI();
 await x.context.save('hanjaReadingCheck');
 assert.equal(x.$('hanjaReadingCheckRow').hidden,false);
 assert.equal(x.saved.at(-1).hanjaReadingCheck,true);
});

test('invalid output-token limit still allows a dependent switch change without saving bad token values',async()=>{
 const x=fixture({experimentalHanja:true,reading:true,api:'bad'});
 x.$('experimentalHanja').checked=false;
 await x.context.save('experimentalHanja');
 assert.equal(x.$('hanjaReadingCheckRow').hidden,true);
 assert.equal(x.$('hanjaReadingCheck').checked,false);
 assert.equal(x.saved.at(-1).experimentalHanja,false);
 assert.equal(x.saved.at(-1).hanjaReadingCheck,false);
 assert.equal(Object.hasOwn(x.saved.at(-1),'apiOutputTokenLimit'),false);
});

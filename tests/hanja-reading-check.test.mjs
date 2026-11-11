import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {primaryHangulReading} from '../hanja-reading-data.js';
import {validateModelHanjaReadings} from '../hanja-reading-check.js';
import {literalOriginOption} from '../experimental-options.js';

const annotation=(surface,replacement,start=0)=>({
 start,end:start+surface.length,surface,replacement,type:'hanja'
});

test('primary Hanja readings are available for normal characters, not fabricated for unknown ranges',()=>{
 assert.equal(primaryHangulReading('韓'),'한');
 assert.equal(primaryHangulReading('國'),'국');
 assert.equal(primaryHangulReading('潛'),'잠');
 assert.equal(primaryHangulReading('𠮷'),'');
 assert.equal(primaryHangulReading('AB'),'');
});

test('model-supplied Hanja is rejected when pronunciation contradicts the source',()=>{
 const bad=validateModelHanjaReadings('사과',[annotation('사과','韓國')]);
 assert.equal(bad.status,'mismatch');
 const good=validateModelHanjaReadings('한국',[annotation('한국','韓國')]);
 assert.equal(good.status,'matched');
 assert.equal(good.checked,2);
});

test('word-initial Korean phonology is applied without changing inner-syllable readings',()=>{
 const initial=validateModelHanjaReadings('여자',[annotation('여자','女子')]);
 assert.equal(initial.status,'matched');
 assert.equal(validateModelHanjaReadings('양',[annotation('양','両')]).status,'matched');
 const nonInitial=validateModelHanjaReadings('가양',[annotation('가양','可両')]);
 assert.equal(nonInitial.status,'mismatch');
 assert.equal(validateModelHanjaReadings('이',[annotation('이','李')]).status,'matched');
});

test('unknown Hanja reading is explicitly unknown, not falsely marked dictionary-verified',()=>{
 const outcome=validateModelHanjaReadings('가',[annotation('가','𠮷')]);
 assert.equal(outcome.status,'unknown');
 assert.equal(outcome.missing,1);
});

test('direct model-origin Hanja rejects reading mismatch and tracks unverified origin',()=>{
 const target={target_id:'t0',start:0,end:2,surface:'한국',context:'한국',
  options:[{choice_id:'KEEP',type:'keep',replacement:'한국',entry_id:null,definitions:[]}]};
 const selected=literalOriginOption(target,'韓國',{experimentalHanja:true});
 assert.equal(selected?.origin_source,'model-unverified');
 assert.equal(literalOriginOption({...target,surface:'사과',context:'사과'},'韓國',{experimentalHanja:true}),null);
 assert.equal(literalOriginOption({...target,options:undefined},'韓國',{experimentalHanja:true})?.origin_source,'model-unverified');
});

test('the page identifies dictionary-backed and model-unverified annotations',async()=>{
 const [js,css]=await Promise.all([
  fs.readFile(new URL('../content.js',import.meta.url),'utf8'),
  fs.readFile(new URL('../content.css',import.meta.url),'utf8')
 ]);
 assert.ok(js.includes('data-kra-source'));
 assert.ok(js.includes('model-unverified'));
 assert.ok(css.includes('ruby.kra-ruby[data-kra-source="model-unverified"]'));
});

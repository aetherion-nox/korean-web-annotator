import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateAnalysis} from '../local-engine.js';
import {buildReviewPayload,buildManualPrompt} from '../review-payload.js';

function makeTargets(text,n,includeContext=false) {
 return Array.from({length:n},(_,i)=>({
  target_id:'t'+i,start:i*3,end:i*3+2,surface:'가나',
  ...(includeContext?{context:text}:{}),
  options:[
   {choice_id:null,type:'keep',replacement:'가나',entry_id:null,definitions:[]},
   {choice_id:'c0',type:'hanja',replacement:'假那',entry_id:5,definitions:['a Hanja lexical item']}
  ]
 }));
}
test('compact browser targets rehydrate original context without loosening source validation',()=>{
 const text='가나 '.repeat(240);
 const raw={engine_version:'test',dictionary_fingerprint:'f0',annotations:[],
  targets:makeTargets(text,200),stats:{local_determined:0,pending:200}};
 const output=validateAnalysis(text,raw);
 assert.equal(output.targets.length,200);
 assert.ok(output.targets.every(t=>t.context===text));
 const bad={...raw,targets:[{...raw.targets[0],context:'다른 글'}]};
 assert.throws(()=>validateAnalysis(text,bad),/Invalid engine target/);
});
test('shared model payload encodes large paragraph once across 1200 targets',()=>{
 const n=1200,text='가나 '.repeat(n);
 const targets=makeTargets(text,n,true);
 const {payload,stats}=buildReviewPayload(text,targets,{reviewPosFilter:false});
 assert.equal(payload.sentences.length,1);
 assert.equal(payload.sentences[0].text,text);
 assert.equal(Object.hasOwn(payload,'context'),false,'API payload does not duplicate source text at the top level');
 assert.equal(payload.targets.length,n);
 assert.equal(payload.targets[1200-1].sentence_id,'s0');
 assert.ok(!payload.targets.some(t=>'context' in t),'target context is in the sentence pool');
 const size=Buffer.byteLength(JSON.stringify(payload));
 assert.ok(size<230000,'shared payload must stay linear in target count');
 assert.ok(stats.legacyUserBytes>size*20,'reported old format has quadratic text repetition');
});
test('browser bridge and persistent cache deliberately strip redundant target context',()=>{
 const bridge=fs.readFileSync(new URL('../python/browser-support/browser_bridge.py',import.meta.url),'utf8');
 const worker=fs.readFileSync(new URL('../service-worker.js',import.meta.url),'utf8');
 assert.match(bridge,/compact_analysis_wire/);
 assert.match(worker,/targets:value\.targets\.map\(\(\{context,repair_context,\.\.\.target\}\)/);
});

test('non-smart manual and API reviews keep full sentence plus adjacent context without a duplicate context field',()=>{
 const text='미국이 북한과 회담을 검토했다.';
 const adjacent_context={before:'앞 문단',after:'뒤 문단'};
 const targets=[{target_id:'t0',start:0,end:2,surface:'미국',context:text,adjacent_context,
  options:[{choice_id:null,type:'keep',replacement:'미국',entry_id:null,definitions:[]}]}];
 const api=buildReviewPayload('extra page-wide copy',targets,{smartSegmentation:false}).payload;
 assert.equal(Object.hasOwn(api,'context'),false);
 assert.deepEqual(api.sentences,[{sentence_id:'s0',text,adjacent_context}]);
 assert.equal(api.targets[0].sentence_id,'s0');
 const manual=buildManualPrompt('extra page-wide copy',targets,'batch-ordinary',{smartSegmentation:false});
 const marker='{"format":"shared-pools-v5"';
 const json=JSON.parse(manual.slice(manual.indexOf(marker)));
 assert.equal(Object.hasOwn(json,'context'),false);
 assert.deepEqual(json.sentences,api.sentences);
 assert.equal(json.batch_id,'batch-ordinary');
});

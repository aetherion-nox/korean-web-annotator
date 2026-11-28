import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateAnalysis} from '../local-engine.js';
import {buildReviewPayload} from '../review-payload.js';
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('one global switch controls initial and continuation streaming and API test',()=>{
 assert.ok(!source('options.html').includes('newProviderStream'));
 assert.ok(!source('options.js').includes('newProviderStream'));
 assert.ok(!source('api-profiles.js').includes('providerStream'));
 assert.match(source('service-worker.js'),/stream: localState\.progressiveAnnotation===true/);
 assert.equal([...source('annotation-pipeline.js').matchAll(/stream:progressive,/g)].length,2);
 assert.ok(source('feature-settings.js').includes('边完成边标注（流式标注）'));
});
test('spaced phrase candidates survive JS validation and reach review payload',()=>{
 const text='일산화 탄소', phrase_origin='일산화 탄소 (一酸化炭素)';
 const targets=[[0,3,'일산화','一酸化'],[4,6,'탄소','炭素']].map(([start,end,surface,replacement],i)=>({
  target_id:'t'+i,start,end,surface,context:text,options:[
   {choice_id:null,type:'keep',replacement:surface,entry_id:null,definitions:[]},
   {choice_id:'c0',type:'hanja',replacement,entry_id:254095,definitions:['Complete dictionary phrase: '+phrase_origin,'화학 용어.'],written_form:'일산화^탄소',phrase_origin}
  ]
 }));
 const data={engine_version:'fixture',dictionary_fingerprint:'fixture',annotations:[],targets,stats:{}};
 const validated=validateAnalysis(text,data);
 assert.equal(validated.targets.length,2);
 assert.equal(validated.targets[0].options[1].phrase_origin,phrase_origin);
 const result=buildReviewPayload(text,validated.targets,{reviewPosFilter:false});
 assert.ok(JSON.stringify(result).includes(phrase_origin));
 assert.throws(()=>validateAnalysis(text,{...data,targets:[{...targets[0],options:[targets[0].options[0],{...targets[0].options[1],phrase_origin:42}]}]}),/Invalid phrase origin metadata/);
 assert.throws(()=>validateAnalysis(text,{...data,targets:[{...targets[0],options:[targets[0].options[0],{...targets[0].options[1],unknown_field:1}]}]}),/Invalid engine option fields/);
});

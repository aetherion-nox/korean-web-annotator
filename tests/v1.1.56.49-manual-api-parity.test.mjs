import test from 'node:test';
import assert from 'node:assert/strict';
import {runSentencePipeline} from '../annotation-pipeline.js';
import {createOrderedResultRelay} from '../annotation-event.js';

const identity={engine_version:'fixture-shared',dictionary_fingerprint:'fixed'};
const phrase='학교에서 공부를 하고 싶다. ';
const paragraph=phrase.repeat(260); // >7K chars in one DOM paragraph
const targets=[...paragraph.matchAll(/학교/g)].map((m,i)=>({
 target_id:'target-'+i,start:m.index,end:m.index+2,surface:'학교',context:paragraph,
 options:[
  {choice_id:null,type:'keep',replacement:'학교',definitions:[],entry_id:null},
  {choice_id:'c0',type:'hanja',replacement:'學校',definitions:['school'],entry_id:1}
 ]
}));
function analyze(){
 return {...identity,annotations:[],targets,stats:{pending:targets.length,local_determined:0}};
}
async function run(kind){
 const events=[],requests=[];
 await runSentencePipeline({
  operationId:'shared-'+kind,
  sentences:[{id:'p0',text:paragraph}],
  modes:{hanja:true,loanword:true},
  progressiveAnnotation:kind==='streaming'
 },event=>events.push(event),{
  status:async()=>identity,enabled:true,analyze,
  modelConfig:async()=>({
   manualReview:kind==='manual',
   batchContextTier:'1m',
   manualOutputTokenLimit:65536,apiOutputTokenLimit:65536,
   matchManualOutputBudget:true,
   provider:kind==='manual'?'manual':'fixture',endpoint:'https://example.test/v1',
   model:'fixture',request:async(config,wire)=>{
    requests.push(wire.length);
    return {results:wire.map(t=>({t:t.target_id,c:'c0'}))};
   }
  })
 });
 const results=events.filter(e=>e.type==='RESULTS'&&e.source==='model'&&
  e.provisional!==true).flatMap(e=>e.results||[]);
 assert.equal(events.at(-1).type,'DONE');
 assert.equal(requests.reduce((n,x)=>n+x,0),targets.length);
 assert.ok(results.length);
 const final=results.at(-1);
 assert.equal(final.id,'p0');
 assert.equal(final.annotations.length,targets.length);
 assert.equal(final.reviewed.length,targets.length);
 assert.equal(paragraph.slice(final.annotations[0].start,final.annotations[0].end),
  final.annotations[0].surface);
 for(const item of final.annotations){
  assert.equal(item.type,'hanja');
  assert.equal(item.replacement,'學校');
  for(const forbidden of ['context','options','definitions','morphology','verified_person_hanja'])
   assert.equal(forbidden in item,false,'DOM events must not include '+forbidden);
 }
 assert.ok(JSON.stringify(final).length<100000,'single long paragraph result must remain small');
 return {final,events,requests};
}

test('manual, streaming API and non-streaming API share one final validated source-bound DOM result',async()=>{
 const manual=await run('manual'),streaming=await run('streaming'),api=await run('api');
 assert.deepEqual(streaming.final,manual.final);
 assert.deepEqual(api.final,manual.final);
 assert.deepEqual(manual.requests,[targets.length]);
 assert.deepEqual(streaming.requests,[targets.length]);
 assert.deepEqual(api.requests,[targets.length]);
});
test('async background checkpoints cannot reorder the same final Results/DONE pathway',async()=>{
 const order=[],relay=createOrderedResultRelay(async event=>{
  if(event.type==='RESULTS'&&event.results?.[0]?.id==='slow')
   await new Promise(resolve=>setTimeout(resolve,15));
  order.push(event.type==='DONE'?'DONE':event.results?.[0]?.id);
 });
 const promises=[
  relay({type:'RESULTS',results:[{id:'slow'}]}),
  relay({type:'RESULTS',results:[{id:'fast'}]}),
  relay({type:'DONE'})
 ];
 await Promise.all(promises);
 assert.deepEqual(order,['slow','fast','DONE']);
});

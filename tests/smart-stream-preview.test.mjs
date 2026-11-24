import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {choicePreviewParser} from '../model-stream.js';
import {runSentencePipeline} from '../annotation-pipeline.js';
import {shouldPublishPreview} from '../annotation-event.js';
const text='과학',word={target_id:'local',surface:text,start:0,end:2,context:text,options:[
 {choice_id:null,type:'keep',replacement:text,entry_id:null,definitions:[]},
 {choice_id:'c0',type:'hanja',replacement:'科學',entry_id:1,definitions:['science']}
]};
const identity={engine_version:'fixture',dictionary_fingerprint:'fixture'};
const config={provider:'hunyuan',model:'hy4-flash',endpoint:'https://tokenhub.tencentmaas.com/v1/chat/completions',smartSegmentation:true,enableModelReview:true,reviewPosFilter:false,logger:{start:async()=>null,finish:async()=>{}}};
const sse=(content,finish_reason=null)=>'data: '+JSON.stringify({choices:[{index:0,delta:{content},finish_reason}]})+'\n\n';
function mock(body,mode){
 const payload=JSON.parse(body.messages[1].content),target=payload.targets.find(t=>!t.scan_only);
 assert.ok(target);const pool=target.options.find(id=>payload.candidates.some(c=>c.id===id&&c.replacement==='科學'))||target.options[0];
 assert.match(pool,/^p\d+$/);
 const results=JSON.stringify({t:target.target_id,c:pool});
 const repair={sentence_id:target.sentence_id,op:'delete',old_target_ids:[target.target_id],start:0,end:2,surface:text};
 const first='{"results":['+results+']';
 const last=mode==='repair'?',"repairs":['+JSON.stringify(repair)+']}':',"repairs":[]}';
 return new Response(new ReadableStream({start(controller){
  const enc=new TextEncoder();controller.enqueue(enc.encode(sse(first)));
  if(mode==='refusal')controller.enqueue(enc.encode(sse('','content_filter')+'data: [DONE]\n\n'));
  else if(mode==='malformed')controller.enqueue(enc.encode(sse(',"repairs":[{','stop')+'data: [DONE]\n\n'));
  else if(mode!=='interrupted')controller.enqueue(enc.encode(sse(last,'stop')+'data: [DONE]\n\n'));
  controller.close();
 }}),{headers:{'content-type':'text/event-stream'}});
}
async function run(mode,extraConfig={}){
 const events=[],old=globalThis.fetch;
 globalThis.fetch=async(_,req)=>mock(JSON.parse(req.body),mode);
 try{await runSentencePipeline({operationId:'smart-preview',sentences:[{id:'p',text}],modes:{hanja:true,loanword:true},smartSegmentation:true,progressiveAnnotation:true},e=>events.push(e),{
  enabled:true,status:async()=>identity,analyze:async()=>({...identity,annotations:[],targets:[word],repair_context:{kiwi_tokens:[],protected_ranges:[]},stats:{pending:1}}),modelConfig:async()=>({...config,...extraConfig})
 });}finally{globalThis.fetch=old;}
 return events.filter(e=>e.type==='RESULTS'&&e.source==='model');
}
test('smart SSE shows regular answer provisionally, then atomically removes it on validated deletion',async()=>{
 const events=await run('repair');
 assert.ok(events.some(e=>e.provisional&&e.results[0].annotations.some(a=>a.replacement==='科學')),JSON.stringify(events));
 const finals=events.filter(e=>!e.provisional);
 assert.ok(finals.length);
 assert.ok(finals.every(e=>e.results[0].annotations.length===0),'superseded ordinary result must never be checkpointed');
 assert.ok(finals.at(-1).results[0].reviewed.some(a=>a.surface===text));
});
test('smart SSE with no repair commits the same previously visible choice',async()=>{
 const events=await run('ordinary');
 assert.ok(events.some(e=>e.provisional&&e.results[0].annotations.length));
 assert.equal(events.at(-1).provisional,false);
 assert.equal(events.at(-1).results[0].annotations[0].replacement,'科學');
});
test('root results field can follow repairs; nested decoy fields are ignored',()=>{
 let latest=[];const parser=choicePreviewParser([word],rows=>latest=rows,()=>null,{choiceIndex:{local:{p0:['c0']}}});
 const response='{"repairs":[{"results":[{"t":"local","c":null}]}],"results":[{"t":"local","c":"p0"}]}';
 for(const char of response)parser(char);
 assert.equal(latest[0].option.replacement,'科學');
});
test('long paragraphs retract conflicts without waiting for next 48 rows',()=>{
 assert.equal(shouldPublishPreview({sentenceChars:3000,hasPublished:true,lastCount:80,nextCount:79}),true);
});
test('lazy disconnect recovery promotes complete smart previews but explicit cancellation rolls back',()=>{
 const source=fs.readFileSync(new URL('../content.js',import.meta.url),'utf8');
 assert.match(source,/if\(preserveValidatedPreviews\)\s*\{/);
 assert.doesNotMatch(source,/preserveValidatedPreviews&&!task\.smartSegmentation/);
 assert.match(source,/if\(result\.smartSegmentation===true\)task\.smartSegmentation=true/);
});

for(const mode of ['interrupted','malformed']){
 test('lazy smart stream retains valid ordinary choice after '+mode,async()=>{
  const events=await run(mode);
  assert.ok(events.some(e=>e.provisional&&e.results[0].annotations.length));
  const finals=events.filter(e=>!e.provisional);
  assert.ok(finals.length);
  assert.equal(finals.at(-1).results[0].annotations[0].replacement,'科學');
 });
}
test('explicit provider refusal does not promote provisional smart choices',async()=>{
 const events=await run('refusal',{discardInvalidReviewResults:true});
 assert.ok(events.some(e=>e.provisional&&e.results[0].annotations.length));
 assert.ok(events.filter(e=>!e.provisional).every(e=>e.results[0].annotations.length===0));
});

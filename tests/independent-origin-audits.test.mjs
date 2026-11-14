import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewPayload,buildManualPrompt,buildReviewInstructions} from '../review-payload.js';
import {validateExperimentalChoices} from '../choice-review.js';
import {validateSegmentationRepairs} from '../segmentation-repairs.js';
import {runSentencePipeline} from '../annotation-pipeline.js';

const keep=surface=>({choice_id:'KEEP',type:'keep',replacement:surface,entry_id:null,definitions:[]});
const unknown={target_id:'audit',start:0,end:2,surface:'원잠',context:'원잠',
  experimental_hanja_audit:true,options:[keep('원잠')]};

test('Hanja dictionary-gap audit is an independent target, not a segmentation repair',()=>{
 const payload=buildReviewPayload('원잠',[unknown],{experimentalHanja:true}).payload;
 assert.equal(payload.targets.length,1);
 assert.equal(payload.targets[0].experimental_hanja_audit,true);
 assert.deepEqual(payload.targets[0].options,{});
 assert.equal(payload.targets[0].scan_only,undefined);
 assert.equal(payload.sentences[0].kiwi_tokens,undefined);
 const prompt=buildManualPrompt('원잠',[unknown],'batch',{experimentalHanja:true});
 assert.match(prompt,/Experimental origin-audit targets/);
 assert.doesNotMatch(prompt,/Repair objects use/);
 const accepted=validateExperimentalChoices([unknown],{results:[{t:'audit',c:'原潛'}]},
  {experimentalHanja:true});
 assert.equal(accepted.accepted.length,1);
 assert.equal(accepted.accepted[0].option.replacement,'原潛');
 assert.equal(validateExperimentalChoices([unknown],{results:[{t:'audit',c:'原潛'}]},
  {}).accepted[0].option.type,'keep');
 assert.equal(validateExperimentalChoices([unknown],{results:[{t:'audit',c:null}]},
  {experimentalHanja:true}).accepted[0].option.type,'keep');
});

test('smart segmentation can generate a new origin for a genuine boundary repair even when independent audit is off',()=>{
 const text='이산화탄소';
 const targets=[{target_id:'t0',original_target_id:'t0',repair_sentence_key:'paragraph',
   start:0,end:3,surface:'이산화',context:text,options:[keep('이산화'),
    {choice_id:'c0',type:'hanja',replacement:'二酸化',entry_id:1,definitions:['carbon compound']}]},
  {target_id:'t1',original_target_id:'t1',repair_sentence_key:'paragraph',
   start:3,end:5,surface:'탄소',context:text,options:[keep('탄소'),
    {choice_id:'c0',type:'hanja',replacement:'炭素',entry_id:2,definitions:['carbon']}]}
 ];
 const scope={text,allTargets:targets,localAnnotations:[],protected_ranges:[],
   selected:null,existingRepairs:[]};
 const config={context:text,smartSegmentation:true,repairModes:{hanja:true,loanword:false},
  repairScopes:new Map(targets.map(t=>[t.target_id,scope])),hanjaReadingCheck:true,
  experimentalHanja:false};
 const sid=buildReviewPayload(text,targets,config).payload.sentences[0].sentence_id;
 const row={sentence_id:sid,op:'replace',old_target_ids:['t0','t1'],
   start:0,end:5,surface:text,choice_id:'二酸化炭素'};
 const result=validateSegmentationRepairs(targets,{repairs:[row]},config);
 assert.equal(result.accepted.length,1,JSON.stringify(result.rejected));
 assert.equal(result.accepted[0].annotations[0].replacement,'二酸化炭素');
 assert.equal(result.accepted[0].annotations[0].origin_source,'model-unverified');
 assert.equal(validateSegmentationRepairs(targets,{repairs:[{...row,choice_id:'韓國'}]},config).accepted.length,0);
 assert.match(buildReviewInstructions({smartSegmentation:true}),/genuine structural fix/);
});

test('smart segmentation also retains free-origin add when there is no old dictionary target',()=>{
 const text='원잠';
 const scan={target_id:'scan',scan_only:true,repair_sentence_key:'paragraph',
  start:0,end:2,surface:text,context:text,options:[keep(text)]};
 const scope={text,allTargets:[],localAnnotations:[],protected_ranges:[],
  selected:null,existingRepairs:[]};
 const config={context:text,smartSegmentation:true,repairModes:{hanja:true,loanword:false},
  repairScopes:new Map([['scan',scope]]),experimentalHanja:false};
 const sid=buildReviewPayload(text,[scan],config).payload.sentences[0].sentence_id;
 const row={sentence_id:sid,op:'add',old_target_ids:[],start:0,end:2,surface:text,choice_id:'原潛'};
 const result=validateSegmentationRepairs([scan],{repairs:[row]},config);
 assert.equal(result.accepted.length,1,JSON.stringify(result.rejected));
 assert.equal(result.accepted[0].annotations[0].replacement,'原潛');
});

test('pipeline forwards dictionary-gap audit switch separately from smart segmentation',async()=>{
 const modes=[],events=[];
 await runSentencePipeline({operationId:'hanja-audit',sentences:[{id:'s',text:'원잠'}],
   modes:{hanja:true,loanword:false},experimentalHanjaAudit:true,smartSegmentation:false},e=>events.push(e),{
   enabled:true,status:async()=>({engine_version:'fixture',dictionary_fingerprint:'db'}),
   analyze:async(_text,m)=>{modes.push(m);return {
    engine_version:'fixture',dictionary_fingerprint:'db',
    annotations:[],targets:[unknown],stats:{pending:1}};},
   modelConfig:async()=>({enableModelReview:true,experimentalHanja:true,
      request:async()=>({results:[{t:'b0t0',c:'原潛'}]})})
 });
 assert.equal(modes.length,1);
 assert.equal(modes[0].experimentalHanjaAudit,true);
 assert.equal(modes[0].smartSegmentation,false);
 assert.ok(events.some(e=>e.type==='DONE'));
});

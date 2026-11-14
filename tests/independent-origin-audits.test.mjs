import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewPayload,buildManualPrompt,buildReviewInstructions} from '../review-payload.js';
import {validateExperimentalChoices} from '../choice-review.js';
import {validateSegmentationRepairs,verifySegmentationOrigin} from '../segmentation-repairs.js';
import {dictionarySupportedRepairOrigin} from '../repair-validation-core.js';
import {runSentencePipeline} from '../annotation-pipeline.js';

const keep=surface=>({choice_id:'KEEP',type:'keep',replacement:surface,entry_id:null,definitions:[]});
const unknown={target_id:'audit',start:0,end:2,surface:'원잠',context:'원잠',
  experimental_hanja_audit:true,options:[keep('원잠')]};

test('Hanja dictionary-gap audit is a normal target, not a segmentation repair',()=>{
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
  {}).accepted.length,0);
 assert.equal(validateExperimentalChoices([unknown],{results:[{t:'audit',c:null}]},
  {experimentalHanja:true}).accepted[0].option.type,'keep');
});

test('model repair only accepts free additions for explicitly enabled experimental origins',()=>{
 const text='원잠',scan={...unknown,scan_only:true,repair_sentence_key:'paragraph',
  repair_context:{kiwi_tokens:[],protected_ranges:[]}};
 const scope={text,allTargets:[],localAnnotations:[],protected_ranges:[],selected:null,existingRepairs:[]};
 const config={context:text,smartSegmentation:true,
  repairModes:{hanja:false,loanword:false},repairScopes:new Map([['scan',scope]])};
 const t={...scan,target_id:'scan',options:[keep(text)]};
 const row={sentence_id:'s0',op:'add',old_target_ids:[],
  start:0,end:2,surface:'원잠',choice_id:'原潛'};
 assert.equal(validateSegmentationRepairs([t],{repairs:[row]},config).accepted.length,0);
 const enabled={...config,repairModes:{hanja:true,loanword:false}};
 assert.equal(validateSegmentationRepairs([t],{repairs:[row]},enabled).accepted.length,1);
 assert.match(buildReviewInstructions({smartSegmentation:true}),/experiment/i);
});

test('segmentation-only mode can split known dictionary Hanja, but cannot invent it',()=>{
 const text='과학기술';
 const old={target_id:'t0',original_target_id:'original',repair_sentence_key:'paragraph',
   start:0,end:4,surface:text,context:text,options:[
    keep(text),{choice_id:'c0',type:'hanja',replacement:'科學技術',
      entry_id:33,definitions:['science and technology']}
   ]};
 const scope={text,allTargets:[{...old,target_id:'original'}],
   localAnnotations:[],protected_ranges:[],selected:null,existingRepairs:[]};
 const config={context:text,smartSegmentation:true,repairModes:{hanja:false,loanword:false},
   repairScopes:new Map([['t0',scope]]),hanjaReadingCheck:true};
 const approved={start:0,end:2,surface:'과학',choice_id:'科學',old_target_ids:['t0']};
 assert.equal(dictionarySupportedRepairOrigin(approved,[old],scope),true);
 assert.equal(dictionarySupportedRepairOrigin({...approved,choice_id:'韓國'},[old],scope),false);
 const sid=buildReviewPayload(text,[old],config).payload.sentences[0].sentence_id;
 const repair=choice_id=>({sentence_id:sid,op:'replace',old_target_ids:['t0'],
   start:0,end:2,surface:'과학',choice_id});
 const checked=validateSegmentationRepairs([old],{repairs:[repair('科學')]},config);
 assert.equal(checked.accepted.length,1,JSON.stringify(checked.rejected));
 assert.equal(checked.accepted[0].annotations[0].origin_source,'dictionary-backed-repair');
 assert.equal(validateSegmentationRepairs([old],{repairs:[repair('韓國')]},config).accepted.length,0);
 assert.equal(verifySegmentationOrigin({...approved,sentence:{text},config:{...config,repairTargets:[old]}})
   [0].replacement,'科學');
});

test('pipeline forwards experimental Hanja audit independently of smart segmentation',async()=>{
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

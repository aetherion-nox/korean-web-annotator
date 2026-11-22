import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ENGINE_SWITCH_DEFAULTS,engineSwitchValues} from '../engine-defaults.js';
import {validateChoices,validateExperimentalChoices} from '../choice-review.js';
import {literalOriginOption} from '../experimental-options.js';
import {validateModelHanjaReadings} from '../hanja-reading-check.js';

const keep=surface=>({choice_id:null,type:'keep',replacement:surface,entry_id:null,definitions:[]});
const sense=(id,origin,type='hanja')=>({choice_id:id,type,replacement:origin,entry_id:116652,definitions:['dictionary unit']});
const original=(id,context,surface,origin,other)=>({
 target_id:id,context,surface,start:context.lastIndexOf(surface),
 end:context.lastIndexOf(surface)+surface.length,
 options:[keep(surface),sense('c0',origin),...(other||[])]
});
const result=(t,c)=>({results:[{t,c}]});

test('Hanja pronunciation check defaults OFF in the engine and all stored-setting fallbacks',()=>{
 assert.equal(ENGINE_SWITCH_DEFAULTS.hanjaReadingCheck,false);
 assert.equal(engineSwitchValues({}).hanjaReadingCheck,false);
 assert.equal(engineSwitchValues({hanjaReadingCheck:false}).hanjaReadingCheck,false);
 assert.equal(engineSwitchValues({hanjaReadingCheck:true}).hanjaReadingCheck,true,
  'explicit user opt-in is preserved across an upgrade');
 const src=readFileSync(new URL('../engine-settings.js',import.meta.url),'utf8');
 for(const locale of ['zh-CN','zh-TW','en','ja','ko'])
  assert.ok(src.includes("'"+locale+"':")||src.includes(locale+":"),locale);
 assert.match(src,/仅校验模型在实验性功能中直接填写的汉字词源/);
 assert.match(src,/词典提供的 c\/n 选项不受此开关影响/);
 assert.match(src,/默认关闭/);
});

test('all observed numeric dates accept dictionary 年 under enabled as well as disabled reading check',()=>{
 for(const [i,context] of [
  '2026년','1993년','3년','167년','2011년','10년'
 ].entries()){
  const target=original('t'+i,context,'년','年');
  // Raw table can call it 연 and reject 년 in a number expression. The
  // dictionary option must never be subjected to that experimental veto.
  const check=validateModelHanjaReadings(context,[{
   start:target.start,end:target.end,surface:'년',replacement:'年',type:'hanja'
  }]);
  assert.equal(check.status,'mismatch',context);
  for(const enabled of [false,true]){
   const config={hanjaReadingCheck:enabled,experimentalHanja:true,reviewPosFilter:false};
   for(const validator of [validateChoices,validateExperimentalChoices]){
    const reviewed=validator([target],result(target.target_id,'c0'),config);
    assert.equal(reviewed.accepted.length,1,context);
    assert.equal(reviewed.accepted[0].option.replacement,'年',context);
    assert.deepEqual(reviewed.unresolved,[],context);
   }
  }
 }
});

test('dictionary Hanja remains dictionary-backed regardless of reading toggle; invalid IDs still rejected',()=>{
 const target=original('t0','경제','경제','經濟');
 for(const enabled of [false,true]){
  for(const c of ['c3','p2','c99']){
   const verdict=validateExperimentalChoices([target],result('t0',c),{
    hanjaReadingCheck:enabled,experimentalHanja:true,retryInvalidDictionaryChoices:true
   });
   assert.equal(verdict.accepted.length,0,c);
   assert.deepEqual(verdict.invalidDictionaryChoiceIds,['t0'],c);
  }
  const selected=validateExperimentalChoices([target],result('t0','c0'),{
   hanjaReadingCheck:enabled,experimentalHanja:true
  });
  assert.equal(selected.accepted[0].option.entry_id,116652);
 }
});

test('dictionary-verified personal-name Hanja is not mistakenly passed to the experimental phonetic veto',()=>{
 const t=original('tPerson','임금','임금','李承晩');
 t.dictionary_person_name=true;
 t.verified_person_hanja=['李承晩'];
 const checked=validateChoices([t],result('tPerson','李承晩'),{
  hanjaReadingCheck:true,reviewPosFilter:true
 });
 assert.equal(checked.accepted.length,1);
 assert.equal(checked.accepted[0].option.replacement,'李承晩');
 assert.equal(checked.unresolved.length,0);
});

test('the optional checker still rejects model-written Hanja mismatches when ON, not when OFF',()=>{
 const candidate=original('t0','사과','사과','韓國',[]);
 candidate.options=[keep('사과')];
 for(const enabled of [false,true]){
  const cfg={hanjaReadingCheck:enabled,experimentalHanja:true,reviewPosFilter:false};
  const raw=literalOriginOption(candidate,'韓國',cfg);
  const verdict=validateExperimentalChoices([candidate],result('t0','韓國'),cfg);
  if(enabled){
   assert.equal(raw,null);
   assert.equal(verdict.accepted.length,0);
   assert.deepEqual(verdict.unresolved.map(t=>t.target_id),['t0']);
  }else{
   assert.equal(raw.origin_source,'model-unverified');
   assert.equal(verdict.accepted.length,1);
   assert.equal(verdict.accepted[0].option.replacement,'韓國');
  }
 }
});

test('reading check is absent from dictionary selection and disconnected dictionary recovery',()=>{
 const choice=readFileSync(new URL('../choice-review.js',import.meta.url),'utf8');
 const page=readFileSync(new URL('../content.js',import.meta.url),'utf8');
 assert.doesNotMatch(choice,/readingCompatibleModelChoice/);
 const off=page.indexOf('async function applyManualRecovery(');
 const stop=page.indexOf('function panelStatus(',off);
 assert.ok(off>0&&stop>off);
 const recovery=page.slice(off,stop);
 assert.doesNotMatch(recovery,/validateModelHanjaReadings/);
 assert.match(page,/task\.manualBackup\?\.hanjaReadingCheck===true/);
});

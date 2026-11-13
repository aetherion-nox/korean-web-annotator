import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateModelHanjaReadings} from '../hanja-reading-check.js';
import {literalOriginOption,explainLiteralOriginRejection} from '../experimental-options.js';
import {validateExperimentalChoices} from '../choice-review.js';
import {analyzeWithoutDictionary} from '../no-dictionary-analysis.js';
import {validateSegmentationRepairs} from '../segmentation-repairs.js';
import {engineConfig,projectAnnotation} from '../local-engine.js';

const hanja=(surface,replacement)=>[{start:0,end:surface.length,surface,replacement,type:'hanja'}];
const target=(surface,morphology=[])=>({target_id:'t0',start:0,end:surface.length,surface,context:surface,morphology,
 options:[{choice_id:'KEEP',type:'keep',replacement:surface,entry_id:null,definitions:[]}]});
const cfg={experimentalHanja:true,hanjaReadingCheck:true};
test('reading verifier admits legitimate lexical readings and noninitial initial-sound reversals',()=>{
 for(const [surface,origin] of [
  ['어획량','漁獲量'],['대통령','大統領'],['비율','比率'],['금융','金融'],
  ['세금','稅金'],['불륜','不倫'],['등록','登錄'],['의료','醫療'],['입력','入力']
 ]){
  const result=validateModelHanjaReadings(surface,hanja(surface,origin));
  assert.notEqual(result.status,'mismatch',surface+': '+JSON.stringify(result));
 }
 assert.equal(validateModelHanjaReadings('가',hanja('가','韓')).status,'mismatch');
});
test('reading check defaults on but can be turned off without bypassing boundary/name guards',async()=>{
 globalThis.chrome={storage:{local:{get:async()=>({})}}};
 try{
  const normal=await engineConfig();
  assert.equal(normal.hanjaReadingCheck,true);
  chrome.storage.local.get=async()=>({hanjaReadingCheck:false});
  assert.equal((await engineConfig()).hanjaReadingCheck,false);
 }finally{delete globalThis.chrome;}
 const t=target('가');
 assert.equal(literalOriginOption(t,'韓',{experimentalHanja:true}),null);
 assert.equal(literalOriginOption(t,'韓',{experimentalHanja:true,hanjaReadingCheck:false})?.type,'hanja');
 assert.equal(explainLiteralOriginRejection(t,'韓',{experimentalHanja:true}),'hanja_reading_conflict');
 assert.equal(literalOriginOption({...t,proper_noun:true},'韓',{experimentalHanja:true,hanjaReadingCheck:false}),null);
 assert.equal(literalOriginOption(t,'韓字',{experimentalHanja:true,hanjaReadingCheck:false}),null);
 const html=await readFile(new URL('../options.html',import.meta.url),'utf8');
 assert.match(html,/<input id="hanjaReadingCheck" type="checkbox" checked/);
 const settings=await readFile(new URL('../engine-settings.js',import.meta.url),'utf8');
 assert.ok(settings.includes("hanjaReadingCheck:$('hanjaReadingCheck').checked"));
});
test('noun target builder no longer glues adjacent noun tokens; explicit suffix still joins',()=>{
 const text='회사소개기자채용';
 const tokens=[{position:0,length:2,str:'회사',tag:'NNG'},
  {position:2,length:2,str:'소개',tag:'NNG'},
  {position:4,length:2,str:'기자',tag:'NNG'},
  {position:6,length:2,str:'채용',tag:'NNG'}];
 assert.deepEqual(analyzeWithoutDictionary(text,tokens,{hanja:true,allowNoDictionary:true})
  .targets.map(t=>t.surface),['회사','소개','기자','채용']);
 const suffix=analyzeWithoutDictionary('선생님',[
  {position:0,length:2,str:'선생',tag:'NNG'},
  {position:2,length:1,str:'님',tag:'XSN'}
 ],{hanja:true,allowNoDictionary:true});
 assert.deepEqual(suffix.targets.map(t=>t.surface),['선생님']);
});
test('model-authored Hanja stem keeps explicit Korean suffix without inventing whole-word origin',()=>{
 const t=target('선생님',[
  {start:0,end:2,form:'선생',tag:'NNG'},
  {start:2,end:3,form:'님',tag:'XSN'}
 ]);
 const result=literalOriginOption(t,'先生',cfg);
 assert.equal(result?.replacement,'先生님');
 assert.deepEqual(projectAnnotation(t.context,{...t,...result}).map(a=>[a.surface,a.replacement]),[['선생','先生']]);
 assert.equal(literalOriginOption(target('선생님'),'先生',cfg),null,'never truncate without explicit suffix evidence');
 assert.equal(literalOriginOption(target('휴대폰'),'携帶',cfg),null,'native suffix heuristic cannot shorten a lexical loanword');
 const accepted=validateExperimentalChoices([t],{results:['先生']},cfg);
 assert.equal(accepted.accepted.length,1);
 assert.equal(accepted.experimentalAccepted,1);
});
test('invalid literal-origin choices report separate alignment, reading, mixed-script and protected-name causes',()=>{
 const t=target('가');
 for(const [choice_id,reason] of [
  ['韓','hanja_reading_conflict'],['韓字','hanja_alignment_or_boundary'],
  ['携帶phone','mixed_script_requires_segments'],['http://foo','loanword_mode_disabled']
 ]){
  assert.equal(explainLiteralOriginRejection(t,choice_id,{experimentalHanja:true}),reason,choice_id);
 }
 const res=validateExperimentalChoices([t],{results:['韓']},cfg);
 assert.equal(res.rejectionCounts.hanja_reading_conflict,1);
});
test('conflict-free empty-ID replacement can be safely normalized to add, not an overlapping replacement',()=>{
 const context='경제 컴퓨터',t={...target('경제'),context};
 const configs={smartSegmentation:true,context,repairModes:{loanword:true,hanja:false},
  repairScopes:new Map([['t0',{text:context,allTargets:[t],localAnnotations:[],protected_ranges:[],
   selected:[{start:0,end:context.length}]}]])};
 const repair={sentence_id:'s0',op:'replace',old_target_ids:[],start:3,end:6,
  surface:'컴퓨터',choice_id:'computer'};
 const good=validateSegmentationRepairs([t],{repairs:[repair]},configs);
 assert.equal(good.accepted.length,1,JSON.stringify(good.rejected));
 assert.equal(good.accepted[0].op,'add');
 assert.equal(good.accepted[0].normalizedFromEmptyReplace,true);
 const overlap=validateSegmentationRepairs([t],{repairs:[{...repair,start:0,end:2,surface:'경제'}]},configs);
 assert.equal(overlap.accepted.length,0);
 assert.ok(overlap.rejected.length);
});

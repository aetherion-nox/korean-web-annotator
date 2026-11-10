import {buildReviewPayload} from './review-payload.js';
import {literalOriginOption} from './experimental-options.js';
import {projectAnnotation} from './local-engine.js';

// Additional model decisions are an optional array in the SAME response.
// Each repair has exactly these fields (including [] for add):
// {sentence_id,op:"add"|"replace"|"delete",old_target_ids:[],start,end,
//  surface,choice_id:"KEEP"|literal Hanja|literal Latin original}.
// All positions are UTF-16 offsets in sentences[].text. A repair replaces
// its referenced original targets atomically; results[] still includes them.
export const SMART_SEGMENTATION_INSTRUCTIONS = [
 'Kiwi tokenization and target boundaries are proposals, not ground truth. Inspect the full original text in sentences, including gaps without targets. Check incorrect splits, merges, POS, stems, particles, endings and missing words.',
 'Keep the ordinary results decision for EVERY target, even one you repair. Only for actual boundary/omission errors, also return repairs (or omit it when none): each repair has exactly sentence_id,op,old_target_ids,start,end,surface,choice_id.',
 'add: old_target_ids=[] for an omitted word not overlapping an existing target; replace: list every old target_id being replaced, to merge/split/shift its span; delete: old_target_ids identifying a wrong target and choice_id="KEEP". For replace and add choose the true Hanja spelling, real Latin-script borrowed original, or KEEP. A repaired word is independent of its old dictionary choices.',
 'Use only sentence_id from sentences and target_id from targets. start/end are UTF-16 offsets into that exact sentences[].text, and surface must equal the original substring; do not alter the source. Preserve word boundaries, particles, inflection and spaces. Never invent uncertain etymologies or personal-name characters; use KEEP for uncertain or modern person names. Do not repeat unchanged tokenization.'
].join('\n');

const HANGUL_SPAN=/^[가-힣]+(?: [가-힣]+){0,3}$/u;
const overlaps=(a,b)=>a.start<b.end&&b.start<a.end;
const isInt=Number.isInteger;

export function validateSegmentationRepairs(targets,response,config={}){
 const accepted=[],rejected=[];
 if(!config.smartSegmentation)return {accepted,rejected};
 if(response?.repairs===undefined)return {accepted,rejected};
 const rows=response?.repairs;
 if(!Array.isArray(rows))return {accepted,rejected:[{index:-1,reason:'repairs must be an array'}]};
 if(rows.length>Math.min(256,Math.max(48,targets.length*3)))
  return {accepted,rejected:[{index:-1,reason:'too many repairs'}]};
 const payload=buildReviewPayload(config.context||'',targets,config).payload;
 const byId=new Map(targets.map((target,i)=>[target.target_id,{...target,sentence_id:payload.targets[i]?.sentence_id}]));
 const bySentence=new Map(payload.sentences.map(s=>[s.sentence_id,s]));
 const scopeFor=id=>config.repairScopes?.get(id);
 const prepared=[];
 const fail=(index,reason,row)=>rejected.push({index,reason,old_target_ids:Array.isArray(row?.old_target_ids)?row.old_target_ids.filter(x=>typeof x==='string'):[]});
 for(const [index,row] of rows.entries()){
  if(!row||typeof row!=='object'||Array.isArray(row)){
   fail(index,'repair must be an object',row);continue;
  }
  const required=['choice_id','end','old_target_ids','op','sentence_id','start','surface'];
  if(Object.keys(row).sort().join(',')!==required.join(',')){
   fail(index,'repair fields do not match schema',row);continue;
  }
  const {sentence_id,op,old_target_ids,start,end,surface,choice_id}=row;
  const sentence=bySentence.get(sentence_id);
  if(!sentence||!['add','replace','delete'].includes(op)||!Array.isArray(old_target_ids)||
     !old_target_ids.every(x=>typeof x==='string')||new Set(old_target_ids).size!==old_target_ids.length||
     !isInt(start)||!isInt(end)||start<0||end<=start||end>sentence.text.length||
     typeof surface!=='string'||sentence.text.slice(start,end)!==surface||
     !HANGUL_SPAN.test(surface)||surface.length>90||typeof choice_id!=='string'){
   fail(index,'unknown sentence, invalid operation, source span, or choice',row);continue;
  }
  if(op==='add'?old_target_ids.length!==0:old_target_ids.length<1||old_target_ids.length>12){
   fail(index,'old target ID count invalid for operation',row);continue;
  }
  if(op==='delete'&&choice_id!=='KEEP'){
   fail(index,'delete requires KEEP',row);continue;
  }
  const old=old_target_ids.map(id=>byId.get(id));
  if(old.some(t=>!t||t.scan_only||t.sentence_id!==sentence_id)){
   fail(index,'old target missing, scan-only or not in the same sentence/batch',row);continue;
  }
  const anchor=old[0]||[...byId.values()].find(t=>t.sentence_id===sentence_id);
  const scope=anchor?scopeFor(anchor.target_id):null;
  if(!scope||scope.text!==sentence.text){
   fail(index,'repair scope unavailable',row);continue;
  }
  if(scope.selected?.length&&!scope.selected.some(r=>start>=r.start&&end<=r.end)){
   fail(index,'outside the selected source text',row);continue;
  }
  const span={start,end};
  if(op==='delete'){
   if(start!==Math.min(...old.map(t=>t.start))||end!==Math.max(...old.map(t=>t.end))){
    fail(index,'delete must cover the exact referenced target envelope',row);continue;
   }
  }else if(op==='replace'&&!old.every(t=>overlaps(span,t))){
   fail(index,'replacement does not intersect every referenced old target',row);continue;
  }
  // Every source target intersecting this new span must be referenced (add
  // cannot shadow one). Never override an already-applied repair silently.
  const oldNative=new Set(old.map(t=>t.original_target_id||t.target_id));
  if((scope.allTargets||[]).some(t=>overlaps(span,t)&&!oldNative.has(t.target_id))||
     (scope.localAnnotations||[]).some(a=>overlaps(span,a))||
     (scope.existingRepairs||[]).some(r=>overlaps(span,r)||r.old_target_ids?.some(id=>oldNative.has(id)))){
   fail(index,'source conflicts with another target, local annotation or prior repair',row);continue;
  }
  const protectedRange=(scope.protected_ranges||[]).some(([a,b])=>start<b&&a<end);
  if(choice_id!=='KEEP'&&protectedRange){
   fail(index,'protected name or proper noun',row);continue;
  }
  let annotations=[];
  if(choice_id!=='KEEP'){
   // Repaired words do not need a dictionary choice. The source-alignment
   // and character checks still run through the existing projection routine.
   const virtual={target_id:'repair',start,end,surface,context:sentence.text,
     options:[{choice_id:'KEEP',type:'keep',replacement:surface,definitions:[],entry_id:null}]};
   const option=literalOriginOption(virtual,choice_id,{
    experimentalHanja:config.repairModes?.hanja===true,
    experimentalLoanword:config.repairModes?.loanword===true
   });
   if(!option){
    fail(index,'unreliable script, missing mode, or Hanja alignment',row);continue;
   }
   try{annotations=projectAnnotation(sentence.text,{...virtual,...option});}
   catch{fail(index,'source-to-origin projection failed',row);continue;}
  }
  prepared.push({index,sentence_id,op,old_target_ids,source_target_ids:[...oldNative],start,end,surface,choice_id,annotations,
   sentenceKey:anchor.repair_sentence_key});
 }
 // A malformed sibling must never cause a partial split to consume the
 // original target. Conflicting rows invalidate the entire connected group.
 const bad=new Set();
 for(let i=0;i<prepared.length;i++)for(let j=i+1;j<prepared.length;j++){
  const a=prepared[i],b=prepared[j];
  if(a.sentence_id!==b.sentence_id)continue;
  const shared=a.old_target_ids.some(id=>b.old_target_ids.includes(id));
  if(overlaps(a,b)||(shared&&(a.op==='delete'||b.op==='delete'))){
   bad.add(a.index);bad.add(b.index);
  }
 }
 for(const r of prepared)if(rejected.some(badRow=>badRow.old_target_ids?.some(id=>r.old_target_ids.includes(id))))bad.add(r.index);
 // Propagate a conflicting split to all sibling repairs sharing old targets.
 let changed=true;
 while(changed){
  changed=false;
  for(const a of prepared)for(const b of prepared){
   if(!bad.has(a.index)&&bad.has(b.index)&&a.old_target_ids.some(id=>b.old_target_ids.includes(id))){
    bad.add(a.index);changed=true;
   }
  }
 }
 for(const r of prepared){
  if(bad.has(r.index)){fail(r.index,'repair conflicts with a sibling or shares a malformed split',r);continue;}
  accepted.push(r);
 }
 return {accepted,rejected};
}

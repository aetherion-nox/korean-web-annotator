// Additional model decisions are an optional array in the SAME response.
// Each repair has exactly these fields (including [] for add):
// {sentence_id,op:"add"|"replace"|"delete",old_target_ids:[],start,end,
//  surface,choice_id:literal Hanja|literal Latin original (or KEEP for legacy delete).
// All positions are UTF-16 offsets in sentences[].text. A repair replaces
// its referenced original targets atomically; results[] may omit them.
const HANGUL_SPAN=/^[가-힣]+(?: [가-힣]+){0,3}$/u;
const overlaps=(a,b)=>a.start<b.end&&b.start<a.end;
const isInt=Number.isInteger;

export function validateSegmentationRepairsCore(targets,response,config={}){
 const accepted=[],rejected=[];
 if(!config.smartSegmentation)return {accepted,rejected};
 if(response?.repairs===undefined)return {accepted,rejected};
 const rows=response?.repairs;
 if(!Array.isArray(rows))return {accepted,rejected:[{index:-1,reason:'repairs must be an array'}]};
 const maxRows=Math.min(256,Math.max(48,targets.length*3));
 for(let index=maxRows;index<rows.length;index++)
  rejected.push({index,reason:'repair exceeds per-batch limit',old_target_ids:[]});
 const payload=config.payload;
 if(!payload?.targets||!payload?.sentences)return {accepted,rejected:[{index:-1,reason:'repair source payload unavailable',old_target_ids:[]}]};
 const byId=new Map(targets.map((target,i)=>[target.target_id,{...target,sentence_id:payload.targets[i]?.sentence_id}]));
 const bySentence=new Map(payload.sentences.map(s=>[s.sentence_id,s]));
 const scopeFor=id=>config.repairScopes?.get(id);
 const prepared=[];
 const fail=(index,reason,row)=>rejected.push({index,reason,old_target_ids:Array.isArray(row?.old_target_ids)?row.old_target_ids.filter(x=>typeof x==='string'):[]});
 for(const [index,row] of rows.slice(0,maxRows).entries()){
  if(!row||typeof row!=='object'||Array.isArray(row)){
   fail(index,'repair must be an object',row);continue;
  }
  const required=['choice_id','end','old_target_ids','op','sentence_id','start','surface'];
  const actual=Object.keys(row).sort().join(',');
  // A delete may omit choice_id; legacy delete/KEEP remains supported.
  if(actual!==required.join(',')&&
     !(row.op==='delete'&&actual==='end,old_target_ids,op,sentence_id,start,surface')){
   fail(index,'repair fields do not match schema',row);continue;
  }
  let {sentence_id,op,old_target_ids,start,end,surface,choice_id='KEEP'}=row;
  const sentence=bySentence.get(sentence_id);
  if(!sentence||!['add','replace','delete'].includes(op)||!Array.isArray(old_target_ids)||
     !old_target_ids.every(x=>typeof x==='string')||new Set(old_target_ids).size!==old_target_ids.length||
     !isInt(start)||!isInt(end)||start<0||end<=start||end>sentence.text.length||
     typeof surface!=='string'||
     !/[가-힣]/u.test(surface)||surface.length>300||
     (choice_id!=='KEEP'&&(!HANGUL_SPAN.test(surface)||surface.length>90))||
     typeof choice_id!=='string'){
   fail(index,'unknown sentence, invalid operation, source span, or choice',row);continue;
  }
  // Models are frequently off by one UTF-16 position. Correct only a
  // UNIQUE exact source occurrence in a narrow +/-8 UTF-16 window.
  let offset_corrected=false;
  if(sentence.text.slice(start,end)!==surface){
   const matches=[];let next=sentence.text.indexOf(surface,Math.max(0,start-8));
   while(next>=0&&next<=Math.min(sentence.text.length,start+8)){
    matches.push(next);next=sentence.text.indexOf(surface,next+1);
   }
   if(matches.length!==1){fail(index,'source offset incorrect or ambiguous',row);continue;}
   start=matches[0];end=start+surface.length;offset_corrected=true;
  }
  // An omitted word with empty old_target_ids can only be an ADD; the
  // ordinary overlap, selection, name and word-boundary checks below
  // remain mandatory. Never reinterpret a conflicting target replacement.
  const normalizedFromEmptyReplace=op==='replace'&&old_target_ids.length===0;
  if(normalizedFromEmptyReplace)op='add';
  if(op==='add'?old_target_ids.length!==0:old_target_ids.length<1||old_target_ids.length>12){
   fail(index,'old target ID count invalid for operation',row);continue;
  }
  if(op==='add'&&choice_id==='KEEP'){
   fail(index,'add requires a real Hanja or borrowed-language origin; omit native text',row);continue;
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
  // A KEEP replacement must not consume unrelated text outside the old
  // target envelope. A multi-fragment replace must account for every old
  // Hangul character (checked transactionally below).
  if(op==='replace'&&choice_id==='KEEP'&&
     (start<Math.min(...old.map(t=>t.start))||end>Math.max(...old.map(t=>t.end)))){
   fail(index,'KEEP replacement extends beyond old target',row);continue;
  }
  // Every source target intersecting this new span must be referenced (add
  // cannot shadow one). Never override an already-applied repair silently.
  const oldNative=new Set(old.map(t=>t.original_target_id||t.target_id));
  if((scope.allTargets||[]).some(t=>overlaps(span,t)&&!oldNative.has(t.target_id))||
     (scope.localAnnotations||[]).some(a=>overlaps(span,a))||
     (scope.existingRepairs||[]).some(r=>overlaps(span,r)||r.source_target_ids?.some(id=>oldNative.has(id))||r.old_target_ids?.some(id=>oldNative.has(id)))){
   fail(index,'source conflicts with another target, local annotation or prior repair',row);continue;
  }
  const protectedRange=(scope.protected_ranges||[]).some(([a,b])=>start<b&&a<end)||
   old.some(t=>t.proper_noun===true||t.suspected_person_name===true||
    t.dictionary_person_name===true||t.dictionary_name_homograph===true);
  if(choice_id!=='KEEP'&&protectedRange){
   fail(index,'protected name or proper noun',row);continue;
  }
  let annotations=[];
  if(choice_id!=='KEEP'){
   // Caller validates the actual origin and returns exact source spans.
   // A missing verifier cannot authorize an annotation.
   try{
    const verified=config.verifyOrigin?.({start,end,surface,choice_id,sentence,config});
    if(!Array.isArray(verified)||!verified.length){
     fail(index,'unreliable script, missing mode, pronunciation or alignment',row);continue;
    }
    annotations=verified;
   }catch{fail(index,'source-to-origin projection failed',row);continue;}
  }
  prepared.push({index,sentence_id,op,old_target_ids,source_target_ids:[...oldNative],start,end,surface,choice_id,annotations,
   sentenceKey:anchor.repair_sentence_key,offset_corrected,normalizedFromEmptyReplace});
 }
 // A malformed sibling must never cause a partial split to consume the
 // original target. Conflicting rows invalidate the entire connected group.
 const bad=new Set(),badReasons=new Map();
 for(let i=0;i<prepared.length;i++)for(let j=i+1;j<prepared.length;j++){
  const a=prepared[i],b=prepared[j];
  if(a.sentence_id!==b.sentence_id)continue;
  const shared=a.old_target_ids.some(id=>b.old_target_ids.includes(id));
  if(overlaps(a,b)||(shared&&(a.op==='delete'||b.op==='delete'))){
   bad.add(a.index);bad.add(b.index);
  }
 }
 for(const r of prepared)if(rejected.some(badRow=>badRow.old_target_ids?.some(id=>r.old_target_ids.includes(id))))bad.add(r.index);
 // A validated repair retires every referenced old target atomically.
 // Unchanged Korean suffixes, particles and other gaps remain in the DOM
 // naturally; no artificial KEEP fragment is required.

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
  if(bad.has(r.index)){fail(r.index,badReasons.get(r.index)||'repair conflicts with a sibling or shares a malformed split',r);continue;}
  accepted.push(r);
 }
 return {accepted,rejected};
}

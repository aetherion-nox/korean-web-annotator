// Shared pure review verifier: used by the model worker AND the isolated
// browser content script. Never allow a schema-only decision to write text.
(function(root){
 'use strict';
 const HANGUL=/^[가-힣]{1,24}$/u;
 const CJK=/^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{323af}]+$/u;
 const FOREIGN=/^[\p{L}\p{M}\p{N} .,'’+\-/&]{1,100}$/u;
 const FORBIDDEN=/[\p{Script=Hangul}\p{Script=Han}]/u;
 const allowed=(item,keys)=>item&&typeof item==='object'&&!Object.keys(item).some(k=>!keys.includes(k));
 const fail=(code,message)=>({ok:false,code,message});
 const pass=(value,normalizedRow)=>({ok:true,value,normalizedRow});
 const modality=(config,type)=>type==='hanja'?config.allowModelHanja===true:config.allowModelLoanword===true;
 function canonicalize(target,raw){
  if(typeof target?.surface!=='string'||!Array.isArray(raw))return null;
  const source=target.surface,parts=[];let cursor=0;
  for(const segment of raw){
   if(!allowed(segment,['start','end','surface','type','replacement'])||
      !Number.isInteger(segment.start)||!Number.isInteger(segment.end)||
      segment.end<=segment.start||typeof segment.surface!=='string'||
      !/^[가-힣]+$/u.test(segment.surface))return null;
   let start=segment.start,end=segment.end;
   if(start<0||end>source.length||source.slice(start,end)!==segment.surface){
    start=source.indexOf(segment.surface);
    if(start<0||source.indexOf(segment.surface,start+1)!==-1)return null;
    end=start+segment.surface.length;
   }
   if(start<cursor||end>source.length)return null;
   parts.push({...segment,start,end});cursor=end;
  }
  return parts;
 }
 function matchingOrigin(target,part){
  return (target.component_candidates||[]).some(c=>c.start===part.start&&c.end===part.end&&c.surface===part.surface&&
   (c.options||[]).some(o=>o.entry_id!=null&&o.type===part.type&&o.replacement===part.replacement&&
    (!o.written_form||o.written_form.replace(/[-^ ]/gu,'')===part.surface)));
 }
 function groundedSyllable(target,part){
  if(!matchingOrigin(target,part))return false;
  const tokens=Array.isArray(target.morphology)?target.morphology:[];
  const nominal=tokens.some(t=>t.start===part.start&&t.end===part.end&&
    ['NNG','NNB','NR'].includes(String(t.tag||'').split('-')[0]));
  if(!nominal)return false;
  const modifier=tokens.some(t=>t.end===part.start&&
    ['MM','NR','ETM'].includes(String(t.tag||'').split('-')[0]));
  const ending=tokens.some(t=>t.start===part.end&&
    (/^J/u.test(String(t.tag||''))||['EP','EF','EC','ETM','ETN'].includes(String(t.tag||'').split('-')[0])));
  // True adjectival/determiner + nominal compounds can end on the noun;
  // noun + grammatical case particles is also an independently seen word.
  return modifier||ending;
 }
 function generatedSimple(target,row,config={}){
  if(!row||!['GEN_HANJA','GEN_LOANWORD'].includes(row.choice_id)||
    !allowed(row,['target_id','choice_id','replacement','confidence','evidence'])||
    row.confidence!=='high'||typeof row.evidence!=='string'||
    !row.evidence.trim()||row.evidence.length>240)
    return fail('GENERATED_SCHEMA','生成词源的字段、置信度或证据不符合协议');
  const type=row.choice_id==='GEN_HANJA'?'hanja':'loanword',replacement=row.replacement;
  if(!modality(config,type))return fail('MODE_DISABLED','当前模式不允许生成此类型的词源');
  if(!HANGUL.test(target?.surface)||typeof replacement!=='string'||
    replacement!==replacement.trim()||replacement!==replacement.normalize('NFC'))
    return fail('INVALID_SOURCE','原文或 replacement 格式无效');
  if(type==='hanja'&&(!CJK.test(replacement)||Array.from(replacement).length!==Array.from(target.surface).length))
    return fail('HANJA_ALIGNMENT','汉字与韩文字音节必须一对一对齐');
  if(type==='loanword'&&(!FOREIGN.test(replacement)||FORBIDDEN.test(replacement)||
    !/[\p{L}]/u.test(replacement)||replacement===target.surface))
    return fail('LOANWORD_ORIGIN','外来语 replacement 必须为合法的原语写法');
  const value={choice_id:row.choice_id,type,replacement,entry_id:null,definitions:[],
    generated:true,confidence:'high',evidence:row.evidence.trim()};
  return pass(value,{target_id:row.target_id,choice_id:row.choice_id,replacement,
    confidence:'high',evidence:row.evidence.trim()});
 }
 function generatedSegments(target,row,config={}){
  if(!target?.segmentation_review||!row||row.choice_id!=='GEN_SEGMENTS'||
    typeof row.target_id!=='string'||!allowed(row,['target_id','choice_id','segments','confidence','evidence'])||
    !Array.isArray(row.segments)||!row.segments.length||row.segments.length>8||
    row.confidence!=='high'||typeof row.evidence!=='string'||!row.evidence.trim()||row.evidence.length>240)
    return fail('SEGMENT_SCHEMA','GEN_SEGMENTS 的字段、1–8 个片段、置信度或证据不符合协议');
  if(!HANGUL.test(target.surface))return fail('SEGMENT_SOURCE','完整词段须为 1–24 个连续谚文字');
  const aligned=canonicalize(target,row.segments);
  if(!aligned)return fail('SEGMENT_OFFSETS','子词的 surface 无法在原文中唯一定位，或有越界／重叠');
  const parts=[];
  for(const part of aligned){
   if(!['hanja','loanword'].includes(part.type)||typeof part.replacement!=='string')
    return fail('SEGMENT_TYPE','子词 type／replacement 无效');
   // A verbatim replacement is an identity operation, not a Hanja annotation.
   // Dropping it is lossless and avoids discarding valid neighboring segments.
   if(part.replacement===part.surface)continue;
   const simple=generatedSimple({surface:part.surface},{
    target_id:row.target_id,choice_id:part.type==='hanja'?'GEN_HANJA':'GEN_LOANWORD',
    replacement:part.replacement,confidence:'high',evidence:row.evidence
   },config);
   if(!simple.ok)return fail(simple.code,'子词 '+part.surface+'：'+simple.message);
   parts.push(part);
  }
  if(target.name_risk===true&&parts.some(p=>p.type==='loanword')&&
     !parts.every(p=>matchingOrigin(target,p)))
    return fail('NAME_RISK','疑似专名不能只根据音近生成未收录的外语词源');
  for(let i=0;i<parts.length;i++){
   const part=parts[i];
   if(part.end-part.start!==1)continue;
   const previous=parts[i-1],next=parts[i+1];
   const attached=(previous&&previous.end===part.start)||(next&&part.end===next.start);
   if(!attached&&!groundedSyllable(target,part))
    return fail('ISOLATED_SYLLABLE','单音节 '+part.surface+' 缺少独立名词边界或相符词典来源');
  }
  if(!parts.length)return pass({choice_id:'KEEP',type:'keep',replacement:target.surface,
    entry_id:null,definitions:[]},{target_id:row.target_id,choice_id:'KEEP'});
  let replacement=target.surface;
  for(const part of [...parts].reverse())replacement=replacement.slice(0,part.start)+part.replacement+replacement.slice(part.end);
  const value={choice_id:'GEN_SEGMENTS',type:'mixed',replacement,segments:parts,
    entry_id:null,definitions:[],generated:true,segmentationGenerated:true,
    confidence:'high',evidence:row.evidence.trim()};
  return pass(value,{target_id:row.target_id,choice_id:'GEN_SEGMENTS',segments:parts,
    confidence:'high',evidence:row.evidence.trim()});
 }
 function bindingRow(binding,row,modes={}){
  if(!binding||!row||typeof row!=='object'||row.target_id!==binding.target_id)
   return fail('TARGET_ID','结果 target_id 不属于当前审核目标');
  const choice=(binding.choices||[]).find(o=>o.choice_id===row.choice_id);
  if(choice){
   if(!allowed(row,['target_id','choice_id']))return fail('DICTIONARY_FIELDS','词典选项不应包含模型生成字段');
   const safe=(binding.boundaryUnverified||binding.partialWord)&&row.choice_id!=='KEEP'&&choice.annotations?.length;
   const normalizedChoice=safe?{choice_id:'KEEP',annotations:[]}:choice;
   return pass(normalizedChoice,{target_id:row.target_id,choice_id:normalizedChoice.choice_id});
  }
  const authorized=binding.generatedChoices||[];
  if(!authorized.includes(row.choice_id))
   return fail('INVALID_CHOICE','当前目标 '+binding.surface+' 不允许 '+String(row.choice_id));
  const config={allowModelHanja:modes.hanja===true,allowModelLoanword:modes.loanword===true};
  const target={surface:binding.surface,segmentation_review:binding.segmentationReview,
    component_candidates:binding.componentCandidates||[],morphology:binding.morphology||[],
    name_risk:binding.nameRisk===true};
  const result=row.choice_id==='GEN_SEGMENTS'?generatedSegments(target,row,config):
    generatedSimple(target,row,config);
  if(!result.ok)return result;
  const value=result.value;
  const annotations=value.choice_id==='GEN_SEGMENTS'?
    value.segments.map(p=>({start:binding.start+p.start,end:binding.start+p.end,
      surface:p.surface,type:p.type,replacement:p.replacement})):
    value.choice_id==='KEEP'?[]:[{start:binding.start,end:binding.end,
      surface:binding.surface,type:value.type,replacement:value.replacement}];
  return pass({choice_id:value.choice_id,annotations},result.normalizedRow);
 }
 root.KRA_REVIEW_VALIDATION_CORE=Object.freeze({
  canonicalizeGeneratedSegments:canonicalize,groundedIsolatedSyllable:groundedSyllable,
  validateGeneratedRow:generatedSimple,validateGeneratedSegmentsRow:generatedSegments,
  validateBindingRow:bindingRow
 });
})(globalThis);

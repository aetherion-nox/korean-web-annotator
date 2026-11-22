// Diagnostic-only inspection of direct Hanja spellings. Never changes or
// substitutes model answers, dictionary choices or final safety decisions.
import {literalOriginOption,explainLiteralOriginRejection} from './experimental-options.js';

const HAN=/\p{Script=Han}/u;
const MAX_SAMPLES=12;
export function summarizeExperimentalHanjaAnswers(targets,response,config={}){
 const out={proposed:0,accepted:0,rejected:0,reasons:{},samples:[]};
 if(config.experimentalHanja!==true||!Array.isArray(response?.results))return out;
 const byId=new Map(targets.map(t=>[t.target_id,t]));
 const grouped=new Map();
 for(const row of response.results){
  if(!row||typeof row!=='object'||Array.isArray(row)||
     Object.keys(row).sort().join(',')!=='c,t'||
     typeof row.t!=='string'||!byId.has(row.t)||
     !(row.c===null||typeof row.c==='string'&&row.c.trim().length>0))continue;
  const rows=grouped.get(row.t)||[];
  rows.push(row);grouped.set(row.t,rows);
 }
 for(const [id,rows] of grouped){
  const target=byId.get(id);
  const values=new Set(rows.map(r=>r.c)); // identical choices count once
  for(const choice of values){
   if(typeof choice!=='string'||!HAN.test(choice))continue;
   // Dictionary-backed personal-name spellings are not generated origins.
   if(target.options?.some(o=>o.type!=='keep'&&o.choice_id===choice)||
      target.dictionary_person_name===true&&target.verified_person_hanja?.includes(choice))continue;
   out.proposed++;
   let reason='';
   if(values.size>1)reason='conflicting_well_formed_answers';
   else if(literalOriginOption(target,choice,config)){out.accepted++;continue;}
   else reason=explainLiteralOriginRejection(target,choice,config);
   out.rejected++;
   out.reasons[reason]=(out.reasons[reason]||0)+1;
   if(out.samples.length<MAX_SAMPLES)out.samples.push({
    target_id:id,surface:String(target.surface||'').slice(0,40),
    proposed_hanja:choice.slice(0,60),reason
   });
  }
 }
 return out;
}

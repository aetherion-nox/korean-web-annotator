// Task-local vocabulary for explicit Hangul(漢字) statements on the same page.
// This module deliberately NEVER changes the imported dictionary, persisted
// paragraph cache, shared dictionary review cache or page's source text.
import {extractInlineHanjaPairs} from './inline-hanja-evidence.js';
import {validateModelHanjaReadings} from './hanja-reading-check.js';

const MAX_TERMS=512,MAX_VARIANTS_PER_TERM=4,MAX_CITATIONS=2;
const MAX_TERM_LENGTH=24;
const PARTICLES=new Set([
 '','은','는','이','가','을','를','의','에','에서','에게','에게서','께','께서',
 '도','만','부터','까지','보다','처럼','만큼','조차','마저','밖에','와','과',
 '랑','이랑','하고','로','으로','로부터','으로부터','한테','한테서',
 '라도','이라도','나','이나','라고','이라고','로서','으로서','로써','으로써',
 '에는','에도','에서만','까지도','부터도','에게도','한테도','에서도',
 '이고','이며','이다','입니다','이었다','였다','인데','이라','이라면',
 '이라는','라는','이라고는','이라고도','이라고만','라는','이라는','이라서'
]);

const LABEL='本文汉字括注（本次标注任务临时词源候选，非原词典释义）：';
const noChange=analysis=>({analysis,stats:{newTargets:0,newChoices:0,enhancedChoices:0,skipped:0}});
const eligibleSelection=(selected,start,end)=>
 !selected||selected.some(r=>start>=r.start&&end<=r.end);

function addRootTerm(root,surface){
 let node=root;
 for(const character of surface){
  if(!node.has(character))node.set(character,new Map());
  node=node.get(character);
 }
 node.set('',surface);
}
function lookupLongestPrefix(root,run){
 let node=root,matched=null;
 for(const letter of run){
  node=node.get(letter);
  if(!node)break;
  const term=node.get('');
  if(term&&PARTICLES.has(run.slice(term.length)))matched=term;
 }
 return matched;
}

/**
 * In contrast to the old whole-page pre-scan, production starts with an EMPTY
 * glossary and learns a pair only on encountering its actual source span.
 * All state is allocated inside one runSentencePipeline invocation.
 */
export function createSessionHanjaGlossary(){
 return {entries:new Map(),root:new Map(),observed:0,terms:0,variants:0,conflicts:0};
}

function ingestPair(glossary,pair,paragraphIndex){
 const {surface,hanja,citation}=pair;
 if(typeof surface!=='string'||typeof hanja!=='string'||!surface||
    surface.length>MAX_TERM_LENGTH)return false;
 // An author's parenthesis is direct source markup, but it is not a safe
 // reusable etymology when its Hanja contradicts the adjacent Hangul.
 // Leave the source pair unchanged on the page; suppress only propagation.
 if(validateModelHanjaReadings(surface,[{
   type:'hanja',start:0,end:surface.length,surface,replacement:hanja
  }]).status==='mismatch')return false;
 let variants=glossary.entries.get(surface);
 if(!variants){
  if(glossary.entries.size>=MAX_TERMS)return false;
  variants=new Map();glossary.entries.set(surface,variants);
  addRootTerm(glossary.root,surface);
  glossary.terms++;
 }
 let record=variants.get(hanja);
 if(!record){
  if(variants.size>=MAX_VARIANTS_PER_TERM)return false;
  record={surface,hanja,citations:[],evidence:[],occurrences:0};
  if(variants.size===1)glossary.conflicts++;
  variants.set(hanja,record);glossary.variants++;
 }
 record.occurrences++;
 glossary.observed++;
 // Store a small, chronological evidence trail per spelling. Each citation
 // records when its closing parenthesis becomes available to later text.
 if(record.evidence.length<MAX_CITATIONS&&
    !record.evidence.some(e=>e.citation===citation&&e.paragraphIndex===paragraphIndex)){
  record.evidence.push({citation,paragraphIndex,after:pair.parenthesisEnd??pair.end});
  record.citations.push(citation);
 }
 return true;
}

/**
 * Consume only explicit, safely applied local Hanja annotations, in document
 * order. Skipped/overlapping source pairs must not pollute the glossary.
 * The source's introduction point is the closing parenthesis, not the
 * beginning of its Hangul word.
 */
export function learnSessionHanjaGlossary(text,analysis,glossary,{
 paragraphIndex=0,pairs=null,selected=null
}={}){
 if(!glossary||!Array.isArray(analysis?.annotations))return 0;
 pairs=pairs||extractInlineHanjaPairs(text);
 const annotationIndex=new Map(analysis.annotations.filter(a=>
  a.type==='hanja'&&typeof a.replacement==='string').map(a=>[
   a.start+':'+a.end+':'+a.replacement,true
  ]));
 let learned=0;
 for(const pair of pairs){
  if(!eligibleSelection(selected,pair.start,pair.end))continue;
  if(!annotationIndex.has(pair.start+':'+pair.end+':'+pair.hanja))continue;
  if(ingestPair(glossary,pair,paragraphIndex))learned++;
 }
 return learned;
}

/**
 * Kept as a standalone test-data helper for dictionary option/format tests.
 * Production never calls this: runSentencePipeline uses the incremental
 * create/learn functions above, and does not pre-scan a complete document.
 */
export function buildSessionHanjaGlossary(sentences,{context,restrictToSelection=false}={}){
 const glossary=createSessionHanjaGlossary();
 if(!restrictToSelection&&typeof context==='string'&&context.length){
  for(const pair of extractInlineHanjaPairs(context))ingestPair(glossary,pair,-1);
 }else for(const sentence of sentences||[]){
  for(const pair of extractInlineHanjaPairs(sentence.text)){
   if(restrictToSelection&&!eligibleSelection(sentence.selected,pair.start,pair.end))continue;
   ingestPair(glossary,pair,-1);
  }
 }
 return glossary;
}

function sourceOptions(variants,surface,suffix='',paragraphIndex=null,at=null){
 const options=[];
 for(const record of variants.values()){
  const eligible=paragraphIndex===null?record.citations:
   record.evidence.filter(e=>
    e.paragraphIndex<paragraphIndex||
    e.paragraphIndex===paragraphIndex&&e.after<=at).map(e=>e.citation);
  if(!eligible.length)continue;
  options.push({type:'hanja',replacement:record.hanja+suffix,
   entry_id:'session-inline-hanja:'+surface+':'+record.hanja,
   written_form:surface,
   definitions:eligible.map(citation=>LABEL+citation)});
 }
 return options;
}

/**
 * Inject article-derived origin candidates for matching occurrences. Existing
 * dictionary options are retained and compete normally, with matching
 * spelling receiving citation evidence. New targets are only created at
 * conservative whole-Hangul-run boundaries (optional recognized particles).
 * A model must still disambiguate every non-parenthesized occurrence.
 */
export function applySessionHanjaGlossary(text,analysis,glossary,{selected=null,paragraphIndex=null}={}){
 if(!glossary?.entries?.size||!Array.isArray(analysis?.targets)||!Array.isArray(analysis?.annotations))
  return noChange(analysis);
 let changed=false,newTargets=0,newChoices=0,enhancedChoices=0,skipped=0;
 const targets=analysis.targets.map(t=>({...t,options:[...t.options]}));
 const usedIds=new Set(targets.map(t=>t.target_id));
 const spans=[...targets,...analysis.annotations].sort((a,b)=>a.start-b.start||a.end-b.end);
 // The trusted local analysis has non-overlapping, ordered ranges. Binary
 // search avoids scanning all 1,000+ targets for every Korean word in an
 // article. Synthesized targets arrive in source order.
 let addedLastEnd=-1;
 const hasOtherOverlap=(start,end,owner)=>{
  let low=0,high=spans.length;
  while(low<high){const mid=(low+high)>>1;
   if(spans[mid].start<end)low=mid+1;else high=mid;
  }
  const last=spans[low-1];
  if(last&&last!==owner&&last.end>start)return true;
  if(last===owner&&low>1&&spans[low-2].end>start)return true;
  return addedLastEnd>start&&owner===undefined;
 };
 const byStart=new Map();
 for(const t of targets){
  const list=byStart.get(t.start)||[];list.push(t);byStart.set(t.start,list);
 }
 const beforeProtected=analysis.repair_context?.protected_ranges||[];
 const overlapsProtected=(start,end)=>
  beforeProtected.some(r=>Array.isArray(r)&&r[0]<end&&start<r[1]);

 for(const run of text.matchAll(/[가-힣]+/gu)){
  const word=run[0],start=run.index;
  // Do not recognize the Korean half of an alphanumeric identifier as a
  // standalone word, including e.g. 백영관A, 1백영관 or 백영관2.
  if(start>0&&/[\p{L}\p{N}]/u.test(text[start-1])||
     start+word.length<text.length&&/[\p{L}\p{N}]/u.test(text[start+word.length])){
   skipped++;continue;
  }
  const source=lookupLongestPrefix(glossary.root,word);
  if(!source)continue;
  const end=start+source.length,after=word.slice(source.length);
  if(source.length>MAX_TERM_LENGTH||source.length<2||!eligibleSelection(selected,start,end)){
   skipped++;continue;
  }
  // A source-listed word can be a person in this occurrence. Adding a
  // choice is safe; selecting it remains the model's responsibility.
  const sameStart=byStart.get(start)||[];
  const exact=sameStart.find(t=>t.end===end);
  const fullWord=sameStart.find(t=>t.end===start+word.length&&PARTICLES.has(after));
  const owner=exact||fullWord;
  const matchEnd=owner?.end??end;
  if(hasOtherOverlap(start,matchEnd,owner)||
     (!owner&&overlapsProtected(start,end))){
   skipped++;continue;
  }
  if(owner?.scan_only){skipped++;continue;}
  const variants=glossary.entries.get(source);
  if(!variants)continue;
  const options=sourceOptions(variants,source,owner?.end===start+word.length?after:'',paragraphIndex,start);
  // An author spelling introduced later in this paragraph is not available
  // yet; never retroactively enrich an earlier occurrence.
  if(!options.length)continue;
  if(owner){
   let modified=false;
   for(const added of options){
    const existing=owner.options.filter(o=>o.type==='hanja'&&o.replacement===added.replacement);
    if(existing.length){
     for(const same of existing){
      const index=owner.options.indexOf(same);
      const definitions=[...same.definitions];
      for(const definition of added.definitions)if(!definitions.includes(definition))definitions.push(definition);
      if(definitions.length!==same.definitions.length){
       owner.options[index]={...same,definitions};
       modified=true;enhancedChoices++;
      }
     }
    }else{
     const used=new Set(owner.options.map(o=>o.choice_id));
     let number=0;while(used.has('c'+number))number++;
     owner.options.push({...added,choice_id:'c'+number});
     modified=true;newChoices++;
    }
   }
   if(modified)changed=true;
  }else{
   const optionsWithIds=options.map((option,index)=>({...option,choice_id:'c'+index}));
   let id='session-hanja-'+start,sequence=1;
   while(usedIds.has(id))id='session-hanja-'+start+'-'+sequence++;
   usedIds.add(id);
   const target={target_id:id,start,end,surface:source,context:text,
    options:[{choice_id:'KEEP',type:'keep',replacement:source,entry_id:null,definitions:[]},...optionsWithIds]};
   targets.push(target);
   addedLastEnd=end;
   byStart.set(start,[target]);
   newTargets++;newChoices+=optionsWithIds.length;changed=true;
  }
 }
 if(!changed)return {analysis,stats:{newTargets,newChoices,enhancedChoices,skipped}};
 targets.sort((a,b)=>a.start-b.start||a.end-b.end);
 return {analysis:{...analysis,targets,
  stats:{...analysis.stats,pending:targets.length}},
  stats:{newTargets,newChoices,enhancedChoices,skipped}};
}

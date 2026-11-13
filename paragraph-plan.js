import {splitText} from './text-chunks.js';
// Analyze original paragraph text once; keep existing per-node DOM rendering.
export function createParagraphPlan(entries,readSource,blockSelector){
 const groups=new Map(),byId=new Map(),sentences=[];
 for(const entry of entries.values()){
  const element=entry.node.parentElement?.closest(blockSelector+',div,section,article,main')||entry.node.parentElement;
  if(!element)continue;
  let group=groups.get(element);
  if(!group){const source=readSource(element);group={id:'p'+groups.size,text:source.text,runs:source.runs,runByNode:new Map(source.runs.map(r=>[r.node,r])),members:[],selected:[],results:new Map()};groups.set(element,group);}
  const run=group.runByNode.get(entry.node);
  if(!run||group.text.slice(run.start,run.end)!==entry.text)throw Error('段落原文与 DOM 位置不一致，已停止分析。');
  group.members.push({entry,start:run.start,end:run.end});
  for(const r of entry.selected)group.selected.push({start:run.start+r.start,end:run.start+r.end});
 }
 for(const g of groups.values()){
  const merged=[];
  for(const r of g.selected.sort((a,b)=>a.start-b.start)){const last=merged.at(-1);if(last&&r.start<=last.end)last.end=Math.max(last.end,r.end);else merged.push({...r});}g.selected=merged;
  // Keep ordinary paragraphs intact. Only oversized paragraphs need chunks;
  // prefer sentence endings, horizontal spaces, then newlines, without loss.
  let index=0;
  for(const {start,end,text,adjacentContext} of splitText(g.text)){
   const id=g.text.length<=20000?g.id:`${g.id}c${index++}`;
   const selected=g.selected.flatMap(r=>{const a=Math.max(r.start,start),b=Math.min(r.end,end);return a<b?[{start:a-start,end:b-start}]:[];});
   sentences.push({id,text,selected,...(adjacentContext?{adjacentContext}:{})});byId.set(id,{group:g,start,end});
  }
 }
 function annotationsFor(group,member,annotations){
  const output=[];
  for(const a of annotations||[]){
   if(group.text.slice(a.start,a.end)!==a.surface)throw Error('段落标注与原文不一致。');
   const start=Math.max(a.start,member.start),end=Math.min(a.end,member.end);if(start>=end)continue;
   let replacement=a.replacement;
   if(start!==a.start||end!==a.end){
    // Hanja is position-aligned. Foreign origins cannot be divided by letters.
    if(a.type!=='hanja'||Array.from(a.surface).length!==Array.from(a.replacement).length)continue;
    const left=Array.from(group.text.slice(a.start,start)).length,right=Array.from(group.text.slice(a.start,end)).length;
    replacement=Array.from(a.replacement).slice(left,right).join('');
   }
   output.push({...a,start:start-member.start,end:end-member.start,surface:group.text.slice(start,end),replacement});
  }
  return output;
 }
 return {
  sentences,
  context:[...groups.values()].map(g=>g.text).join('\n'),
  projectResult(item,{source='local',provisional=false}={}){
   const chunk=byId.get(item.id);if(!chunk)throw Error('未知段落结果。');const g=chunk.group;
   const shifted={annotations:(item.annotations||[]).map(a=>({...a,start:a.start+chunk.start,end:a.end+chunk.start})),reviewed:(item.reviewed||[]).map(r=>({...r,start:r.start+chunk.start,end:r.end+chunk.start}))};
   let results=g.results.get(source);if(!results){results=new Map();g.results.set(source,results);}
   const previous=results.get(item.id);results.set(item.id,{...shifted,start:chunk.start,end:chunk.end,provisional,committed:provisional?previous?.committed:shifted});
   const all=[...results.values()];
   return g.members.filter(m=>m.start<chunk.end&&m.end>chunk.start).map(m=>({id:m.entry.id,
    annotations:annotationsFor(g,m,all.flatMap(r=>r.annotations)),
    ...(source==='model'?{committedAnnotations:annotationsFor(g,m,all.flatMap(r=>r.committed?.annotations||[])),hasPreview:all.some(r=>r.provisional&&m.start<r.end&&m.end>r.start),committedReviewed:all.some(r=>r.committed?.reviewed.some(a=>a.start<m.end&&a.end>m.start))}:{}),
    reviewed:all.flatMap(r=>r.reviewed).flatMap(r=>{const a=Math.max(r.start,m.start),b=Math.min(r.end,m.end);return a<b?[{start:a-m.start,end:b-m.start,surface:g.text.slice(a,b)}]:[];})}));
  },
  projectBinding(binding,choice){
   const chunk=byId.get(binding.sentenceId),g=chunk?.group;
   if(chunk){binding={...binding,start:binding.start+chunk.start,end:binding.end+chunk.start};choice={...choice,annotations:(choice.annotations||[]).map(a=>({...a,start:a.start+chunk.start,end:a.end+chunk.start}))};}
   if(!g||g.text.slice(binding.start,binding.end)!==binding.surface)throw Error('批次段落位置不一致。');
   return g.members.flatMap(m=>{const start=Math.max(binding.start,m.start),end=Math.min(binding.end,m.end);return start<end?[{sentenceId:m.entry.id,start:start-m.start,end:end-m.start,surface:g.text.slice(start,end),annotations:annotationsFor(g,m,choice.annotations)}]:[];});
  }
 };
}

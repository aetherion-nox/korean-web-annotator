// In a long Korean paragraph Kiwi may identify one occurrence as a whole
// proper noun while splitting identical later occurrences into common-word
// fragments. Protect only strongly corroborated, repeated names; do not
// presume their Hanja. This is a local first-pass guard, not another LLM call.
const HANGUL=/[가-힣]/u;
const PERSON_ROLE=/(?<![가-힣])([가-힣]{2,6})[ \t]{1,3}(?:선생|교수|박사|도사)(?:님)?(?=$|[^가-힣]|[은는이가의도에을를])/gu;
const NAME_SUFFIXES=new Set([
 '','은','는','이','가','을','를','의','에','에서','에게','께','와','과',
 '도','만','처럼','에게서','께서','이라','라고','이다','이었다','이며','인데',
 '이라는','이라서','이든','이나'
]);
function matches(text,name){
 const ranges=[];let pos=0;
 while((pos=text.indexOf(name,pos))!==-1){
  const end=pos+name.length,prev=text[pos-1]||'';
  if(!HANGUL.test(prev)){
   const suffix=/^[가-힣]*/u.exec(text.slice(end))?.[0]||'';
   if(NAME_SUFFIXES.has(suffix))ranges.push([pos,end]);
  }
  pos=end;
 }
 return ranges;
}
export function protectRepeatedArticleNames(text,analysis){
 const tokens=analysis?.repair_context?.kiwi_tokens;
 if(typeof text!=='string'||!Array.isArray(tokens)||!Array.isArray(analysis?.targets)||
    !analysis.targets.length)return {analysis,protectedCount:0,names:[]};
 const confirmed=new Set();
 for(const t of tokens){
  if(t?.tag!=='NNP'||!/^[-가-힣]{2,6}$/u.test(t.form||'')||
     !Number.isInteger(t.start)||!Number.isInteger(t.end)||
     text.slice(t.start,t.end)!==t.form)continue;
  confirmed.add(t.form);
 }
 const names=new Set();
 // One NNP tag can itself be wrong. Require independent identity evidence:
 // an adjacent confirmed full name, or an explicit human role title.
 const byStart=new Map(tokens.filter(t=>t.tag==='NNP').map(t=>[t.start,t]));
 const followedByPersonName=range=>{
  const [start,end]=range;
  const following=/^[ \t]{1,3}([가-힣]{2,6})/u.exec(text.slice(end));
  if(!following)return false;
  const position=end+following[0].length-following[1].length;
  const next=byStart.get(position);
  return next?.form===following[1]&&next?.end===position+following[1].length;
 };
 for(const name of confirmed){
  const occurrences=matches(text,name);
  if(occurrences.length>=3&&occurrences.some(followedByPersonName))
   names.add(name);
 }
 // An author repeatedly using a word before a person's role supplies
 // independent name evidence even when Kiwi splits every occurrence.
 for(const found of text.matchAll(PERSON_ROLE)){
  const name=found[1];
  if(matches(text,name).length>=2)names.add(name);
 }
 if(!names.size)return {analysis,protectedCount:0,names:[]};
 const ranges=[...names].flatMap(name=>matches(text,name));
 if(!ranges.length)return {analysis,protectedCount:0,names:[]};
 let protectedCount=0;
 const targets=analysis.targets.map(t=>{
  if(!ranges.some(([a,b])=>t.start<b&&a<t.end))return t;
  // Only verified personal-name spellings may still compete. Dictionary
  // common-word homographs (even if phonetically identical) do not prove
  // a person's name, and a fragment crossing the name boundary is unsafe.
  const permitted=t.options.filter(o=>
   o.type==='keep'||
   (o.type==='hanja'&&ranges.some(([a,b])=>{
    if(a!==t.start)return false;
    const name=text.slice(a,b),suffix=t.surface.slice(b-a);
    if(!t.surface.startsWith(name)||!NAME_SUFFIXES.has(suffix))return false;
    // A source author explicitly wrote Hangul(漢字) earlier; this trusted
    // article-local evidence must not be discarded by the name guard.
    // Phonetic mismatches were already excluded at glossary ingestion.
    const sourced=String(o.entry_id||'').startsWith('session-inline-hanja:'+name+':');
    const verified=Array.isArray(t.verified_person_hanja)&&
      t.verified_person_hanja.includes(o.replacement);
    return sourced||verified;
   })));
  if(permitted.length===t.options.length)return t;
  protectedCount++;
  return {...t,suspected_person_name:true,article_name_evidence:true,options:permitted};
 });
 if(!protectedCount)return {analysis,protectedCount:0,names:[...names]};
 return {analysis:{...analysis,targets,
  stats:{...analysis.stats,pending:targets.length,
   protected_names:(analysis.stats?.protected_names||0)+protectedCount}},
  protectedCount,names:[...names]};
}

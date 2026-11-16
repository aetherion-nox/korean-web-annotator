// Review-only compatibility. Unknown evidence never excludes a dictionary sense.
const families = {
 noun:['NNG','NNP','NNB','NP','NR'], common:['NNG'], proper:['NNP'], dependent:['NNB'],
 pronoun:['NP'], numeral:['NR','SN'], verb:['VV','VX','XSV'], adjective:['VA','VX','XSA'],
 auxiliary:['VX'], predicate:['VV','VA','VX'], adverb:['MAG','MAJ'], determiner:['MM'], interjection:['IC'],
 affix:['XPN','XSN','XSV','XSA','XSM'], prefix:['XPN'], suffix:['XSN','XSV','XSA','XSM'],
 nounSuffix:['XSN'], verbSuffix:['XSV'], adjectiveSuffix:['XSA'], adverbSuffix:['XSM'], root:['XR'],
 particle:['JKS','JKC','JKG','JKO','JKB','JKV','JKQ','JX','JC'],
 ending:['EP','EF','EC','ETN','ETM'], prefinal:['EP'], final:['EF'], connective:['EC'], nominalEnding:['ETN'], attributiveEnding:['ETM'],
 symbol:['SF','SP','SS','SSO','SSC','SE','SO','SW'], foreign:['SL'], hanja:['SH'], number:['SN']
};
const labels = new Map();
function aliases(family,names){for(const name of names.split('|'))labels.set(name.toLowerCase(),families[family]);}
aliases('noun','명사|名詞|名词|noun');
aliases('common','일반명사|普通名詞|普通名词|common noun');
aliases('proper','고유명사|固有名詞|固有名词|專有名詞|专有名词|proper noun');
aliases('dependent','의존명사|불완전명사|依存名詞|依存名词|不完全名詞|不完全名词|dependent noun|bound noun');
aliases('pronoun','대명사|代名詞|代名词|pronoun');
aliases('numeral','수사|數詞|数词|numeral');
aliases('verb','동사|動詞|动词|verb');
aliases('adjective','형용사|形容詞|形容词|adjective');
aliases('auxiliary','보조동사|보조형용사|보조용언|補助動詞|补助动词|補助形容詞|补助形容词|auxiliary verb|auxiliary adjective');
aliases('predicate','용언|用言');
aliases('adverb','부사|副詞|副词|adverb');
aliases('determiner','관형사|冠形詞|冠形词|determiner');
aliases('interjection','감탄사|感歎詞|感叹词|感嘆詞|interjection');
aliases('affix','접사|接辭|接辞|affix');
aliases('prefix','접두사|接頭辭|接头辞|接頭詞|接头词|prefix');
aliases('suffix','접미사|接尾辭|接尾辞|接尾詞|接尾词|suffix');
aliases('nounSuffix','명사파생접미사');aliases('verbSuffix','동사파생접미사');
aliases('adjectiveSuffix','형용사파생접미사');aliases('adverbSuffix','부사파생접미사');
aliases('root','어근|語根|语根|root');
aliases('particle','조사|助詞|助词|particle');
aliases('ending','어미|語尾|语尾|ending');
aliases('prefinal','선어말어미');aliases('final','종결어미');aliases('connective','연결어미');
aliases('nominalEnding','명사형전성어미');aliases('attributiveEnding','관형사형전성어미');
aliases('symbol','기호|문장부호|記號|记号|符號|符号|標點符號|标点符号');
aliases('foreign','외국어|外國語|外国语');aliases('hanja','한자|漢字|汉字');aliases('number','숫자');
// Normalize spaces in names as well as supplied POS values.
const compactLabels=new Map([...labels].map(([name,tags])=>[name.replace(/\s+/g,''),tags]));
const knownTags=new Set(Object.values(families).flat());
function baseTag(tag){return typeof tag==='string'?tag.split('-')[0]:null;}
function dictionaryClasses(pos){
 if(Array.isArray(pos))return pos.length?pos.flatMap(dictionaryClasses):[null];
 if(typeof pos!=='string'||!pos.trim())return [null];
 return pos.replace(/\b(?:and|or)\b|및|또는|혹은/gi,'/').split(/[\/／,，、·ㆍ;；|＋+&]/).map(value=>{
  const name=value.trim().replace(/^[「『\[(（]+|[」』\])）]+$/g,'').replace(/\s+/g,'').toLowerCase();
  return compactLabels.get(name)||null;
 });
}
function occurrenceTags(target){
 const parts=target.morphology;
 if(!Array.isArray(parts)||!parts.length)return null;
 const ordered=[...parts].sort((a,b)=>a.start-b.start);
 if(!Number.isInteger(target.start)||!Number.isInteger(target.end)||ordered[0].start!==target.start||ordered.at(-1).end!==target.end)return null;
 let end=target.start;
 for(const part of ordered){if(part.start!==end||!Number.isInteger(part.end)||part.end<=part.start)return null;end=part.end;}
 const tags=ordered.map(part=>baseTag(part.tag));
 if(tags.some(tag=>!knownTags.has(tag)))return null;
 if(tags.length===1)return tags;
 const last=tags.at(-1),stem=tags.slice(0,-1);
 const nominal=new Set(['NNG','NNP','NNB','NP','NR','XR','XPN','XSN','MM','SL','SH']);
 if(stem.every(tag=>nominal.has(tag))){
  // A suffix-derived whole word can be lexicalized as an adverb or determiner.
  // The internal noun is not proof that the entire word must be a noun.
  if(last==='XSN')return [...families.noun,'MAG','MAJ','MM'];
  if(last==='XSV')return ['VV'];
  if(last==='XSA')return ['VA'];
  if(last==='XSM')return ['MAG','MAJ'];
  if(families.noun.includes(last))return [last];
 }
 if(['VV','VA','VX'].includes(tags[0])&&tags.slice(1).every(tag=>families.ending.includes(tag)))return [tags[0]];
 return null;
}
function optionTags(target,option,wholeTags){
 // An exact single NNB token has an unambiguous grammatical review span.
 if(wholeTags.length===1&&wholeTags[0]==='NNB'&&target.morphology.length===1)return wholeTags;
 if(typeof option.written_form!=='string'||!option.written_form.trim())return wholeTags;
 const word=option.written_form.trim().replace(/^[-－]+|[-－]+$/g,'');
 if(word===target.surface)return wholeTags;
 if(word===target.surface+'다'&&wholeTags.some(tag=>['VV','VA','VX'].includes(tag)))return wholeTags;
 // A merged target can contain options for smaller spans. Use a unique
 // matching lemma, otherwise the headword-to-occurrence relation is unknown.
 const matching=target.morphology.filter(part=>part.form===word||(['VV','VA','VX','XSV','XSA'].includes(baseTag(part.tag))&&part.form+'다'===word));
 return matching.length===1&&knownTags.has(baseTag(matching[0].tag))?[baseTag(matching[0].tag)]:null;
}
function compatible(tags,pos){
 const classes=dictionaryClasses(pos);
 // NNB is a specific role: a generic noun label does not establish dependency.
 // Mixed POS with an unknown component remains uncertain and is preserved.
 if(tags.length===1&&tags[0]==='NNB'){
  if(classes.includes(families.dependent))return true;
  return classes.includes(null)?null:false;
 }

 if(classes.some(expected=>expected?.some(tag=>tags.includes(tag))))return true;
 return classes.includes(null)?null:false;
}
export function filterReviewTarget(target,config={}){
 if(config.reviewPosFilter===false||target.dictionary_name_homograph===true||target.suspected_person_name===true||
   (target.dictionary_person_name===true&&target.verified_person_hanja?.length))return target;
 const tags=occurrenceTags(target);
 if(!tags)return target;
 const original=target.options.filter(option=>option.type!=='keep');
 if(!original.length)return target;
 const allowed=original.filter(option=>{const ownTags=optionTags(target,option,tags);return !ownTags||compatible(ownTags,option.part_of_speech)!==false;});
 const keep=target.options.filter(option=>option.type==='keep');
 if(!allowed.length)return {...target,pos_conflict:true};
 if(allowed.length===original.length)return target;
 return {...target,options:[...keep,...allowed]};
}
export function filterReviewTargets(targets,config={}){return targets.map(target=>filterReviewTarget(target,config));}

// POS evidence is redundant only when all surviving senses were locally verified.
export function canTrimReviewMorphology(target,config={}){
 if(config.reviewPosFilter===false||target.pos_conflict===true||target.dictionary_name_homograph===true||target.suspected_person_name===true||
   (target.dictionary_person_name===true&&target.verified_person_hanja?.length))return false;
 const tags=occurrenceTags(target);
 if(!tags)return false;
 const choices=target.options.filter(option=>option.type!=='keep');
 return choices.length>0&&choices.every(option=>{
  const ownTags=optionTags(target,option,tags);
  return !!ownTags&&compatible(ownTags,option.part_of_speech)===true;
 });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {extractInlineHanjaPairs,applyInlineHanjaAnnotations} from '../inline-hanja-evidence.js';
import {createSessionHanjaGlossary,learnSessionHanjaGlossary,applySessionHanjaGlossary} from '../session-hanja-glossary.js';

const emptyAnalysis=()=>({annotations:[],targets:[],stats:{local_determined:0,pending:0}});

test('leading Hanja before date is the only replacement, without a model decision',()=>{
 const text='박의산(朴懿山:1926~)';
 const pairs=extractInlineHanjaPairs(text);
 assert.equal(pairs.length,1);
 assert.deepEqual([pairs[0].surface,pairs[0].hanja,pairs[0].parenthesisEnd],['박의산','朴懿山',text.length]);
 const result=applyInlineHanjaAnnotations(text,emptyAnalysis(),{pairs});
 assert.equal(result.stats.converted,1);
 assert.deepEqual(result.analysis.annotations.map(a=>[a.surface,a.replacement,a.start,a.end]),
   [['박의산','朴懿山',0,3]]);
 assert.equal(result.analysis.targets.length,0);
});
test('fullwidth brackets and trailing notes work, but mismatched or nonleading Hanja do not',()=>{
 assert.deepEqual(extractInlineHanjaPairs('박의산（朴懿山：1926～）').map(p=>p.hanja),['朴懿山']);
 assert.deepEqual(extractInlineHanjaPairs('박의산(朴懿山: 1926~，朝鮮人)').map(p=>p.hanja),['朴懿山']);
 assert.equal(extractInlineHanjaPairs('박의산(朴懿:1926~)').length,0);
 assert.equal(extractInlineHanjaPairs('박의산(1926 朴懿山)').length,0);
 assert.equal(extractInlineHanjaPairs('박의산(朴懿山\n1926~)').length,0);
});
test('temporary glossary learns after the source and supplies later targets only',()=>{
 const glossary=createSessionHanjaGlossary(),source='박의산(朴懿山:1926~)';
 const sourceAnalysis=applyInlineHanjaAnnotations(source,emptyAnalysis()).analysis;
 assert.equal(learnSessionHanjaGlossary(source,sourceAnalysis,glossary,{paragraphIndex:1}),1);
 assert.equal(glossary.terms,1);
 const earlier=applySessionHanjaGlossary('박의산은',emptyAnalysis(),glossary,{paragraphIndex:0});
 assert.equal(earlier.analysis.targets.length,0);
 const later=applySessionHanjaGlossary('박의산은',emptyAnalysis(),glossary,{paragraphIndex:2});
 assert.equal(later.analysis.targets.length,1);
 assert.equal(later.analysis.targets[0].options.find(o=>o.type==='hanja')?.replacement,'朴懿山');
 // This is an evidence-backed candidate, not an unconditional conversion.
 assert.equal(later.analysis.annotations.length,0);
});
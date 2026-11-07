import test from 'node:test';import assert from 'node:assert/strict';
const chunks=async text=>(await import('../text-chunks.js')).splitText(text);
test('ordinary multiline text stays whole with no supplemental context',async()=>{
 const text='나는 네가 어제\n무슨 일을 했는지 안다.';const result=await chunks(text);
 assert.equal(result.length,1);assert.equal(result[0].text,text);assert.ok(!result[0].adjacentContext);
});
test('earlier sentence end takes priority over later spaces and newlines',async()=>{
 const text='가'.repeat(11000)+'. '+'나'.repeat(1000)+' '+'다'.repeat(1000)+'\n'+'라'.repeat(10000);
 const result=await chunks(text);assert.equal(result[0].end,11002);assert.equal(result.map(c=>c.text).join(''),text);
});
test('horizontal space takes priority over later newline',async()=>{
 const text='가'.repeat(11000)+' '+'나'.repeat(1000)+'\n'+'다'.repeat(10000);
 assert.equal((await chunks(text))[0].end,11001);
});
test('a decimal cut by the length ceiling is not mistaken for a sentence ending',async()=>{
 const text='가'.repeat(11000)+' '+'나'.repeat(8997)+'3.14'+'다'.repeat(10000);
 assert.equal((await chunks(text))[0].end,11001);
});
test('newline is used when there is no sentence or horizontal space',async()=>{
 const text='가'.repeat(11000)+'\r\n'+'나'.repeat(11000);
 const result=await chunks(text);assert.equal(result[0].end,11002);assert.equal(result.map(c=>c.text).join(''),text);
});
test('hard cuts preserve Unicode and all text, including CRLF',async()=>{
 const text='가'.repeat(19999)+'😀'+'나'.repeat(21000)+'\r\n';const result=await chunks(text);
 assert.equal(result[0].end,19999);assert.equal(result.map(c=>c.text).join(''),text);
 for(const c of result){assert.ok(c.text.length<=20000);assert.ok(!/[\uD800-\uDBFF]$/u.test(c.text));assert.ok(!/^[\uDC00-\uDFFF]/u.test(c.text));assert.equal(text.slice(c.start,c.end),c.text);}
});
test('split context uses at most two neighboring sentences and does not carry whole chunks',async()=>{
 const text='가'.repeat(11000)+'. 앞하나. 앞둘. '+'뒤하나. 뒤둘. 뒤셋. '+'나'.repeat(20000);
 const result=await chunks(text),first=result[0],second=result[1];
 assert.equal(first.adjacentContext.before,'');assert.equal(first.adjacentContext.after.length,1000);
 // The last reliable boundary before 20K is after 뒤셋, so only the two nearest sentences remain.
 assert.equal(second.adjacentContext.before,'뒤둘. 뒤셋. ');
 for(const c of result){assert.ok(c.adjacentContext.before.length<=1000);assert.ok(c.adjacentContext.after.length<=1000);}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {crc32,createZipArchive} from '../zip-archive.js';
import {compactDomAnnotation,compactDomAnnotations,shouldPublishPreview} from '../annotation-event.js';
function unzip(buffer){
 const bytes=new Uint8Array(buffer),view=new DataView(buffer);
 let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){
  if(view.getUint32(i,true)===0x06054b50){end=i;break;}
 }
 assert.ok(end>=0,'ZIP end of directory exists');
 const count=view.getUint16(end+10,true),central=view.getUint32(end+16,true),result=new Map();
 let at=central;const decoder=new TextDecoder();
 for(let i=0;i<count;i++){
  assert.equal(view.getUint32(at,true),0x02014b50);
  const method=view.getUint16(at+10,true),crc=view.getUint32(at+16,true);
  const compressed=view.getUint32(at+20,true),original=view.getUint32(at+24,true);
  const nameBytes=view.getUint16(at+28,true),extra=view.getUint16(at+30,true);
  const comment=view.getUint16(at+32,true),offset=view.getUint32(at+42,true);
  const name=decoder.decode(bytes.subarray(at+46,at+46+nameBytes));
  assert.equal(view.getUint32(offset,true),0x04034b50);
  const headName=view.getUint16(offset+26,true),headExtra=view.getUint16(offset+28,true);
  const start=offset+30+headName+headExtra,content=bytes.subarray(start,start+compressed);
  const decoded=method===8?new Uint8Array(inflateRawSync(content)):method===0?content:null;
  assert.ok(decoded,'ZIP method is DEFLATE or STORE');
  assert.equal(decoded.length,original);assert.equal(crc32(decoded),crc);
  result.set(name,decoder.decode(decoded));
  at+=46+nameBytes+extra+comment;
 }
 return result;
}
test('single exchange ZIP is valid with CRC32, UTF8 and DEFLATE',async()=>{
 const items=[
  {name:'request.json',data:JSON.stringify({model:'deepseek',prompt:'사주팔자'.repeat(200)})},
  {name:'response.json',data:JSON.stringify({results:[{t:'b0t0',c:'c1'}]})},
  {name:'diagnostic.json',data:JSON.stringify({raw:'data: {漢字}\n\n'.repeat(300)})}
 ];
 const extracted=unzip(await (await createZipArchive(items)).arrayBuffer());
 assert.equal(extracted.size,3);
 for(const item of items)assert.equal(extracted.get(item.name),item.data);
});
test('all-exchanges ZIP groups requests, replies and diagnostic independently',async()=>{
 const rows=[
  {name:'index.json',data:'{"total":2}'},
  {name:'001-first/request.json',data:'{"model":"A"}'},
  {name:'001-first/response.json',data:'{"results":[{"t":"a","c":null}]}'},
  {name:'002-second/request.json',data:'{"model":"B"}'},
  {name:'002-second/diagnostic.json',data:'{"error":"interrupted"}'}
 ];
 const result=unzip(await (await createZipArchive(rows,{deflate:false})).arrayBuffer());
 assert.equal(result.size,5);
 for(const row of rows)assert.equal(result.get(row.name),row.data);
 await assert.rejects(createZipArchive([{name:'../unsafe',data:'hi'}]),/Invalid ZIP/);
 await assert.rejects(createZipArchive([{name:'x',data:'one'},{name:'x',data:'two'}]),/Duplicate/);
});
test('an 809-choice long article has small source-bound DOM events',()=>{
 const context='사주팔자 공부는 오랜 공부다.'.repeat(300);
 const sources=Array.from({length:809},(_,i)=>({
  start:i*3,end:i*3+2,surface:'학교',replacement:'學校',type:'hanja',
  entry_id:i,confidence:1,origin_source:'dictionary',
  context,options:Array.from({length:4},()=>({definitions:['a'.repeat(120)]}))
 }));
 const wire=compactDomAnnotations(sources);
 assert.equal(wire.length,809);assert.equal(wire[0].start,0);
 assert.equal(wire.at(-1).entry_id,808);
 assert.equal(Object.hasOwn(wire[0],'context'),false);
 assert.equal(Object.hasOwn(wire[0],'options'),false);
 const oldBytes=Buffer.byteLength(JSON.stringify(sources));
 const newBytes=Buffer.byteLength(JSON.stringify(wire));
 assert.ok(oldBytes/newBytes>50,'expected 50x drop, got '+(oldBytes/newBytes));
 assert.ok(newBytes<160_000,'DOM result should remain compact: '+newBytes);
 assert.deepEqual(compactDomAnnotation({start:0,end:1,surface:'영',replacement:'靈',
  type:'hanja',origin_source:'model-unverified'}),{
  start:0,end:1,surface:'영',replacement:'靈',type:'hanja',origin_source:'model-unverified'
 });
});
test('stream long-paragraph previews are coalesced rather than repainting per row',()=>{
 let sent=0,count=0,published=false;
 for(let n=1;n<=983;n++){
  if(shouldPublishPreview({sentenceChars:7665,targetCount:983,lastCount:count,
      nextCount:n,hasPublished:published})){count=n;sent++;published=true;}
 }
 assert.ok(sent>=12&&sent<=23,'unexpected updates: '+sent);
 assert.ok(shouldPublishPreview({sentenceChars:100,targetCount:2,lastCount:0,
  nextCount:1,hasPublished:false}));
 assert.ok(shouldPublishPreview({sentenceChars:100,targetCount:2,lastCount:1,
  nextCount:2,hasPublished:true}));
 assert.equal(shouldPublishPreview({sentenceChars:7665,targetCount:983,lastCount:48,
  nextCount:49,hasPublished:true}),false);
});

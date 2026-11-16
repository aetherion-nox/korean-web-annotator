// Self-contained, standards-compliant ZIP archive writer for Chrome extension
// pages. UTF-8 filenames, CRC32, optional DEFLATE (fallback to STORE), and
// strict classic-ZIP limits. No remote library or zip-file round trip.
const utf8=new TextEncoder();
const ZIP_MAX=0xffffffff;
function u16(view,offset,value){view.setUint16(offset,value,true);}
function u32(view,offset,value){view.setUint32(offset,value>>>0,true);}
function bytesOf(value){
 if(value instanceof Uint8Array)return value;
 if(value instanceof ArrayBuffer)return new Uint8Array(value);
 return utf8.encode(typeof value==='string'?value:JSON.stringify(value,null,2));
}
export function crc32(data){
 let crc=0xffffffff;
 for(const byte of data){
  crc^=byte;
  for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
 }
 return (crc^0xffffffff)>>>0;
}
async function compress(data){
 if(typeof CompressionStream!=='function'||!data.length)return {data,method:0};
 try{
  const stream=new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const encoded=new Uint8Array(await new Response(stream).arrayBuffer());
  return encoded.length<data.length?{data:encoded,method:8}:{data,method:0};
 }catch{
  return {data,method:0};
 }
}
function dosTime(now){
 const year=Math.min(2107,Math.max(1980,now.getFullYear()));
 return {time:(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1),
  date:((year-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate()};
}
function safePath(name){
 if(typeof name!=='string'||!name||name.startsWith('/')||name.includes('\\')||
    name.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid ZIP entry filename');
 return name;
}
export async function createZipArchive(entries,{deflate=true,onProgress}={}){
 if(!Array.isArray(entries)||!entries.length||entries.length>65535)throw Error('ZIP requires 1–65535 entries');
 const now=dosTime(new Date()),parts=[],central=[];
 let offset=0;
 const seen=new Set();
 for(let i=0;i<entries.length;i++){
  const item=entries[i],path=safePath(item.name);
  if(seen.has(path))throw Error('Duplicate ZIP entry: '+path);seen.add(path);
  const name=utf8.encode(path),original=bytesOf(item.data);
  if(name.length>65535||original.length>ZIP_MAX)throw Error('ZIP entry exceeds format limit');
  const zipped=deflate?await compress(original):{data:original,method:0};
  if(zipped.data.length>ZIP_MAX||offset>ZIP_MAX)throw Error('ZIP exceeds 4 GiB limit');
  const checksum=crc32(original),local=new Uint8Array(30+name.length);
  const l=new DataView(local.buffer);
  u32(l,0,0x04034b50);u16(l,4,20);u16(l,6,0x0800);u16(l,8,zipped.method);
  u16(l,10,now.time);u16(l,12,now.date);u32(l,14,checksum);
  u32(l,18,zipped.data.length);u32(l,22,original.length);
  u16(l,26,name.length);u16(l,28,0);local.set(name,30);
  parts.push(local,zipped.data);
  const header=new Uint8Array(46+name.length),c=new DataView(header.buffer);
  u32(c,0,0x02014b50);u16(c,4,20);u16(c,6,20);u16(c,8,0x0800);
  u16(c,10,zipped.method);u16(c,12,now.time);u16(c,14,now.date);
  u32(c,16,checksum);u32(c,20,zipped.data.length);u32(c,24,original.length);
  u16(c,28,name.length);u16(c,30,0);u16(c,32,0);u16(c,34,0);
  u16(c,36,0);u32(c,38,0);u32(c,42,offset);header.set(name,46);
  central.push(header);
  offset+=local.length+zipped.data.length;
  if(offset>ZIP_MAX)throw Error('ZIP exceeds 4 GiB limit');
  onProgress?.(i+1,entries.length);
 }
 const centralOffset=offset,centralLength=central.reduce((n,x)=>n+x.length,0);
 if(centralOffset+centralLength>ZIP_MAX)throw Error('ZIP central directory exceeds format limit');
 const end=new Uint8Array(22),e=new DataView(end.buffer);
 u32(e,0,0x06054b50);u16(e,4,0);u16(e,6,0);
 u16(e,8,central.length);u16(e,10,central.length);
 u32(e,12,centralLength);u32(e,16,centralOffset);u16(e,20,0);
 return new Blob([...parts,...central,end],{type:'application/zip'});
}

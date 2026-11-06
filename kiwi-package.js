// Only official, checksum-verified Kiwi distributions enter the isolated runtime.
export const UPDATE_ORIGINS=['https://registry.npmjs.org/*','https://api.github.com/*','https://github.com/*','https://release-assets.githubusercontent.com/*','https://objects.githubusercontent.com/*'];
const MAX_DOWNLOAD=128*1024*1024,MAX_UNPACKED=384*1024*1024;
const stable=v=>typeof v==='string'&&/^\d+\.\d+\.\d+$/.test(v);
const fail=message=>{throw Error(message);};
function base64(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);}
export async function verifyIntegrity(bytes,integrity){
 const m=/^(sha256|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(integrity||'');if(!m)fail('更新包缺少有效校验值。');
 const digest=base64(new Uint8Array(await crypto.subtle.digest(m[1]==='sha512'?'SHA-512':'SHA-256',bytes)));
 if(digest!==m[2])fail('更新文件校验失败，已保留原引擎。');
}
export function packageMetadata(meta){
 if(meta?.name!=='kiwi-nlp'||!stable(meta.version))fail('上游没有可用的 Kiwi 稳定版。');
 const url=`https://registry.npmjs.org/kiwi-nlp/-/kiwi-nlp-${meta.version}.tgz`;
 if(meta.dist?.tarball!==url||!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(meta.dist?.integrity||''))fail('Kiwi 包来源或校验信息无效。');
 if(meta.repository?.url!=='git+https://github.com/bab2min/Kiwi.git')fail('Kiwi 包的官方仓库标识不匹配。');
 return {version:meta.version,url,integrity:meta.dist.integrity};
}
export function modelMetadata(release,version){
 if(!stable(version)||release?.tag_name!==`v${version}`||release.draft||release.prerelease)fail('尚未找到与新版引擎对应的正式模型。');
 const name=`kiwi_model_v${version}_base.tgz`,asset=release.assets?.find(a=>a.name===name);
 const url=`https://github.com/bab2min/Kiwi/releases/download/v${version}/${name}`;
 if(asset?.browser_download_url!==url||!/^sha256:[a-f0-9]{64}$/.test(asset?.digest||''))fail('对应模型缺少官方来源或 SHA-256 校验值。');
 return {version,url,integrity:'sha256-'+base64(Uint8Array.from(asset.digest.slice(7).match(/../g),x=>parseInt(x,16)))};
}
async function readLimited(response,limit,onProgress){
 if(!response.ok)fail(`更新下载失败：HTTP ${response.status}`);
 const total=Number(response.headers.get('content-length'))||0;if(total>limit)fail('更新文件超过大小限制。');
 const reader=response.body?.getReader();if(!reader)fail('浏览器不支持流式读取更新文件。');
 const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)fail('更新文件超过大小限制。');chunks.push(value);onProgress?.(size,total);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 const out=new Uint8Array(size);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.byteLength;}return out;
}
export async function download(url,onProgress){
 return readLimited(await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(300000)}),MAX_DOWNLOAD,onProgress);
}
async function json(url){const bytes=await readLimited(await fetch(url,{credentials:'omit',headers:{Accept:'application/json'},signal:AbortSignal.timeout(30000)}),2*1024*1024);return JSON.parse(new TextDecoder().decode(bytes));}
export async function latestMetadata(){
 const engine=packageMetadata(await json('https://registry.npmjs.org/kiwi-nlp/latest'));
 const model=modelMetadata(await json(`https://api.github.com/repos/bab2min/Kiwi/releases/tags/v${engine.version}`),engine.version);
 return {engine,model,checkedAt:Date.now()};
}
export async function unpackTgz(bytes,limit=MAX_UNPACKED){
 const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
 const data=await readLimited(new Response(stream),limit),decode=b=>new TextDecoder().decode(b).replace(/\0.*$/s,'');
 const files={};let offset=0;
 while(offset+512<=data.length){
  const h=data.subarray(offset,offset+512);if(h.every(b=>b===0))break;
  const kind=h[156],rawName=[decode(h.subarray(345,500)),decode(h.subarray(0,100))].filter(Boolean).join('/');
  const name=kind===53?rawName.replace(/\/$/,''):rawName;
  if(!name||name.startsWith('/')||name.includes('\\')||name.split('/').some(p=>p==='..'||p===''))fail('更新归档包含无效路径。');
  const sizeText=decode(h.subarray(124,136)).trim();if(!/^[0-7]+$/.test(sizeText))fail('更新归档大小格式无效。');
  const size=parseInt(sizeText,8);let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:h[i];
  if(sum!==parseInt(decode(h.subarray(148,156)).trim(),8)||offset+512+size>data.length)fail('更新归档损坏。');
  if(kind===48||kind===0){if(Object.hasOwn(files,name))fail('更新归档存在重复文件。');files[name]=data.slice(offset+512,offset+512+size);}else if(![53,120,103].includes(kind))fail('更新归档包含不支持的文件类型。');
  offset+=512+Math.ceil(size/512)*512;
 }
 if(!Object.keys(files).length)fail('更新归档没有文件。');return files;
}
export async function preparePackage(engine,engineBytes,model,modelBytes){
 await verifyIntegrity(engineBytes,engine.integrity);await verifyIntegrity(modelBytes,model.integrity);
 const code=await unpackTgz(engineBytes,32*1024*1024),data=await unpackTgz(modelBytes),decode=b=>new TextDecoder().decode(b);
 const manifest=JSON.parse(decode(code['package/package.json']||new Uint8Array()));
 if(manifest.name!=='kiwi-nlp'||manifest.version!==engine.version||model.version!==engine.version)fail('更新包版本不一致。');
 const modules={};for(const [p,bytes]of Object.entries(code))if(/^package\/dist\/.*\.js$/.test(p))modules[p.slice(8)]=decode(bytes);
 const wasm=code['package/dist/kiwi-wasm.wasm'];if(!modules['dist/index.js']||Object.keys(modules).length>64||!wasm||wasm[0]!==0||wasm[1]!==97||wasm[2]!==115||wasm[3]!==109)fail('Kiwi 浏览器引擎文件不完整。');
 const models={};for(const [p,b]of Object.entries(data))if(p.startsWith('models/cong/base/')){const name=p.slice(17);if(name&&!name.includes('/'))models[name]=b;}
 for(const name of ['sj.morph','cong.mdl','combiningRule.txt','default.dict'])if(!models[name])fail('Kiwi 模型文件不完整。');
 return {version:engine.version,modelVersion:model.version,modelIntegrity:model.integrity,integrity:engine.integrity,id:engine.version+'-'+engine.integrity.slice(-18).replace(/[^a-zA-Z0-9]/g,''),modules,wasm,models,installedAt:Date.now()};
}

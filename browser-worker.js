import {loadPyodide} from './runtime/pyodide/pyodide.mjs';
import {KiwiBuilder,Match} from './runtime/kiwi/index.js';
let initialization,python,kiwi,kiwiInitialization;
async function initializeKiwi(){
 if(kiwiInitialization)return kiwiInitialization;
 kiwiInitialization=(async()=>{
  const assets=await (await fetch(new URL('./runtime/assets.json',import.meta.url))).json();
  const builder=await KiwiBuilder.create(new URL('./runtime/kiwi/kiwi-wasm.wasm',import.meta.url).href);
  if(builder.version()!==assets.kiwi_version)throw Error(`Kiwi version mismatch: ${builder.version()}`);
  const models=Object.fromEntries(assets.model_files.map(name=>[name,new URL('./runtime/models/'+name,import.meta.url).href]));
  kiwi=await builder.build({modelFiles:models,modelType:'cong',integrateAllomorph:true,loadDefaultDict:true,loadTypoDict:true,loadMultiDict:true});
 })().catch(error=>{kiwiInitialization=null;throw error;});return kiwiInitialization;
}
async function initialize(){
 if(initialization)return initialization;
 initialization=(async()=>{
  globalThis.kiwiTokens=text=>{if(!kiwi)throw Error('Tokenizer not initialized');return JSON.stringify(kiwi.tokenize(text,Match.all));};
  python=await loadPyodide({indexURL:new URL('./runtime/pyodide/',import.meta.url).href});await python.loadPackage('sqlite3');
  const sources=await (await fetch(new URL('./runtime/python-sources.json',import.meta.url))).json();
  for(const [path,source]of Object.entries(sources)){python.FS.mkdirTree(path.slice(0,path.lastIndexOf('/')));python.FS.writeFile(path,source);}
  python.FS.mkdirTree('/data');
  await python.runPythonAsync("import sys\nsys.path.insert(0, '/project/browser-support')\nimport browser_bridge\nfrom js import kiwiTokens\nbrowser_bridge.configure(kiwiTokens, '/project', '/data/hanja_dict.db')");
 })().catch(error=>{initialization=null;throw error;});return initialization;
}
async function dispatch(request){
 await initialize();
 if(request.action==='analyze')await initializeKiwi();
 if(request.database&&!python.FS.analyzePath('/data/hanja_dict.db').exists){python.FS.writeFile('/data/hanja_dict.db',new Uint8Array(request.database));await python.runPythonAsync("await browser_bridge.initialize()");}
 let payload={...request};delete payload.database;
 if(request.action==='import-db'){python.FS.writeFile('/data/candidate.db',new Uint8Array(request.bytes));payload={action:'import-db',path:'/data/candidate.db'};}
 if(request.action==='import'){python.FS.writeFile('/data/dictionary.zip',new Uint8Array(request.bytes));payload={action:'import',zip_path:'/data/dictionary.zip'};}
 python.globals.set('browser_payload',JSON.stringify(payload));let result;
 try{result=JSON.parse(await python.runPythonAsync('await browser_bridge.request(browser_payload)'));}
 finally{if(request.action==='import'&&python.FS.analyzePath('/data/dictionary.zip').exists)python.FS.unlink('/data/dictionary.zip');if(request.action==='import-db'&&python.FS.analyzePath('/data/candidate.db').exists)python.FS.unlink('/data/candidate.db');python.globals.delete('browser_payload');}
 if(['import','import-db'].includes(request.action))result.database=python.FS.readFile('/data/hanja_dict.db').buffer;
 if(request.action==='status')result.dictionary_loaded=result.ready;return result;
}
let queue=Promise.resolve();self.onmessage=({data})=>{queue=queue.then(async()=>{try{const result=await dispatch(data.request);self.postMessage({id:data.id,ok:true,result},result.database?[result.database]:[]);}catch(error){self.postMessage({id:data.id,ok:false,error:String(error.stack||error)});}});};

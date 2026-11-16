// Downloaded engine code runs only in this opaque-origin sandbox's worker.
(()=>{
 let connected=false,worker;const urls=[];
 const blob=(value,type)=>{const url=URL.createObjectURL(new Blob([value],{type}));urls.push(url);return url;};
 function graph(modules,entry){
  const built=new Map(),visiting=new Set();
  function moduleURL(name){
   if(built.has(name))return built.get(name);if(visiting.has(name)||typeof modules[name]!=='string')throw Error('新版 Kiwi 模块依赖不完整或存在不支持的循环。');
   visiting.add(name);
   const source=modules[name].replace(/\b(?:import|export)\s+(?:[^;"']*?\s+from\s*)?["'](\.[^"']*)["']/g,(statement,spec)=>{
    const parts=name.split('/');parts.pop();for(const p of spec.split('/')){if(p==='..'){if(parts.length<=1)throw Error('Kiwi 模块路径越界。');parts.pop();}else if(p!=='.'&&p)parts.push(p);}
    return statement.replace(spec,moduleURL(parts.join('/')));
   });
   const url=blob(source,'text/javascript');visiting.delete(name);built.set(name,url);return url;
  }
  return moduleURL(entry);
 }
 const bootstrap=`let kiwi,match;self.onmessage=async({data})=>{try{let result;if(data.command==='load'){const api=await import(data.entry);const builder=await api.KiwiBuilder.create(data.wasmURL);if(builder.version()!==data.version)throw Error('Kiwi 实际版本与更新包不一致');const modelFiles=Object.fromEntries(Object.entries(data.models).map(([k,v])=>[k,new Uint8Array(v)]));kiwi=await builder.build({modelFiles,modelType:'cong',integrateAllomorph:true,loadDefaultDict:true,loadTypoDict:true,loadMultiDict:true});match=api.Match.all;result={version:builder.version()};}else if(data.command==='tokenize'){if(!kiwi||typeof data.text!=='string'||data.text.length>20000)throw Error('Kiwi 分词请求无效');result=kiwi.tokenize(data.text,match);}else throw Error('Unknown Kiwi command');self.postMessage({id:data.id,ok:true,result});}catch(error){self.postMessage({id:data.id,ok:false,error:String(error.message||error)});}};`;
 window.addEventListener('message',event=>{
  if(connected||event.source!==parent||event.data?.type!=='KRA_KIWI_CONNECT'||event.ports.length!==1)return;
  connected=true;const port=event.ports[0];let chain=Promise.resolve();
  port.onmessage=({data})=>{chain=chain.then(()=>{
   if(data.command==='load'){
    if(worker)throw Error('Kiwi sandbox already initialized');
    const p=data.payload,entry=graph(p.modules,'dist/index.js'),wasmURL=blob(p.wasm,'application/wasm');
    worker=new Worker(blob(bootstrap,'text/javascript'),{type:'module'});
    worker.onmessage=event=>port.postMessage(event.data);worker.onerror=event=>port.postMessage({id:data.id,ok:false,error:event.message||'Kiwi worker failed'});
    const models=Object.fromEntries(Object.entries(p.models).map(([k,v])=>[k,v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength)]));
    worker.postMessage({id:data.id,command:'load',entry,wasmURL,models,version:p.version},Object.values(models));
   }else if(data.command==='tokenize'&&worker)worker.postMessage({id:data.id,command:'tokenize',text:data.text});
   else throw Error('Kiwi sandbox is not initialized');
  }).catch(error=>port.postMessage({id:data.id,ok:false,error:String(error.message||error)}));};
  port.start();port.postMessage({ready:true});
 });
 window.addEventListener('unload',()=>{worker?.terminate();for(const url of urls)URL.revokeObjectURL(url);});
})();

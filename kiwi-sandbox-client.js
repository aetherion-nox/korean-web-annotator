export function validTokens(text,tokens){
 if(!Array.isArray(tokens)||tokens.length>100000||tokens.some(t=>!t||typeof t.str!=='string'||typeof t.tag!=='string'||!Number.isInteger(t.position)||!Number.isInteger(t.length)||t.position<0||t.length<0||t.position+t.length>text.length))throw Error('新版 Kiwi 返回的分词结构不兼容，已保留旧引擎。');
 if(text.trim()&&!tokens.length)throw Error('新版 Kiwi 未返回分词结果。');return tokens;
}
export function createKiwiSandbox(){
 const frame=document.createElement('iframe');frame.hidden=true;frame.src=chrome.runtime.getURL('kiwi-sandbox.html');
 const pending=new Map();let sequence=0,closed=false,port,readyResolve,readyReject;
 const ready=new Promise((a,b)=>{readyResolve=a;readyReject=b;});
 const bootTimer=setTimeout(()=>close(Error('Kiwi 沙箱启动超时。')),20000);
 function close(error=Error('Kiwi sandbox closed')){if(closed)return;closed=true;clearTimeout(bootTimer);readyReject(error);port?.close();frame.remove();for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();}
 frame.onerror=()=>close(Error('Kiwi 沙箱页面无法加载。'));
 frame.onload=()=>{
  if(closed)return;const channel=new MessageChannel();port=channel.port1;
  port.onmessage=({data})=>{if(data.ready){clearTimeout(bootTimer);readyResolve();return;}const p=pending.get(data.id);if(!p)return;pending.delete(data.id);clearTimeout(p.timer);data.ok?p.resolve(data.result):p.reject(Error(data.error||'Kiwi sandbox failed'));};
  port.start();frame.contentWindow.postMessage({type:'KRA_KIWI_CONNECT'},'*',[channel.port2]);
 };
 (document.body||document.documentElement).append(frame);
 async function call(command,extra={},transfer=[]){
  await ready;if(closed)throw Error('Kiwi sandbox closed');
  return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);const error=Error(command==='load'?'新版 Kiwi 模型加载超时。':'Kiwi 分词超时。');reject(error);close(error);},command==='load'?180000:30000);pending.set(id,{resolve,reject,timer});try{port.postMessage({id,command,...extra},transfer);}catch(error){clearTimeout(timer);pending.delete(id);reject(error);}});
 }
 return {async load(payload){const transfer=[payload.wasm.buffer,...Object.values(payload.models).map(x=>x.buffer)];return call('load',{payload},[...new Set(transfer)]);},async tokenize(text){return validTokens(text,await call('tokenize',{text}));},close};
}

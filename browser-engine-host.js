let creating;
async function ensurePage(){
 if(creating)return creating;creating=(async()=>{
  if(!chrome.offscreen)throw Error('此试验版需要支持 offscreen 的 Chromium 浏览器；手机浏览器仍需适配。');
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('engine-page.html')]});
  if(!contexts.length)await chrome.offscreen.createDocument({url:'engine-page.html',reasons:['WORKERS'],justification:'Run Korean tokenizer and original Python converter locally in a worker.'});
 })();try{await creating;}finally{creating=null;}
}
export async function callBrowserEngine(request){
 await ensurePage();
 const reply=await chrome.runtime.sendMessage({type:'BROWSER_ENGINE_WORK',request});
 if(!reply||typeof reply.ok!=='boolean')throw Error(`浏览器引擎页面未回复（${request.action}）：页面可能未就绪或被浏览器回收，请重新加载插件后重试。`);
 return reply;
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message.type!=='BROWSER_ENGINE_CALL')return;
 if(sender.id!==chrome.runtime.id){reply({ok:false,error:'Invalid extension sender'});return;}
 callBrowserEngine(message.request).then(reply,error=>reply({ok:false,error:String(error.message||error)}));return true;
});

let creating;
async function ensurePage(){
 if(creating)return creating;creating=(async()=>{
  if(!chrome.offscreen)throw Error('此试验版需要支持 offscreen 的 Chromium 浏览器；手机浏览器仍需适配。');
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('engine-page.html')]});
  if(!contexts.length)await chrome.offscreen.createDocument({url:'engine-page.html',reasons:['WORKERS','CLIPBOARD'],justification:'Run the local dictionary worker and copy user-selected annotation prompts with extension clipboard permission.'});
 })();try{await creating;}finally{creating=null;}
}
export async function callBrowserEngine(request){
 await ensurePage();
 const reply=await chrome.runtime.sendMessage({type:'BROWSER_ENGINE_WORK',request});
 if(!reply||typeof reply.ok!=='boolean')throw Error(`浏览器引擎页面未回复（${request.action}）：页面可能未就绪或被浏览器回收，请重新加载插件后重试。`);
 return reply;
}
export async function copyTextToClipboard(text){
 if(typeof text!=='string'||text.length>10*1024*1024)throw Error('复制文本无效或过大，请下载 TXT。');
 await ensurePage();
 const reply=await chrome.runtime.sendMessage({type:'KRA_OFFSCREEN_COPY_TEXT',text});
 if(!reply?.ok)throw Error(reply?.error||'扩展剪贴板未响应');
 return {ok:true};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message.type!=='BROWSER_ENGINE_CALL')return;
 if(sender.id!==chrome.runtime.id){reply({ok:false,error:'Invalid extension sender'});return;}
 callBrowserEngine(message.request).then(reply,error=>reply({ok:false,error:String(error.message||error)}));return true;
});

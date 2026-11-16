// A long streamed answer must not time out merely because it takes more
// than two minutes to generate. Enforce separate inactivity and total limits.
// Progress can extend the inactivity deadline, NEVER the absolute ceiling.
export function requestTimeoutGuard({signal,hardMs=600000,idleMs=180000}={}){
 const controller=new AbortController();
 const capped=Math.max(1000,Math.min(1800000,Number(hardMs)||600000));
 const idle=Math.max(1000,Math.min(capped,Number(idleMs)||180000));
 let idleTimer,hardTimer,closed=false;
 const fail=label=>{
  if(!closed&&!controller.signal.aborted)
   controller.abort(new DOMException(label,'TimeoutError'));
 };
 const activity=()=>{
  if(closed||controller.signal.aborted)return;
  clearTimeout(idleTimer);
  idleTimer=setTimeout(()=>fail('模型 API 长时间没有返回数据'),idle);
 };
 activity();
 hardTimer=setTimeout(()=>fail('模型 API 单次请求达到安全总时限'),capped);
 const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 return {signal:combined,activity,
  cleanup(){
   if(closed)return;closed=true;clearTimeout(idleTimer);clearTimeout(hardTimer);
  }};
}

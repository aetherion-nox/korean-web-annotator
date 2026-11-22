// Recover only individually complete t/c objects from a malformed model JSON reply.
// Never infer a value, repair a choice key, or accept data outside results[].
export function parsePartialReviewJson(input){
 if(typeof input!=='string'||!input.trim())throw Error('模型回复为空');
 let source=input.trim();
 const fence=/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(source);
 if(fence)source=fence[1].trim();
 try{return {response:JSON.parse(source),recovered:false};}
 catch(error){
  const match=/"results"\s*:\s*\[/.exec(source);
  const isArray=!match&&/^\s*\[/.test(source);
  if(!match&&!isArray)throw error;
  const beginning=match?match.index+match[0].length:source.indexOf('[')+1;
  const batchMatch=/"batch_id"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/.exec(source);
  let batchId;
  if(batchMatch)try{batchId=JSON.parse('"'+batchMatch[1]+'"');}catch{throw error;}
  const results=[];
  let start=-1,depth=0,inString=false,escaped=false;
  for(let i=beginning;i<source.length;i++){
   const ch=source[i];
   if(inString){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inString=false;continue;}
   if(ch==='"'){inString=true;continue;}
   if(ch==='{' ){if(depth++===0)start=i;continue;}
   if(ch==='}'&&depth>0){
    if(--depth===0){
     try{
      const row=JSON.parse(source.slice(start,i+1));
      if(row&&typeof row==='object'&&!Array.isArray(row)&&
         Object.keys(row).sort().join(',')==='c,t'&&
         typeof row.t==='string'&&
         (row.c===null||typeof row.c==='string'&&row.c.length>0))
       results.push(row);
     }catch{}
    }
    continue;
   }
   if(ch===']'&&depth===0)break;
  }
  if(!results.length)throw error;
  return {response:{...(batchId===undefined?{}:{batch_id:batchId}),results},recovered:true};
 }
}

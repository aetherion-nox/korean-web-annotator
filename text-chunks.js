// Shared verbatim by the webpage and SRT plugins. Offsets always refer to the
// original UTF-16 text; neighboring evidence is for review, never analysis.
const MAX_CHARS=20000,CONTEXT_CHARS=1000;
const sentenceEnds=()=>/[.!?。！？][”’"')\]]*(?:\s+|$)/gu;
const high=c=>c>='\uD800'&&c<='\uDBFF';
const low=c=>c>='\uDC00'&&c<='\uDFFF';
function lastBoundary(text,pattern,accept=()=>true){
 let end=0;for(const m of text.matchAll(pattern))if(accept(m))end=m.index+m[0].length;return end;
}
function nearby(text,at,before){
 let start=before?Math.max(0,at-CONTEXT_CHARS):at;
 let end=before?at:Math.min(text.length,at+CONTEXT_CHARS);
 if(low(text[start])&&high(text[start-1]))start++;
 if(high(text[end-1])&&low(text[end]))end--;
 const window=text.slice(start,end),spans=[];let from=0;
 for(const m of window.matchAll(sentenceEnds())){
  const to=m.index+m[0].length;if(window.slice(from,to).trim())spans.push({start:from,end:to});from=to;
 }
 if(window.slice(from).trim())spans.push({start:from,end:window.length});
 if(spans.length<=2)return window;
 return before?window.slice(spans.at(-2).start):window.slice(0,spans[1].end);
}
export function splitText(text){
 const chunks=[];let start=0;
 while(start<text.length){
  let end=Math.min(start+MAX_CHARS,text.length);
  if(end<text.length){
   const searchStart=start+MAX_CHARS/2,window=text.slice(searchStart,end);
   // Newlines deliberately do not participate in horizontal whitespace.
   // The search window's edge is not the end of the real sentence: e.g. a
   // decimal point at unit 20,000 must not outrank a preceding safe space.
   const sentenceBoundary=lastBoundary(window,sentenceEnds(),m=>m.index+m[0].length<window.length||/\s$/u.test(m[0])||/\s/u.test(text[end]));
   const boundary=sentenceBoundary||lastBoundary(window,/[^\S\r\n\u2028\u2029]+/gu)||lastBoundary(window,/\r\n|[\r\n\u2028\u2029]+/gu);
   if(boundary)end=searchStart+boundary;
   if(high(text[end-1])&&low(text[end]))end--;
   if(text[end-1]==='\r'&&text[end]==='\n')end--;
  }
  chunks.push({start,end,text:text.slice(start,end)});start=end;
 }
 if(chunks.length>1)for(const chunk of chunks)chunk.adjacentContext={before:chunk.start?nearby(text,chunk.start,true):'',after:chunk.end<text.length?nearby(text,chunk.end,false):''};
 return chunks;
}

// Only DOM-relevant, source-position-bound fields may cross the worker/DOM
// boundary. A 7,600-character article context copied into 800 choices would
// otherwise create multi-megabyte RESULTS messages and checkpoints.
export function compactDomAnnotation(annotation){
 const {start,end,surface,replacement,type,entry_id,origin_source,confidence}=annotation||{};
 const result={start,end,surface,replacement,type};
 if(entry_id!==undefined)result.entry_id=entry_id;
 if(origin_source!==undefined)result.origin_source=origin_source;
 if(confidence!==undefined)result.confidence=confidence;
 return result;
}
export function compactDomAnnotations(annotations){
 return (annotations||[]).map(compactDomAnnotation);
}
// Bound DOM repaint events for one long article segment. Short paragraphs
// keep per-result progressive feedback, long paragraphs update in groups.
// A final validated commit is ALWAYS emitted without throttling.
export function shouldPublishPreview({sentenceChars=0,targetCount=0,lastCount=0,nextCount=0,hasPublished=false}={}){
 if(nextCount<=0)return hasPublished;
 const heavy=sentenceChars>2048||targetCount>120;
 return !heavy||!hasPublished||nextCount-lastCount>=48;
}

// The manual final answer and both API transports use this same ordered
// RESULTS/DONE channel. Streaming previews can be emitted without awaiting
// a storage checkpoint; the order must not depend on checkpoint write speed.
export function createOrderedResultRelay(post){
 let tail=Promise.resolve();
 return event=>{
  if(event?.type!=='RESULTS'&&event?.type!=='DONE')return post(event);
  const result=tail.then(()=>post(event));
  tail=result.catch(()=>{});
  return result;
 };
}

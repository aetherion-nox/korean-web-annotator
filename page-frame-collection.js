// A fixed 4.8-second wait on every page makes a warm, single-frame article
// feel as if the dictionary is loading. Instead wait just long enough for
// currently discovered child frames and recent frame navigations to settle.
// The original timeout remains a hard cap, not the ordinary latency.
export const FRAME_COLLECTION_MAX_MS=4800;
export const FRAME_COLLECTION_SINGLE_QUIET_MS=350;
export const FRAME_COLLECTION_MULTI_QUIET_MS=850;
export const FRAME_NAVIGATION_DEBOUNCE_MS=150;

export function nextFrameCollectionDelay({
 deadline,now,discovered=0,lastEventAt=0,unavailable=false
}){
 if(!Number.isFinite(deadline)||!Number.isFinite(now))
  throw Error('Frame collection clock required');
 const remaining=Math.max(0,deadline-now);
 if(unavailable)return remaining; // Unknown frame inventory: preserve old safety.
 const quiet=discovered>0?FRAME_COLLECTION_MULTI_QUIET_MS:FRAME_COLLECTION_SINGLE_QUIET_MS;
 const eventQuiet=lastEventAt>0?Math.max(0,lastEventAt+FRAME_COLLECTION_MULTI_QUIET_MS-now):0;
 return Math.max(0,Math.min(remaining,Math.max(quiet,eventQuiet)));
}

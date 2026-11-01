import {readModelContent} from './model-stream.js';
// Alibaba Cloud Model Studio OpenAI-compatible Chat Completions.
// Verified 2026-10-27: see docs/qwen-api.md for official references.
import './model-catalog.js';
export function qwenRequestSettings(config){
 const capability=globalThis.KRA_MODEL_CATALOG.resolve(config);
 const thinking=capability?.thinking==='required'||(capability?.thinking==='toggle'&&config.disableThinking===false);
 const body={stream:!capability||thinking||capability.streamOnly===true};
 // Earlier Qwen models accept response_format while thinking, but do not
 // guarantee JSON mode there. Retain the JSON prompt and local ID validation.
 if(capability&&(!thinking||capability.thinkingJson))body.response_format={type:'json_object'};
 return body;
}
// Keep the existing Qwen API helper for callers and contract tests.
export async function readQwenContent(response,signal,onStarted=()=>{},options={}){
 return readModelContent(response,{...options,signal,onStarted,protocol:'chat'});
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
 modelCheckpointWriter,recoverModelCheckpoints,clearModelCheckpoints
} from '../stream-result-journal.js';

function storage(){
 const state=new Map();
 return {
  state,
  async set(values){for(const [k,v] of Object.entries(values))state.set(k,v);},
  async get(keys){if(keys===null)return Object.fromEntries(state);return {};},
  async remove(keys){for(const k of keys)state.delete(k);}
 };
}
function result(id,replacement,provisional=false){
 return {type:'RESULTS',source:'model',provisional,operationId:'op',
  results:[{id,annotations:[{start:0,end:2,surface:'학교',replacement,
    type:'hanja'}],reviewed:[{start:0,end:2,surface:'학교'}]}]};
}
test('a complete response can be recovered after the worker disappears before port delivery',async()=>{
 const session=storage(),part={tabId:8,frameId:0,operationId:'op',url:'https://news.test/article'};
 const journal=modelCheckpointWriter(session,part);
 await journal.save(result('p0','學校'));
 await journal.save(result('p1','學敎'));
 const recovered=await recoverModelCheckpoints(session,part);
 assert.deepEqual(recovered.map(e=>e.results[0].id),['p0','p1']);
 assert.equal(recovered[0].results[0].annotations[0].replacement,'學校');
 assert.equal(await clearModelCheckpoints(session,part),2);
 assert.deepEqual(await recoverModelCheckpoints(session,part),[]);
});
test('partial live SSE preview is NEVER written as a durable complete result',async()=>{
 const session=storage(),part={tabId:1,frameId:0,operationId:'op',url:'https://news.test/article'};
 const journal=modelCheckpointWriter(session,part);
 assert.equal(await journal.save(result('p0','學校',true)),false);
 assert.deepEqual(await recoverModelCheckpoints(session,part),[]);
});
test('checkpoints are scoped to the exact live tab, iframe, URL and operation',async()=>{
 const session=storage(),part={tabId:3,frameId:7,operationId:'op',url:'https://news.test/frame'};
 await modelCheckpointWriter(session,part).save(result('p0','學校'));
 for(const invalid of [
  {...part,tabId:4},{...part,frameId:0},
  {...part,url:'https://news.test/other'},{...part,operationId:'other'}
 ]){
  assert.deepEqual(await recoverModelCheckpoints(session,invalid),[],
   JSON.stringify(invalid));
 }
 assert.equal((await recoverModelCheckpoints(session,part)).length,1);
});
test('journal stores neither API credentials nor incomplete provider text',async()=>{
 const session=storage(),part={tabId:3,frameId:0,operationId:'op',url:'https://news.test'};
 const item=result('p0','學校');
 await modelCheckpointWriter(session,part).save(item);
 const raw=JSON.stringify([...session.state.values()]);
 assert.ok(!raw.includes('Authorization'));
 assert.ok(!raw.includes('apiKey'));
 assert.ok(!raw.includes('messages'));
 assert.ok(!raw.includes('Bearer'));
});

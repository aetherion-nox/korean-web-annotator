import test from 'node:test';
import assert from 'node:assert/strict';
import {
 LOG_KEY,LOG_FULL_KEY,LOG_FULL_INDEX_KEY,LOG_FULL_LIMIT_KEY,
 LOG_ENABLED_KEY,FULL_RECORD_LIMIT,fullLogStorageKey,createRequestLogger
} from '../request-log.js';

function storage(initial={}){
 const db=new Map([[LOG_ENABLED_KEY,true],...Object.entries(initial)]);
 return {db,
  async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,db.get(k)]));},
  async set(values){for(const [key,value] of Object.entries(values))db.set(key,value);},
  async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])db.delete(key);}
 };
}
test('keeps 50 complete full exchanges by default, without the 2 MiB summary cap',async()=>{
 const local=storage(),logger=createRequestLogger(local),secret='sk-secret-123456';
 const huge='A'.repeat(2_100_000);
 const id=await logger.start({model:'test',headers:{Authorization:'Bearer '+secret},
  body:{messages:[{role:'user',content:huge}]}},[secret]);
 await logger.finish(id,{status:200,response:{raw:huge,parsed:{results:[]}}},[secret]);
 assert.equal((await logger.getFull(id)).body.messages[0].content.length,huge.length);
 assert.equal((await logger.getFull(id)).response.raw.length,huge.length);
 assert.equal((await logger.getFull(id)).headers.Authorization,'[REDACTED]');
 assert.equal(local.db.get(LOG_KEY)[0].truncated,true);
 for(let i=1;i<53;i++){
  const next=await logger.start({model:'test',body:{messages:[{role:'user',content:String(i)}]}});
  await logger.finish(next,{response:{raw:'response-'+i,parsed:{results:[]}}});
 }
 const list=await logger.list();
 assert.equal(list.limit,FULL_RECORD_LIMIT);
 assert.equal(list.records.length,50);
 assert.equal(await logger.getFull(id),null,'oldest full record was removed');
 assert.equal(list.records.at(-1).state,'completed');
 assert.ok(local.db.has(fullLogStorageKey(list.records.at(-1).id)));
 assert.equal(local.db.get(LOG_FULL_KEY).length,0,'old array was migrated and cleared');
 assert.ok((local.db.get(LOG_KEY)||[]).length<=50);
});

test('custom full-log limit prunes the oldest, deletes individual exchanges, and retains preference on clear',async()=>{
 const local=storage(),logger=createRequestLogger(local),ids=[];
 assert.equal(await logger.setLimit(4),4);
 for(let i=0;i<6;i++){
  const id=await logger.start({model:'test',body:{messages:[{role:'user',content:String(i)}]}});
  await logger.finish(id,{response:{parsed:{results:[]}}});ids.push(id);
 }
 assert.deepEqual((await logger.list()).records.map(x=>x.id),ids.slice(2));
 assert.equal(local.db.has(fullLogStorageKey(ids[0])),false);
 assert.equal(await logger.remove(ids[3]),true);
 assert.equal(await logger.remove(ids[3]),false);
 assert.deepEqual((await logger.list()).records.map(x=>x.id),[ids[2],ids[4],ids[5]]);
 assert.equal(local.db.has(fullLogStorageKey(ids[3])),false);
 assert.equal(local.db.get(LOG_KEY).some(x=>x.id===ids[3]),false);
 await assert.rejects(logger.setLimit(0),/1～500/);
 await assert.rejects(logger.setLimit(501),/1～500/);
 await logger.clear();
 assert.deepEqual((await logger.list()).records,[]);
 assert.deepEqual(local.db.get(LOG_KEY),[]);
 assert.equal(local.db.get(LOG_FULL_LIMIT_KEY),4);
});

test('migrates the prior three complete records to independent keys without losing their response',async()=>{
 const old={id:'legacy-1',model:'deepseek',startedAt:'2026-11-16T00:00:00Z',
  body:{messages:[{role:'user',content:'본문'}]},response:{parsed:{results:[{t:'t0',c:'c0'}]}}};
 const local=storage({[LOG_FULL_KEY]:[old]});
 const logger=createRequestLogger(local);
 const list=await logger.list();
 assert.deepEqual(list.records.map(x=>x.id),['legacy-1']);
 assert.deepEqual((await logger.getFull('legacy-1')).response.parsed,old.response.parsed);
 assert.deepEqual(local.db.get(LOG_FULL_KEY),[]);
});

test('deleting an active record cannot resurrect it from a late response',async()=>{
 const local=storage(),logger=createRequestLogger(local),id=await logger.start({model:'test'});
 await logger.remove(id);
 await logger.finish(id,{response:{parsed:{results:[]}}});
 assert.equal(await logger.getFull(id),null);
});

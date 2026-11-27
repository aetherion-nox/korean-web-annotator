import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('browser session and persistent bypass survive worker recreation but only persistent survives exit',async()=>{
 const src=read('service-worker.js');
 const snippet=src.slice(src.indexOf('async function cacheBypassEnabled('),src.indexOf('async function startWholePageForTab('));
 const local={},session={};
 const storage=state=>({get:async key=>({[key]:state[key]})});
 const create=()=>{const ctx={chrome:{storage:{session:storage(session),local:storage(local)}}};vm.createContext(ctx);vm.runInContext(snippet,ctx);return ctx.cacheBypassEnabled};
 assert.equal(await create()(),false);
 session.sessionForceRegenerate=true;
 assert.equal(await create()(),true);
 assert.equal(await create()(),true);
 delete session.sessionForceRegenerate;
 assert.equal(await create()(),false);
 local.persistentForceRegenerate=true;
 assert.equal(await create()(),true);
 delete local.persistentForceRegenerate;
 assert.equal(await create()(),false);
 assert.equal(await create()(true),true);
});
test('popup persistent control is conditional, disables temporary control and saves independently',()=>{
 const src=read('popup.js'),html=read('popup.html');
 assert.match(html,/id="persistentForceRow"[^>]*hidden/);
 assert.match(src,/forceRegenerate\.disabled=persistentForceRegenerate\.checked/);
 assert.match(src,/persistentForceRow\.hidden=!effectiveForceRegenerate\(\)/);
 assert.match(src,/storage\.session\.set\(\{sessionForceRegenerate:/);
 assert.match(src,/storage\.local\.set\(\{persistentForceRegenerate:/);
 assert.match(read('service-worker.js'),/forceRegenerate:await cacheBypassEnabled\(message\.forceRegenerate\)/);
});
test('protected-person target generation and repair guards remain in place',()=>{
 assert.match(read('python/backend/analysis.py'),/overlaps_proper_noun\(a,b,protected_names\+dictionary_names\+suspect_ranges\+conflicting_ranges\):continue/);
 assert.match(read('repair-validation-core.js'),/choice_id!==null&&protectedRange/);
});

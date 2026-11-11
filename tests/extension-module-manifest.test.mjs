import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('paragraph and recovery modules use the stable resource mode from v1.1.55.4',()=>{
 const manifest=JSON.parse(read('manifest.json'));
 assert.equal(manifest.version,'1.1.55.6');
 const entries=manifest.web_accessible_resources||[];
 assert.ok(entries.length>0);
 for(const entry of entries)assert.notEqual(entry.use_dynamic_url,true,
  'content-script dynamic imports must not require dynamic host URLs');
 const exposed=new Set(entries.flatMap(e=>e.resources||[]));
 for(const module of ['paragraph-plan.js','text-chunks.js','offline-manual-recovery.js'])
  assert.ok(exposed.has(module),module+' must be web accessible');
 const content=read('content.js');
 assert.match(content,/import\(chrome\.runtime\.getURL\('paragraph-plan\.js'\)\)/);
 assert.match(content,/paragraphModule=null/, 'failed imports must be retryable');
});

test('every extension module loaded by the content script has accessible dependencies',()=>{
 const manifest=JSON.parse(read('manifest.json'));
 const exposed=new Set(manifest.web_accessible_resources.flatMap(e=>e.resources||[]));
 const seen=new Set();
 function visit(file){
  assert.ok(exposed.has(file),file+' is not web accessible');
  assert.ok(fs.existsSync(path.join(root,file)),file+' is missing');
  if(seen.has(file))return;
  seen.add(file);
  const src=read(file);
  for(const match of src.matchAll(/^import\s+(?:[^'"]+?\s+from\s+)?['"]\.\/([^'"]+)['"]/gm))
   visit(match[1]);
 }
 visit('paragraph-plan.js');
 visit('offline-manual-recovery.js');
});

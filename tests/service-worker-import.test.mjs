import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {analyzeLocal,engineStatus} from '../local-engine.js';

test('service worker imports both analysis and status functions used by dictionary-free mode',async()=>{
 const source=await readFile(new URL('../service-worker.js',import.meta.url),'utf8');
 const declaration=source.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/local-engine\.js['"]/);
 assert.ok(declaration,'service-worker must import its local engine dependencies');
 const symbols=new Set(declaration[1].split(',').map(x=>x.trim()));
 for(const name of ['engineConfig','engineStatus','analyzeLocal'])
  assert.ok(symbols.has(name),name+' is used by the service worker and must be imported');
 assert.equal(typeof analyzeLocal,'function');
 assert.equal(typeof engineStatus,'function');
 assert.match(source,/=>analyzeLocal\(/);
});

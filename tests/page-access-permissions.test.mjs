import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const manifest=JSON.parse(source('manifest.json'));
const popup=source('popup.js'),worker=source('service-worker.js'),content=source('content.js');
const options=source('options.js'),pkg=JSON.parse(source('package.json'));

test('website host permissions cover HTTP/HTTPS top frames and cross-origin iframes',()=>{
 assert.equal(manifest.version,'1.1.56.2');
 assert.equal(pkg.version,manifest.version);
 assert.ok(manifest.host_permissions?.includes('https://*/*'));
 assert.ok(manifest.host_permissions?.includes('http://*/*'));
 assert.equal(manifest.optional_host_permissions,undefined,'Do not overlap required and optional web host permissions');
 const scripts=manifest.content_scripts;
 assert.equal(scripts.length,1);
 assert.deepEqual(scripts[0].matches,['http://*/*','https://*/*']);
 assert.equal(scripts[0].all_frames,true);
 assert.equal(scripts[0].match_about_blank,true);
 assert.equal(scripts[0].match_origin_as_fallback,true);
});

test('popup, worker and content script have exactly matching live script version',()=>{
 const version='1.1.56.2-page-access';
 assert.match(popup,/const CONTENT_SCRIPT_VERSION = '1\\.1\\.56\\.2-page-access';/);
 assert.match(worker,/const CONTENT_SCRIPT_VERSION='1\\.1\\.56\\.2-page-access';/);
 assert.match(content,/const VERSION = '1\\.1\\.56\\.2-page-access';/);
 for(const file of [popup,worker,content])assert.ok(file.includes(version));
 assert.doesNotMatch(popup,/1\\.1\\.55\\.4-primary-toolbar-only/);
 assert.doesNotMatch(worker,/1\\.1\\.55\\.4-primary-toolbar-only/);
});

test('permission-denied injections report actionable site-access guidance',()=>{
 for(const script of [popup,worker]){
  assert.match(script,/chrome\\.scripting\\.insertCSS/);
  assert.match(script,/chrome\\.scripting\\.executeScript/);
  assert.match(script,/Extension manifest must request permission/);
  assert.match(script,/网站访问权限|访问当前网站/);
  assert.match(script,/chrome:\\/\\//);
 }
 assert.match(worker,/dispatchChildFrameBatch/);
 assert.match(worker,/ensureContentScriptInFrame\\(tabId,frame\\.frameId\\)/);
});

test('API configuration verifies persistent website permissions without optional-request prompts',()=>{
 assert.match(options,/async function requestEndpointPermission/);
 assert.match(options,/chrome\\.permissions\\.contains\\(\\{origins:\\[originPattern\\]\\}\\)/);
 assert.doesNotMatch(options,/chrome\\.permissions\\.request\\(\\{ origins:\\[originPattern\\] \\}\\)/);
});

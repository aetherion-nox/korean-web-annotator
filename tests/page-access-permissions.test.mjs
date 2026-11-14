import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const manifest=JSON.parse(source('manifest.json'));
const popup=source('popup.js'),worker=source('service-worker.js'),content=source('content.js');
const options=source('options.js'),pkg=JSON.parse(source('package.json'));

test('website host permissions cover HTTP/HTTPS top frames and cross-origin iframes',()=>{
 assert.equal(manifest.version,'1.1.56.31');
 assert.equal(pkg.version,manifest.version);
 assert.ok(manifest.host_permissions?.includes('https://*/*'));
 assert.ok(manifest.host_permissions?.includes('http://*/*'));
 assert.equal(manifest.optional_host_permissions,undefined);
 const scripts=manifest.content_scripts;
 assert.equal(scripts.length,1);
 assert.deepEqual(scripts[0].matches,['http://*/*','https://*/*']);
 assert.equal(scripts[0].all_frames,true);
 assert.equal(scripts[0].match_about_blank,true);
 assert.equal(scripts[0].match_origin_as_fallback,true);
});

test('popup, worker and content script share the current content-script version',()=>{
 const version='1.1.56.31-wikisource-dd-toc-performance';
 assert.ok(popup.includes("const CONTENT_SCRIPT_VERSION = '"+version+"';"));
 assert.ok(worker.includes("const CONTENT_SCRIPT_VERSION='"+version+"';"));
 assert.ok(content.includes("const VERSION = '"+version+"';"));
 for(const script of [popup,worker,content]){
  assert.ok(script.includes(version));
  assert.ok(!script.includes('1.1.55.4-primary-toolbar-only'));
 }
});

test('permission-denied injections report actionable site-access guidance',()=>{
 for(const script of [popup,worker]){
  assert.ok(script.includes('chrome.scripting.insertCSS'));
  assert.ok(script.includes('chrome.scripting.executeScript'));
  assert.ok(script.includes('Extension manifest must request permission'));
  assert.ok(script.includes('网站访问权限')||script.includes('访问当前网站'));
  assert.ok(script.includes('chrome://'));
 }
 assert.ok(worker.includes('dispatchChildFrameBatch'));
 assert.ok(worker.includes('ensureContentScriptInFrame(tabId,frame.frameId)'));
});

test('API configuration verifies persistent website permissions without optional-request prompts',()=>{
 assert.ok(options.includes('async function requestEndpointPermission'));
 assert.ok(options.includes('chrome.permissions.contains({origins:[originPattern]})'));
 assert.ok(!options.includes('chrome.permissions.request({ origins:[originPattern] })'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createEnginePreloader} from '../engine-preload.js';

test('browser startup default-on preload joins simultaneous requests and reuses initialized engine',async()=>{
 let exists=0,loads=0,ready=false;
 const warm=async()=>{
  if(!ready){loads++;ready=true;}
  return {ready:true,preloaded:true};
 };
 const settings={get:async()=>({preloadEngineOnStartup:true})};
 const preloader=createEnginePreloader({settings,
  info:async()=>{exists++;return {imported:true};},warm});
 const results=await Promise.all([preloader.run(),preloader.run(),preloader.run()]);
 assert.equal(exists,1,'concurrent startup paths share one preload');
 assert.ok(results.every(result=>result.ready));
 await preloader.run();
 assert.equal(loads,1,'subsequent startup check reuses warm offscreen engine');
});

test('preload starts automatically unless explicitly switched off',async()=>{
 let loaded=0,lookup=0;
 const factory=enabled=>createEnginePreloader({
  settings:{get:async()=>({preloadEngineOnStartup:enabled})},
  info:async()=>{lookup++;return {imported:true};},
  warm:async()=>{loaded++;return {ready:true};}
 });
 await factory(false).run();
 assert.equal(loaded,0);assert.equal(lookup,0);
 await factory(undefined).run();
 assert.equal(loaded,1);assert.equal(lookup,1);
});

test('onStartup warms preserved dictionary once, then offscreen worker is reused across page requests',()=>{
 const script=fs.readFileSync(new URL('../service-worker.js',import.meta.url),'utf8');
 const engine=fs.readFileSync(new URL('../engine-page.js',import.meta.url),'utf8');
 const kiwi=fs.readFileSync(new URL('../browser-worker.js',import.meta.url),'utf8');
 assert.ok(script.includes('chrome.runtime.onStartup.addListener(() => {\n  preloadEngine();'));
 assert.ok(script.includes('chrome.runtime.onInstalled.addListener(() => {\n  preloadEngine();'));
 assert.ok(engine.includes("if(request.action==='warmup'&&preloaded)return"));
 assert.ok(engine.includes('if(worker)return worker'));
 assert.ok(engine.includes("if(!hydrated&&request.action!=='import')"));
 assert.ok(kiwi.includes('if(initialization)return initialization'));
 assert.ok(kiwi.includes('if(kiwiInitialization)return kiwiInitialization'));
 assert.ok(engine.includes("if(request.action==='import')"));
});

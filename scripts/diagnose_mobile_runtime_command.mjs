import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

const chunks=fs.readFileSync('text-chunks.js','utf8')
 .replace('export function splitText','function splitText');
const planner=fs.readFileSync('paragraph-plan.js','utf8')
 .replace("import {splitText} from './text-chunks.js';",'')
 .replace('export function createParagraphPlan','function createParagraphPlan');
const enginePlan='(()=>{'+chunks+'\n'+planner+'\nwindow.__KRA_TEST_PLAN__=createParagraphPlan;})();';
let content=fs.readFileSync('content.js','utf8');
if(!content.includes('  let createParagraphPlan;'))throw Error('Missing function injection anchor');
content=content.replace('  let createParagraphPlan;',
 '  let createParagraphPlan=globalThis.__KRA_TEST_PLAN__;');
const close=content.lastIndexOf('})();');
if(close<0)throw Error('Missing script end');
content=content.slice(0,close)+
 '  globalThis.__KRA_TEST_START__=()=>startAnnotation({modes:{hanja:true,loanword:true},forceRegenerate:true});\n'+
 content.slice(close);

const mocks=`(()=>{
 const listeners=[];
 const runtime={
  onMessage:{addListener:callback=>listeners.push(callback)},
  getURL:path=>'https://fake-extension.invalid/'+path,
  sendMessage:async message=>message?.type==='GET_UI_SETTINGS'
    ?{ok:true,uiSettings:{mobileSelectionToolbar:false,floatingBallEnabled:false,
        toolbarHangulOnly:false,restoreExistingAnnotations:true,stopAutoAfterPageComplete:true}}:{ok:true},
  connect(){
   let callback=null;
   return {onMessage:{addListener:cb=>{callback=cb}},
    onDisconnect:{addListener:()=>{}},disconnect(){},
    postMessage(message){
     if(message.type!=='START')return;
     window.__KRA_TEST_START_MESSAGE__=message;
     const target=message.sentences.find(s=>s.text.includes('민주공화국'));
     if(!target){window.__KRA_TEST_PORT_ERROR__='Missing target from browser command';return;}
     const start=target.text.indexOf('민주공화국');
     setTimeout(()=>{callback?.({type:'DONE',source:'local',operationId:message.operationId,
        results:[{id:target.id,annotations:[{type:'hanja',start,end:start+5,
          surface:'민주공화국',replacement:'民主共和國',entry_id:998}]}],
        stats:{local_determined:1,pending:0,model_accepted:0}})},30);
    }};
  }
 };
 Object.defineProperty(window,'chrome',{value:{runtime},configurable:true});
})();`;
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try {
 const ctx=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:2.75,
  isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36'});
 const page=await ctx.newPage();
 const jsErrors=[];page.on('pageerror',error=>jsErrors.push(String(error)));
 await page.route('**/*',route=>route.abort());
 await page.setContent(fs.readFileSync('mobile_mobile_host.html','utf8').replace('client-nojs','client-js'),{waitUntil:'domcontentloaded'});
 if(fs.existsSync('mobile-styles.css'))await page.addStyleTag({path:'mobile-styles.css'});
 await page.addScriptTag({content:enginePlan});
 await page.addScriptTag({content:mocks});
 await page.addScriptTag({content});
 const start=await page.evaluate(()=>window.__KRA_TEST_START__());
 console.log('FULL_RUNTIME_START',JSON.stringify(start));
 await page.waitForTimeout(700);
 const result=await page.evaluate(()=>({
   sent:window.__KRA_TEST_START_MESSAGE__?.sentences.length,
   targetInRequest:window.__KRA_TEST_START_MESSAGE__?.sentences.some(s=>s.text.includes('민주공화국')),
   runtimeError:window.__KRA_TEST_PORT_ERROR__,
   ruby:!!document.querySelector('#mf-section-2 ruby[kra-annotated]'),
   display:window.__KRA_PIPELINE_STATUS__?.display,
   diagnostics:[...document.querySelectorAll('.kra-diagnostics li')].map(x=>x.textContent).slice(-3),
   displayedStatus:document.querySelector('.kra-task-label')?.textContent
 }));
 console.log('FULL_RUNTIME_DONE',JSON.stringify({...result,jsErrors}));
 assert.ok(start.ok&&start.started,'real content script must start the command');
 assert.ok(result.sent>100,'the real backend START must receive all folded paragraph inputs');
 assert.ok(result.targetInRequest,'folded source must reach the backend START message');
 assert.ok(result.ruby,'the actual real content-script DONE handler must display a folded-section ruby');
 assert.ok(result.display?.rendered_annotations>=1,'real DONE display metrics must report the inserted ruby');
 // The saved HTML itself includes a site script that reads document.cookie.
 // About:blank snapshots have an opaque origin, unlike the real HTTPS site.
 const pluginErrors=jsErrors.filter(e=>!e.includes("Failed to read the 'cookie' property"));
 assert.deepEqual(pluginErrors,[],'the extension pipeline must not throw JS exceptions');
 await ctx.close();
}finally{await browser.close();}

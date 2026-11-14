import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

const chrome=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try {
 const context=await chrome.newContext({viewport:{width:393,height:852},deviceScaleFactor:2.75,isMobile:true,hasTouch:true,
   userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36'});
 const page=await context.newPage();
 await page.route('**/*',route=>route.abort());
 const html=fs.readFileSync('mobile_mobile_host.html','utf8').replace('client-nojs','client-js');
 await page.setContent(html,{waitUntil:'domcontentloaded'});
 if(fs.existsSync('mobile-styles.css'))await page.addStyleTag({path:'mobile-styles.css'});
 const source=fs.readFileSync('content.js','utf8');
 const part=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);if(i<0||j<0)throw Error('Missing source '+a);return source.slice(i,j)};
 const harness=[
 '(()=>{const OWN_RUBY=\'ruby[kra-annotated="true"]\';',
 'let uiSettings={recognizeCollapsedContent:true};',
 'let lastScanStats=null;',
 'const recoveryBlocks=new Set(),ownDomChanges=new WeakSet(),seenSources=new Set();',
 'const analyzedNodeVersions=new WeakMap();',
 'let recoveryPage=null;',
 'function rememberRecovery(){}',
 part('  function sourceOf','  function pageIdentity'),
 part('  function selectedIntervals','  function applySettings'),
 part('  function openTextRoots','  function isKnownRecoverySource'),
 part('  function loanwordDisplay','  function findRepaintedTextNode'),
 part('  function insertConversions','  // Cheap, read-only child-frame preflight.'),
 'window.__kraMobileDiagnostic={',
 '  setEnabled(v){uiSettings.recognizeCollapsedContent=v;},',
 '  scan(){',
 '    const nodes=collectTextNodes();',
 '    const inSection=[...nodes.values()].filter(e=>e.node.parentElement.closest("#mf-section-2"));',
 '    return {total:nodes.size,inSection:inSection.length,sectionCharacters:inSection.reduce((n,e)=>n+e.text.length,0),',
 '      sample:inSection.map(e=>e.text.trim()).filter(Boolean).slice(0,7),stats:lastScanStats};',
 '  },',
 '  paint(){',
 '    const nodes=collectTextNodes();',
 '    const target=[...nodes.values()].find(e=>e.node.parentElement.closest("#mf-section-2")&&e.text.includes("민주공화국"));',
 '    if(!target)return {ok:false,reason:"No eligible node in collapsed 조문"};',
 '    const start=target.text.indexOf("민주공화국");',
 '    target.annotations=[{start,end:start+5,surface:"민주공화국",replacement:"民主共和國",type:"hanja",entry_id:101}];',
 '    const inserted=insertConversions(new Map([[target.node,target]]),[]);',
 '    const ruby=document.querySelector("#mf-section-2 ruby[kra-annotated=true]");',
 '    return {ok:!!ruby,inserted,html:ruby?.outerHTML,connected:ruby?.isConnected,',
 '      sectionClass:document.querySelector("#mf-section-2")?.className};',
 '  }',
 '};})()'
 ].join('\n');
 const before=await page.evaluate(()=>{
   const sec=document.querySelector('#mf-section-2'),el=sec?.querySelector('dd,li,p');
   const c=sec?getComputedStyle(sec):null,d=el?getComputedStyle(el):null;
   return {htmlClass:document.documentElement.className,bodyClass:document.body.className,
      section:sec?.outerHTML.slice(0,270),sectionClass:sec?.className,
      sectionComputed:c?{display:c.display,visibility:c.visibility,contentVisibility:c.contentVisibility}:null,
      firstContent:d?{tag:el.tagName,display:d.display,visibility:d.visibility}:null,
      sectionTextLength:sec?.textContent?.length,rootCollapsed:!!document.body.classList.contains('mf-collapsible-sections'),
      headings:[...document.querySelectorAll('.section-heading')].map(e=>e.textContent.trim()).slice(0,8)};
 });
 console.log('MOBILE_BEFORE',JSON.stringify(before));
 assert.equal(before.sectionComputed?.display,'none','real mobile section must be CSS-closed before scan');
 assert.equal(before.sectionTextLength,17546,'the authentic 조문 source is 17546 characters');
 await page.addScriptTag({content:harness});
 const initialOn=await page.evaluate(()=>window.__kraMobileDiagnostic.scan());
 console.log('MOBILE_SCAN_INITIAL_ON',JSON.stringify(initialOn));
 assert.ok(initialOn.inSection>300,'ON must scan the actual folded mobile article section');
 assert.ok(initialOn.sectionCharacters>16000,'ON should capture almost all 17546 source characters');
 await page.evaluate(()=>window.__kraMobileDiagnostic.setEnabled(false));
 const initialOff=await page.evaluate(()=>window.__kraMobileDiagnostic.scan());
 console.log('MOBILE_SCAN_INITIAL_OFF',JSON.stringify(initialOff));
 assert.equal(initialOff.inSection,0,'OFF must skip the folded Minerva section');
 await page.evaluate(()=>{
   const sec=document.querySelector('#mf-section-2');
   sec?.classList.remove('open-block');
   sec?.classList.remove('is-open');
 });
 console.log('MOBILE_CLOSED_CSS',JSON.stringify(await page.evaluate(()=>{
  const sec=document.querySelector('#mf-section-2');
  return {className:sec?.className,display:sec?getComputedStyle(sec).display:null,
    firstLi:sec?.querySelector('dd,li,p')?getComputedStyle(sec.querySelector('dd,li,p')).display:null};
 })));
 await page.evaluate(()=>window.__kraMobileDiagnostic.setEnabled(true));
 const closedOn=await page.evaluate(()=>window.__kraMobileDiagnostic.scan());
 console.log('MOBILE_SCAN_CLOSED_ON',JSON.stringify(closedOn));
 assert.ok(closedOn.inSection>300);
 await page.evaluate(()=>window.__kraMobileDiagnostic.setEnabled(false));
 const closedOff=await page.evaluate(()=>window.__kraMobileDiagnostic.scan());
 console.log('MOBILE_SCAN_CLOSED_OFF',JSON.stringify(closedOff));
 assert.equal(closedOff.inSection,0);
 await page.evaluate(()=>window.__kraMobileDiagnostic.setEnabled(true));
 const paint=await page.evaluate(()=>window.__kraMobileDiagnostic.paint());
 console.log('MOBILE_PAINT_CLOSED',JSON.stringify(paint));
 assert.equal(paint.ok,true,'the actual insertConversions must paint while Minerva is folded');
 assert.equal(paint.connected,true);
 assert.ok(!paint.sectionClass.includes('open-block'),'the plugin must not expand the section');
 await page.evaluate(()=>document.querySelector('#mf-section-2')?.classList.add('open-block'));
 const expanded=await page.evaluate(()=>{
   const ruby=document.querySelector('#mf-section-2 ruby[kra-annotated=true]');
   const sec=document.querySelector('#mf-section-2');
   return {ruby:!!ruby,sectionDisplay:sec?getComputedStyle(sec).display:null,rubyHTML:ruby?.outerHTML};
 });
 console.log('MOBILE_AFTER_EXPAND',JSON.stringify(expanded));
 assert.equal(expanded.ruby,true,'annotation must remain after opening the section');
 assert.equal(expanded.sectionDisplay,'block');
 console.log('PASS: authentic Minerva 조문 folded scan and annotation insert');
} finally {await chrome.close();}

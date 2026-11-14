import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.route('**/*',route=>route.abort());
 const html=fs.readFileSync('toc-page.html','utf8').replace('client-nojs','client-js');
 await page.setContent(html,{waitUntil:'domcontentloaded'});
 if(fs.existsSync('toc-styles.css'))await page.addStyleTag({path:'toc-styles.css'});
 const code=fs.readFileSync('content.js','utf8');
 function part(a,b) {
   const start=code.indexOf(a),end=code.indexOf(b,start);
   if(start<0||end<0)throw Error('Missing source anchor '+a);
   return code.slice(start,end);
 }
 const source=part('  function sourceOf','  function pageIdentity');
 const selection=part('  function selectedIntervals','  function applySettings');
 const collector=part('  function openTextRoots','  function isKnownRecoverySource');
 const renderHelpers=part('  function loanwordDisplay','  function findRepaintedTextNode');
 const render=part('  function insertConversions','  // Cheap, read-only child-frame preflight.');
 const harness=[
 '(()=>{',
 'const OWN_RUBY=\'ruby[kra-annotated="true"]\';',
 'let uiSettings={recognizeCollapsedContent:true};',
 'let lastScanStats=null;',
 'const recoveryBlocks=new Set(),ownDomChanges=new WeakSet(),seenSources=new Set();',
 'const analyzedNodeVersions=new WeakMap();',
 'let recoveryPage=null;',
 'function rememberRecovery(){}',
 source,selection,collector,renderHelpers,render,
 'window.__kraDiagnostic={',
 'setEnabled(value){uiSettings.recognizeCollapsedContent=value;},',
 'scan(){',
 '  const nodes=collectTextNodes();',
 '  const inToc=[...nodes.values()].filter(e=>e.node.parentElement.closest("#toc-조문-sublist"));',
 '  const inArticle=[...nodes.values()].filter(e=>e.node.parentElement.closest(".mw-parser-output"));',
 '  return {stats:lastScanStats,found:nodes.size,tocNodeCount:inToc.length,articleNodeCount:inArticle.length,',
 '    titles:inToc.map(e=>e.text.trim()).filter(Boolean).slice(0,20),',
 '    articleSample:inArticle.map(e=>e.text.trim()).filter(Boolean).slice(0,4)};',
 '},',
 'paint(){',
 '  const nodes=collectTextNodes();',
 '  const target=[...nodes.values()].find(e=>e.node.parentElement.closest("#toc-조문-sublist")&&e.text.includes("총강"));',
 '  if(!target) return {ok:false,reason:"no target node in folded subsection"};',
 '  const start=target.text.indexOf("총강");',
 '  target.annotations=[{start,end:start+2,surface:"총강",replacement:"總綱",type:"hanja",entry_id:101}];',
 '  const inserted=insertConversions(new Map([[target.node,target]]),[]);',
 '  const ruby=document.querySelector(\'#toc-조문-sublist ruby[kra-annotated="true"]\');',
 '  return {ok:!!ruby,inserted,connected:ruby?.isConnected,outerHTML:ruby?.outerHTML,',
 '    parentTag:ruby?.closest("li")?.tagName,headerClosed:!document.querySelector("#toc-조문").classList.contains("vector-toc-list-item-expanded")};',
 '}',
 '};',
 '})()'
 ].join('\n');
 await page.evaluate(()=>document.querySelector('#toc-조문')?.classList.remove('vector-toc-list-item-expanded'));
 const before=await page.evaluate(()=>{
   const submenu=document.querySelector('#toc-조문-sublist');
   const li=submenu?.querySelector(':scope > li');
   return {exists:!!submenu,count:submenu?.querySelectorAll(':scope > li')?.length,
      css:li?getComputedStyle(li).display:null,
      expanded:document.querySelector('#toc-조문')?.classList.contains('vector-toc-list-item-expanded'),
      innerText:submenu?.innerText?.slice(0,60),textContent:submenu?.textContent?.slice(0,60)};
 });
 console.log('CLOSED_BEFORE',JSON.stringify(before));
 assert.equal(before.expanded,false);
 assert.equal(before.css,'none','Vector CSS must actually hide the child LI');
 await page.addScriptTag({content:harness});
 const on=await page.evaluate(()=>window.__kraDiagnostic.scan());
 console.log('SCAN_ON',JSON.stringify(on));
 assert.ok(on.tocNodeCount>5,'ON must discover multiple folded 조문 headings');
 await page.evaluate(()=>window.__kraDiagnostic.setEnabled(false));
 const off=await page.evaluate(()=>window.__kraDiagnostic.scan());
 console.log('SCAN_OFF',JSON.stringify(off));
 assert.equal(off.tocNodeCount,0,'OFF must skip folded 조문 headings');
 await page.evaluate(()=>window.__kraDiagnostic.setEnabled(true));
 const paint=await page.evaluate(()=>window.__kraDiagnostic.paint());
 console.log('FOLDED_PAINT',JSON.stringify(paint));
 assert.equal(paint.ok,true,'real insertConversions must annotate while folded');
 assert.equal(paint.headerClosed,true,'must not open the website TOC to paint');
 await page.evaluate(()=>document.querySelector('#toc-조문')?.classList.add('vector-toc-list-item-expanded'));
 const shown=await page.evaluate(()=>{
   const ruby=document.querySelector('#toc-조문-sublist ruby[kra-annotated="true"]');
   const li=ruby?.closest('li');
   return {rubies:document.querySelectorAll('#toc-조문-sublist ruby[kra-annotated="true"]').length,
     visible:!!li && getComputedStyle(li).display!=='none',
     text:ruby?.textContent,outerHTML:ruby?.outerHTML};
 });
 console.log('EXPANDED_AFTER_PAINT',JSON.stringify(shown));
 assert.equal(shown.visible,true);
 assert.equal(shown.rubies,1);
 console.log('PASS: 조문 nested TOC scanned and painted while folded');
 await browser.close();
} catch(err){await browser.close();throw err;}

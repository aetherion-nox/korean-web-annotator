import {chromium} from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const url='https://ko.m.wikisource.org/wiki/대한민국헌법_(제10호)';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--ignore-certificate-errors']});
try{
 const context=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:2.75,
  isMobile:true,hasTouch:true,ignoreHTTPSErrors:true,userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36'});
 const page=await context.newPage();
 let loaded=false;
 try{
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});
  loaded=true;
  console.log('LIVE_NAVIGATE',JSON.stringify({status:response?.status(),url:page.url()}));
  await page.waitForTimeout(1500);
  const before=await page.evaluate(()=>{
   const section=document.querySelector('#mf-section-2');
   return {hasSection:!!section,textLength:section?.textContent?.length,
     css:section?getComputedStyle(section).display:null,
     openFunction:typeof window.mfTempOpenSection,heading:!!document.querySelector('[onclick*="mfTempOpenSection(2)"]')};
  });
  console.log('LIVE_BEFORE',JSON.stringify(before));
  const actual=await page.evaluate(()=>{
    const title=document.querySelector('#조문'), dd=document.querySelector('.mw-parser-output dd');
    const trail=el=>{const arr=[];for(let i=0;el&&i<12;i++,el=el.parentElement){
      const css=getComputedStyle(el);
      arr.push({tag:el.tagName,id:el.id,classes:String(el.className||'').slice(0,110),
       display:css.display,visibility:css.visibility,hidden:el.hidden,
       textLength:el.textContent?.length||0});
    }return arr;};
    return {url:location.href,title:document.title,bodyClasses:document.body.className,
     htmlClasses:document.documentElement.className,
     sectionCount:document.querySelectorAll('.mw-parser-output section').length,
     foldedCount:document.querySelectorAll('.collapsible-block').length,
     firstSection:document.querySelector('.mw-parser-output section')?.outerHTML.slice(0,350),
     h2s:[...document.querySelectorAll('h2')].map(e=>e.textContent?.slice(0,40)).slice(0,12),
     jomun:!!title,jomunTrail:trail(title),ddTrail:trail(dd),
     mainTextLength:document.querySelector('.mw-parser-output')?.textContent?.length,
     firstDD:dd?.textContent.slice(0,160)};
  });
  console.log('LIVE_DOM_STRUCTURE',JSON.stringify(actual));
  // The live page no longer has id="mf-section-2"; inspect and annotate
  // the post-hydration mf-section-2 class with the extension's actual scanner.
  const source=fs.readFileSync('content.js','utf8');
  const part=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);if(i<0||j<i)throw Error('missing '+a);return source.slice(i,j);};
  const harness=[
    '(()=>{',
    "const OWN_RUBY='ruby[kra-annotated=\"true\"]';",
    'let uiSettings={};let lastScanStats=null;',
    'const ownDomChanges=new WeakSet(),seenSources=new Set(),recoveryBlocks=new Set();',
    'const analyzedNodeVersions=new WeakMap();',
    'function rememberRecovery(){}',
    part('  function sourceOf','  function pageIdentity'),
    part('  function selectedIntervals','  function applySettings'),
    part('  function openTextRoots','  function isKnownRecoverySource'),
    part('  function loanwordDisplay','  function findRepaintedTextNode'),
    part('  function insertConversions','  // Cheap, read-only child-frame preflight.'),
    'window.__KRA_LIVE_CHECK__=()=>{',
    ' const section=document.querySelector(".mw-parser-output > section.mf-section-2.collapsible-block");',
    ' const entries=collectTextNodes();',
    ' const inSection=[...entries.values()].filter(e=>section?.contains(e.node));',
    ' const target=inSection.find(e=>e.text.includes("민주공화국"));',
    ' if(!target)return {found:!!section,inSection:inSection.length,stats:lastScanStats};',
    ' const start=target.text.indexOf("민주공화국");',
    ' target.annotations=[{type:"hanja",start,end:start+5,surface:"민주공화국",replacement:"民主共和國",entry_id:998}];',
    ' const rendered=insertConversions(new Map([[target.node,target]]),[]);',
    ' return {found:!!section,inSection:inSection.length,rendered,ruby:!!section.querySelector("ruby[kra-annotated]"),',
    '   oldId:section.id,hidden:section.getAttribute("hidden"),',
    '   css:{display:getComputedStyle(section).display,contentVisibility:getComputedStyle(section).contentVisibility},',
    '   stats:lastScanStats};',
    '};})();'
  ].join('\n');
  await page.addScriptTag({content:harness});
  const liveScan=await page.evaluate(()=>window.__KRA_LIVE_CHECK__());
  console.log('LIVE_SCANNER_BEFORE_EXPAND',JSON.stringify(liveScan));
  assert.ok(liveScan.inSection>300,'post-hydration Minerva article must have all clause nodes analyzed');
  assert.ok(liveScan.ruby,'one real known conversion must paint while section is hidden until found');
  try{
    await page.locator('#조문').click({force:true,timeout:4000});
    await page.waitForTimeout(400);
  }catch(error){console.log('LIVE_CLICK_ERROR',String(error).slice(0,300));}
  const after=await page.evaluate(()=>{
    const section=document.querySelector('.mw-parser-output > section.mf-section-2.collapsible-block');
    return {rubies:section?.querySelectorAll('ruby[kra-annotated]').length,
      sectionId:section?.id,hidden:section?.getAttribute('hidden'),
      css:section?{display:getComputedStyle(section).display,contentVisibility:getComputedStyle(section).contentVisibility}:null};
  });
  console.log('LIVE_AFTER_EXPANSION',JSON.stringify(after));
  assert.ok(after.rubies>=1,'a ruby inserted into closed Minerva article must survive real JS expansion');
  assert.equal(after.hidden,null,'real click must expand the section without losing its ruby');

 }catch(error){if(loaded)throw error;console.log('LIVE_FETCH_UNAVAILABLE',String(error).slice(0,450));}
 await context.close();
}finally{await browser.close();}

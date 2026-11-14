import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const source=fs.readFileSync('content.js','utf8');
const part=(a,b)=>{
 const i=source.indexOf(a),j=source.indexOf(b,i);
 if(i<0||j<=i)throw Error('Cannot find snippet '+a+' -> '+b);
 return source.slice(i,j);
};
const chunks=fs.readFileSync('text-chunks.js','utf8').replace('export function splitText','function splitText');
const planner=fs.readFileSync('paragraph-plan.js','utf8')
 .replace("import {splitText} from './text-chunks.js';",'')
 .replace('export function createParagraphPlan','function createParagraphPlan');
const harness=[
 '(()=>{',
 'const OWN_RUBY=\'ruby[kra-annotated="true"]\';',
 'const MAX_RECOVERY_BLOCKS=12000;',
 'const BLOCK_TAGS=\'p,li,dt,dd,td,th,h1,h2,h3,h4,h5,h6,blockquote,pre,figcaption\';',
 'let uiSettings={restoreExistingAnnotations:true,hanjaMode:true,loanwordMode:true};',
 'let lastScanStats=null,recoveryPage=null,recoveryObserver=null,recoveryTimer=null;',
 'const recoveryBlocks=new Set(),recoveryByElement=new WeakMap(),ownDomChanges=new WeakSet(),seenSources=new Set();',
 'const analyzedNodeVersions=new WeakMap();',
 'let currentTask=null;',
 'const history=[];',
 'function configureRecovery(){}',
 part('  function sourceOf','  function pageIdentity'),
 part('  function pageIdentity','  function selectedIntervals'),
 part('  function selectedIntervals','  function applySettings'),
 part('  function openTextRoots','  function isKnownRecoverySource'),
 'function isKnownRecoverySource(){return false;}',
 part('  function loanwordDisplay','  function findRepaintedTextNode'),
 'function findRepaintedTextNode(){return null;}',
 part('  function insertConversions','  // Cheap, read-only child-frame preflight.'),
 chunks,planner,
 'window.__kraFullCheck={',
 '  run(){',
 '    const t=performance.now();',
 '    const entries=collectTextNodes(null,false,false,true),scanMs=performance.now()-t;',
 '    const p=performance.now(),plan=createParagraphPlan(entries,sourceOf,BLOCK_TAGS),planMs=performance.now()-p;',
 '    const section=document.querySelector("#mf-section-2");',
 '    const inSection=[...entries.values()].filter(e=>section?.contains(e.node));',
 '    const sentences=plan.sentences.filter(s=>s.text.includes("대한민국")||s.text.includes("민주공화국"));',
 '    const target=plan.sentences.find(s=>s.text.includes("민주공화국"));',
 '    if(!target)return {error:"REAL_PIPELINE_NO_TARGET",total:entries.size,stats:lastScanStats,planCount:plan.sentences.length};',
 '    const start=target.text.indexOf("민주공화국"),surface="민주공화국";',
 '    const updates=plan.projectResult({id:target.id,annotations:[{start,end:start+surface.length,surface,replacement:"民主共和國",type:"hanja",entry_id:998}],reviewed:[]});',
 '    for(const update of updates){',
 '      const entry=[...entries.values()].find(e=>e.id===update.id);',
 '      if(entry)entry.annotations=update.annotations;',
 '    }',
 '    const rendered=insertConversions(entries,[]);',
 '    const ruby=section?.querySelector("ruby[kra-annotated]");',
 '    return {total:entries.size,inSection:inSection.length,selected:inSection.filter(e=>e.selected.length).length,scanMs,planMs,',
 '      paragraphs:plan.sentences.length,largestParagraph:Math.max(0,...plan.sentences.map(s=>s.text.length)),',
 '      targetText:target.text.slice(0,180),targetSelected:target.selected,',
 '      paintUpdates:updates.length,rendered,ruby:!!ruby,rubyText:ruby?.textContent,rubyConnected:ruby?.isConnected,',
 '      recoveryBlocks:recoveryBlocks.size,stats:lastScanStats,sentences:sentences.slice(0,3).map(s=>s.text.slice(0,120))};',
 '  }',
 '};})();'
].join('\n');
const chrome=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try{
 const ctx=await chrome.newContext({viewport:{width:393,height:852},deviceScaleFactor:2.75,isMobile:true,hasTouch:true,
  userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36'});
 for(const [language,htmlFile,cssFile] of [
  ['ko','mobile_mobile_host.html','mobile-styles.css'],
  ['ja','mobile-ja-wikisource.html','mobile-ja-styles.css']
 ]){
  if(!fs.existsSync(htmlFile)){console.log('SKIP_PAGE',language,htmlFile);continue;}
  const page=await ctx.newPage();
  await page.route('**/*',route=>route.abort());
  await page.setContent(fs.readFileSync(htmlFile,'utf8').replace('client-nojs','client-js'),{waitUntil:'domcontentloaded'});
  if(fs.existsSync(cssFile))await page.addStyleTag({path:cssFile});
  const summary=await page.evaluate(()=>{
   const section=document.querySelector('#mf-section-2')||document.querySelector('section.collapsible-block');
   const collapsed=[...document.querySelectorAll('.mw-parser-output section.collapsible-block')];
   const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
   let text,kanji=0,kana=0,hangul=0;while((text=walker.nextNode())){
    if(/[\u3400-\u9fbf]/u.test(text.data))kanji++;
    if(/[\u3041-\u3096\u30a1-\u30fa]/u.test(text.data))kana++;
    if(/[가-힣]/u.test(text.data))hangul++;
   }
   return {title:document.title,bodyClasses:document.body.className,sectionCount:collapsed.length,
    section:section?{id:section.id,className:section.className,display:getComputedStyle(section).display,
      children:section.children.length,textLength:section.textContent.length}:null,
    furiganatorKanjiCandidates:kanji,kana,hangul};
  });
  console.log('PAGE_COMPARE',language,JSON.stringify(summary));
  if(language==='ko'){
   await page.addScriptTag({content:harness});
   const result=await page.evaluate(()=>window.__kraFullCheck.run());
   console.log('FULL_REAL_PIPELINE',JSON.stringify(result));
   assert.equal(result.error,undefined,'Korean pipeline must retain projected target');
   assert.ok(result.inSection>300,'Korean Minerva folded article must reach tracked full scan');
   assert.ok(result.paragraphs>100,'Korean paragraph plan must preserve subclauses');
   assert.ok(result.ruby,'Korean full paragraph projection must paint a ruby');
  }
  await page.close();
 }
 await ctx.close();
}finally{await chrome.close();}

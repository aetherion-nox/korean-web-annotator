import {chromium} from 'playwright-core';
const url='https://ko.m.wikisource.org/wiki/대한민국헌법_(제10호)';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--ignore-certificate-errors']});
try{
 const context=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:2.75,
  isMobile:true,hasTouch:true,ignoreHTTPSErrors:true,userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36'});
 const page=await context.newPage();
 try{
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});
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
  if(before.hasSection){
   const pre=await page.evaluate(()=>{
    const section=document.querySelector('#mf-section-2'),
      node=[...section.querySelectorAll('dd,li,p')].find(el=>el.textContent.includes('민주공화국'));
    if(!node)return {injected:false};
    const marker=document.createElement('ruby');marker.setAttribute('data-kra-probe','true');
    marker.append('民主共和國');const rt=document.createElement('rt');rt.textContent='민주공화국';marker.append(rt);
    node.prepend(marker);
    return {injected:true,marker:!!section.querySelector('ruby[data-kra-probe]')};
   });
   console.log('LIVE_BEFORE_CLICK',JSON.stringify(pre));
   try{
    const h=page.locator('[onclick*="mfTempOpenSection(2)"]').first();
    if(await h.count()){await h.click({timeout:4000,force:true});await page.waitForTimeout(600);}
    else await page.evaluate(()=>{document.querySelector('#mf-section-2')?.classList.add('open-block');});
   }catch(error){console.log('LIVE_CLICK_ERROR',String(error).slice(0,300));}
   const after=await page.evaluate(()=>{
    const section=document.querySelector('#mf-section-2');
    return {present:!!document.querySelector('ruby[data-kra-probe]'),
      sectionClass:section?.className,css:section?getComputedStyle(section).display:null,
      sourceTextLength:section?.textContent?.length};
   });
   console.log('LIVE_AFTER_CLICK',JSON.stringify(after));
  }
 }catch(error){console.log('LIVE_FETCH_UNAVAILABLE',String(error).slice(0,450));}
 await context.close();
}finally{await browser.close();}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../feature-settings.js',import.meta.url),'utf8').replace(/^import .*$/gm,'');
async function openSettings(stored){
 const elements=new Map(), listeners=[];
 const get=id=>{if(!elements.has(id))elements.set(id,{value:id==='uiLocale'?'zh-CN':'',checked:false,textContent:'',handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(){}});return elements.get(id);};
 const chrome={storage:{local:{async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>Object.hasOwn(stored,k)).map(k=>[k,stored[k]]));},async set(values){Object.assign(stored,values);for(const fn of listeners)fn(Object.fromEntries(Object.entries(values).map(([k,newValue])=>[k,{newValue}])),'local');}},onChanged:{addListener(fn){listeners.push(fn);}}}};
 vm.runInNewContext(source,{chrome,document:{getElementById:get,querySelectorAll:()=>[]},LOG_KEY:'log',LOG_FULL_KEY:'full',LOG_FULL_INDEX_KEY:'index',LOG_FULL_LIMIT_KEY:'limit',LOG_ENABLED_KEY:'requestLoggingEnabled',FULL_RECORD_LIMIT:50,MAX_FULL_RECORD_LIMIT:500});
 await Promise.resolve();await Promise.resolve();
 return get;
}
test('progressive and request logging settings persist across reopening',async()=>{
 const stored={};
 let get=await openSettings(stored);
 assert.equal(get('progressiveAnnotation').checked,false);
 get('progressiveAnnotation').checked=true;await get('progressiveAnnotation').handlers.change();
 assert.equal(stored.progressiveAnnotation,true);
 get('requestLoggingEnabled').checked=true;await get('requestLoggingEnabled').handlers.change();
 assert.equal(stored.requestLoggingEnabled,true);
 get=await openSettings(stored);
 assert.equal(get('progressiveAnnotation').checked,true);
 assert.equal(get('requestLoggingEnabled').checked,true);
 get('progressiveAnnotation').checked=false;await get('progressiveAnnotation').handlers.change();
 assert.equal(stored.progressiveAnnotation,false);
 assert.equal((await openSettings(stored))('progressiveAnnotation').checked,false);
});

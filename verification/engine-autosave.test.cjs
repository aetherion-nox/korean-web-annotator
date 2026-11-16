const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('model review changes persist immediately without a save button',async()=>{
  const elements=new Map(),writes=[];
  for(const id of ['engineStatus','uiLocale','enableModelReview','dictionaryProgress','importDictionary','clearDictionary','dictionaryFile','saveEngine'])elements.set(id,{value:id==='uiLocale'?'en':'',checked:false,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}});
  const context={document:{getElementById:id=>elements.get(id)||null,querySelectorAll:()=>[]},chrome:{storage:{local:{get:async()=>({enableModelReview:false}),set:async value=>writes.push(value)}}},readDictionaryInfo:async()=>({imported:true}),importBrowserDictionary:async()=>{},clearBrowserDictionary:async()=>{}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../engine-settings.js'),'utf8').replace(/^import .*\n/,''),context);
  await new Promise(resolve=>setImmediate(resolve));
  const toggle=elements.get('enableModelReview');
  assert.equal(typeof toggle.listeners.change,'function');
  toggle.checked=true;await toggle.listeners.change();assert.equal(writes.at(-1).enableModelReview,true);
  toggle.checked=false;await toggle.listeners.change();assert.equal(writes.at(-1).enableModelReview,false);
  assert.ok(!fs.readFileSync(path.join(__dirname,'../options.html'),'utf8').includes('id="saveEngine"'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createMergedFrameReviewCoordinator} from '../merged-frame-review.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const main={events:[],postMessage(event){this.events.push(event)}};
 const child={events:[],postMessage(event){this.events.push(event)}};
 let release;
 const gate=new Promise(resolve=>{release=resolve});
 const manager=createMergedFrameReviewCoordinator({
  run:async(_input,emit,signal)=>{
   emit({type:'MANUAL_REVIEW_REQUEST',requestId:'r0',targetCount:2,text:'prompt'});
   await gate;
   if(signal.aborted)return;
   emit({type:'RESULTS',source:'model',results:[
    {id:'f0_s0',annotations:[{start:0,end:1,surface:'가',replacement:'可',type:'hanja'}]},
    {id:'f3_s0',annotations:[{start:0,end:1,surface:'나',replacement:'那',type:'hanja'}]}
   ]});
   emit({type:'DONE',stats:{}});
  },
  createSession:()=>({submit:()=>{release();return true}})
 });
 const part=(frameId,port)=>({tabId:12,frameId,port,operationId:'op'+frameId,
  message:{modes:{hanja:true,loanword:false},sentences:[{
   id:'p0',text:frameId===0?'가':'나',selected:[{start:0,end:1}]
  }]}});
 manager.open('shared',12);
 manager.join('shared',part(0,main));
 manager.join('shared',part(3,child));
 return {manager,main,child,release};
}

test('a detached child iframe cannot terminate the host manual task or discard answers',async()=>{
 const {manager,main,child}=fixture();
 const run=manager.finalize('shared');
 await flush();
 assert.equal(main.events.filter(e=>e.type==='MANUAL_REVIEW_REQUEST').length,1);
 manager.detach('shared',{frameId:3,port:child});
 assert.notEqual(manager.state('shared'),null,'the shared task must remain active');
 assert.equal(main.events.some(e=>e.type==='ERROR'),false);
 assert.equal(main.events.filter(e=>e.type==='DIAGNOSTIC').length,1);
 assert.equal(manager.respond('shared',{port:main},{requestId:'r0',text:'{}'}),true);
 await run;
 assert.equal(main.events.at(-1).type,'DONE');
 assert.equal(main.events.filter(e=>e.type==='RESULTS').length,1);
 assert.deepEqual(main.events.find(e=>e.type==='RESULTS').results.map(r=>r.id),['p0']);
 assert.equal(child.events.some(e=>e.type==='DONE'||e.type==='RESULTS'),false,
  'a frame with invalidated DOM must not receive accepted annotations');
});

test('child frame departure before collection removes it without canceling top-level work',async()=>{
 const {manager,main,child}=fixture();
 manager.detach('shared',{frameId:3,port:child});
 assert.equal(manager.state('shared').joined,1);
 const run=manager.finalize('shared');
 await flush();
 assert.equal(main.events.some(e=>e.type==='MANUAL_REVIEW_REQUEST'),true);
 assert.equal(manager.respond('shared',{port:main},{requestId:'r0',text:'{}'}),true);
 await run;
 assert.equal(main.events.at(-1).type,'DONE');
 assert.equal(child.events.some(e=>e.type==='RESULTS'),false);
});

test('top-level document departure still aborts shared review for safety',async()=>{
 const {manager,main,child,release}=fixture();
 const run=manager.finalize('shared');
 await flush();
 manager.detach('shared',{frameId:0,port:main});
 assert.equal(manager.state('shared'),null);
 assert.equal(child.events.some(e=>e.type==='ERROR'),true);
 release();
 await run;
 assert.equal(child.events.some(e=>e.type==='RESULTS'),false);
});

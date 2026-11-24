import test from 'node:test';
import assert from 'node:assert/strict';
import {createMergedFrameReviewCoordinator} from '../merged-frame-review.js';

function fixture(timeout=100){
 const coordinator=createMergedFrameReviewCoordinator({
  renderReportTimeoutMs:timeout,
  createSession:()=>({}),
  run:async(_message,post)=>{await post({type:'DONE',stats:{model_projected_fragments:807}});}
 });
 coordinator.open('g',1);
 const parts=[0,7,9].map(frameId=>{
  const events=[],port={postMessage:event=>events.push(event)};
  const part={tabId:1,frameId,port,operationId:'op'+frameId,message:{modes:{hanja:true,loanword:true},sentences:[{id:'0',text:'한국어'}]}};
  coordinator.join('g',part);return {...part,events};
 });
 const report=(p,expected,connected)=>coordinator.reportRender('g',p,{
  operationId:p.operationId,display:{projected_annotations:expected,rendered_annotations:connected,
   connected_visible_annotations:connected,invalidated_dom_entries:expected===connected?0:2,
   article_body_projected:0,article_body_rendered:0,article_body_connected:0,
   article_body_failed_nodes:0,dom_write_failure_count:0}
 });
 return {coordinator,parts,report};
}
test('waits for all render receipts and totals each frame exactly once',async()=>{
 const {coordinator:c,parts:p,report}=fixture();
 const done=c.finalize('g');await Promise.resolve();
 assert.ok(p.every(frame=>frame.events.some(e=>e.type==='DONE')), 'every frame receives DONE before reporting');
 assert.equal(p[0].events.some(e=>e.type==='FRAME_RENDER_SUMMARY'),false);
 assert.equal(report(p[0],710,706),true);
 assert.equal(report(p[1],60,60),true);
 assert.equal(report(p[1],60,60),false);
 c.detach('g',p[1]); // normal closure after receipt is not a missing frame
 assert.equal(report(p[2],39,39),true);
 await done;
 const summary=p[0].events.find(e=>e.type==='FRAME_RENDER_SUMMARY').summary;
 assert.equal(summary.totals.connected_visible_annotations,805);
 assert.equal(summary.totals.projected_annotations,809);
 assert.equal(summary.totals.invalidated_dom_entries,2);
 assert.deepEqual(summary.missingFrameIds,[]);
 assert.equal(summary.reportedFrames,3);
});
test('unreported frame is explicitly missing, not a confirmed zero',async()=>{
 const {coordinator:c,parts:p,report}=fixture();
 const done=c.finalize('g');await Promise.resolve();
 assert.ok(p.every(frame=>frame.events.some(e=>e.type==='DONE')), 'every frame receives DONE before reporting');
 assert.equal(report(p[0],710,706),true);assert.equal(report(p[1],60,60),true);
 await done;
 const summary=p[0].events.find(e=>e.type==='FRAME_RENDER_SUMMARY').summary;
 assert.deepEqual(summary.missingFrameIds,[9]);
 assert.equal(summary.reportedFrames,2);
 assert.equal(summary.totals.connected_visible_annotations,766);
});
test('rejects wrong operation and malformed counts',async()=>{
 const {coordinator:c,parts:p,report}=fixture();
 const done=c.finalize('g');await Promise.resolve();
 assert.ok(p.every(frame=>frame.events.some(e=>e.type==='DONE')), 'every frame receives DONE before reporting');
 assert.equal(c.reportRender('g',p[0],{operationId:'old',display:{}}),false);
 assert.equal(c.reportRender('g',p[0],{operationId:p[0].operationId,display:{}}),false);
 assert.equal(report(p[0],1,1),true);assert.equal(report(p[1],1,1),true);c.detach('g',p[2]);
 await done;
 assert.deepEqual(p[0].events.find(e=>e.type==='FRAME_RENDER_SUMMARY').summary.missingFrameIds,[9]);
});

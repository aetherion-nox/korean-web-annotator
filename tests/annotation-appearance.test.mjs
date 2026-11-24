import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeAnnotationAppearance,applyAnnotationAppearance} from '../annotation-appearance.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('defaults match Furigana Maker; range validation and zero opacity',()=>{
 assert.deepEqual(normalizeAnnotationAppearance(),{size:75,opacity:100});
 assert.deepEqual(normalizeAnnotationAppearance({size:400,opacity:0}),{size:150,opacity:0});
 assert.deepEqual(normalizeAnnotationAppearance({size:'bad',opacity:Infinity}),{size:75,opacity:100});
 const values={};applyAnnotationAppearance({style:{setProperty:(k,v)=>values[k]=v}},{size:65,opacity:40});
 assert.deepEqual(values,{'--kra-annotation-size':'65%','--kra-annotation-opacity':'0.4'});
});
test('CSS applies only to extension ruby annotation, not body or native ruby',()=>{
 assert.match(read('content.css'),/ruby\.kra-ruby > rt\.kra-annotation\s*\{[\s\S]*?font-size: var\(--kra-annotation-size, 75%\)/);
 assert.match(read('content.css'),/opacity: var\(--kra-annotation-opacity, 1\)/);
});
test('appearance is sent to current and new frames independent of popup UI settings',()=>{
 const worker=read('service-worker.js'),content=read('content.js');
 assert.match(worker,/changes\[APPEARANCE_KEY\]/);
 assert.match(worker,/floatingBallPosition, annotationAppearance/);
 assert.match(content,/Object\.hasOwn\(settings,'annotationAppearance'\)/);
 assert.match(read('popup.html'),/annotationAppearancePreview/);
 assert.match(read('popup.html'),/src="annotation-appearance-settings\.js"/);
 assert.doesNotMatch(read('options.html'),/annotationAppearancePreview|annotation-appearance-settings\.js/);
 assert.match(read('popup.css'),/\.annotation-appearance-preview rt/);
});

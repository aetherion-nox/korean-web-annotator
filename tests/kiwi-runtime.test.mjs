import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=process.argv[2]?path.resolve(process.argv[2]):fileURLToPath(new URL('../',import.meta.url));
const {KiwiBuilder,Match}=await import(pathToFileURL(path.join(root,'runtime/kiwi/index.js')));
const builder=await KiwiBuilder.create(path.join(root,'runtime/kiwi/kiwi-wasm.wasm'));
assert.equal(builder.version(),'0.24.1');
const assets=JSON.parse(await fs.readFile(path.join(root,'runtime/assets.json'),'utf8'));
assert.equal(assets.kiwi_version,builder.version());
assert.equal(assets.kiwi_model_version,'0.24.1');
const modelFiles=Object.fromEntries(await Promise.all(assets.model_files.map(async name=>[name,new Uint8Array(await fs.readFile(path.join(root,'runtime/models',name)))])));
const kiwi=await builder.build({modelFiles,modelType:'cong',integrateAllomorph:true,loadDefaultDict:true,loadTypoDict:true,loadMultiDict:true});
for(const text of ['학교에 갔다.','수능 2주앞… 차단 비상','쉬지 마시라고요','만들지 말고','영혼 판다','계셨네요','열려 있고','😀 이수민 씨가 왔다.','학교\u2028학생','가'.repeat(6000)]){
 const tokens=kiwi.tokenize(text,Match.all);
 assert.ok(tokens.length);
 for(const t of tokens){assert.ok(Number.isInteger(t.position)&&t.position>=0);assert.ok(t.position+t.length<=text.length);}
}
console.log(root+': Kiwi 0.24.1, matching model and 10 tokenization/boundary probes passed');

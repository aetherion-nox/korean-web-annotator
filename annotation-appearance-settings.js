import {APPEARANCE_KEY,DEFAULT_APPEARANCE,normalizeAnnotationAppearance,applyAnnotationAppearance} from './annotation-appearance.js';
const $=id=>document.getElementById(id);
const size=$('annotationSize'),opacity=$('annotationOpacity');
const labels={
 'zh-CN':['标注大小（相对正文）','标注深浅（不透明度）','恢复默认','仅调整上方标注文字，正文不变。已有标注立即生效，无需重新分析。','已保存'],
 'zh-TW':['標註大小（相對正文）','標註深淺（不透明度）','恢復預設','只調整上方標註文字，正文不變。現有標註立即生效，不必重新分析。','已儲存'],
 en:['Annotation size (relative to text)','Annotation opacity','Reset defaults','Changes only the ruby text. Existing annotations update without reanalysis.','Saved'],
 ja:['注釈サイズ（本文比）','注釈の不透明度','初期値に戻す','本文は変更せず、既存の注釈に即時反映します。再解析は不要です。','保存しました'],
 ko:['주석 크기 (본문 대비)','주석 불투명도','기본값 복원','본문은 그대로 유지되며 기존 주석에 즉시 반영됩니다. 재분석은 필요하지 않습니다.','저장됨']
};
const tr=()=>labels[$('uiLocale').value]||labels.en;
const headings={'zh-CN':'标注样式','zh-TW':'標註樣式',en:'Annotation appearance',ja:'注釈スタイル',ko:'주석 스타일'};
function translate(){document.querySelector('[data-appearance-i18n="heading"]').textContent=headings[$('uiLocale').value]||headings.en;for(const [i,key] of ['size','opacity','reset','hint'].entries())document.querySelector('[data-appearance-i18n="'+key+'"]').textContent=tr()[i];}
function render(value){const a=normalizeAnnotationAppearance(value);size.value=a.size;opacity.value=a.opacity;$('annotationSizeValue').textContent=a.size+'%';$('annotationOpacityValue').textContent=a.opacity+'%';applyAnnotationAppearance($('annotationAppearancePreview'),a);}
let queue=Promise.resolve();
function save(){const value=normalizeAnnotationAppearance({size:Number(size.value),opacity:Number(opacity.value)});render(value);queue=queue.catch(()=>{}).then(()=>chrome.storage.local.set({[APPEARANCE_KEY]:value})).then(()=>{$('annotationAppearanceStatus').textContent=tr()[4];}).catch(e=>{$('annotationAppearanceStatus').textContent=e.message;});}
for(const el of [size,opacity]){el.addEventListener('input',()=>render({size:Number(size.value),opacity:Number(opacity.value)}));el.addEventListener('change',save);}
$('resetAnnotationAppearance').addEventListener('click',()=>{render(DEFAULT_APPEARANCE);save();});
$('uiLocale').addEventListener('change',translate);
translate();
chrome.storage.local.get([APPEARANCE_KEY,'uiSettings']).then(data=>{render(data[APPEARANCE_KEY]);translate();}).catch(e=>{$('annotationAppearanceStatus').textContent=e.message;});

// Defaults match Furigana Maker's 75% and currentColor.
export const APPEARANCE_KEY='annotationAppearance';
export const DEFAULT_APPEARANCE=Object.freeze({size:75,opacity:100});
export function normalizeAnnotationAppearance(value){
 const percent=(v,min,max,fallback)=>typeof v==='number'&&Number.isFinite(v)?Math.min(max,Math.max(min,Math.round(v))):fallback;
 return {size:percent(value?.size,25,150,75),opacity:percent(value?.opacity,0,100,100)};
}
export function applyAnnotationAppearance(root,value){
 const {size,opacity}=normalizeAnnotationAppearance(value);
 root.style.setProperty('--kra-annotation-size',size+'%');
 root.style.setProperty('--kra-annotation-opacity',String(opacity/100));
}

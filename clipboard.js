// Run in an extension document with clipboardWrite permission, not the web page.
export function copyPlainText(text,doc=document){
 if(typeof text!=='string')throw Error('Invalid clipboard text');
 const active=doc.activeElement,field=doc.createElement('textarea');field.value=text;
 field.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;';
 (doc.body||doc.documentElement).append(field);
 try{field.focus();field.select();if(!doc.execCommand('copy'))throw Error('Extension clipboard write was not accepted');}
 finally{field.remove();active?.focus?.();}
}

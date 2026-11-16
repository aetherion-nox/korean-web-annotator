// A conservative final guard for selected dictionary senses.
// A listed Hanja choice is not automatically phonologically consistent with
// the exact source occurrence. Unknown/polyphonic readings remain eligible:
// only a positive mismatch vetoes the annotation.
import {projectAnnotation} from './local-engine.js';
import {validateModelHanjaReadings} from './hanja-reading-check.js';

export function readingCompatibleModelChoice(target,choice,config={}){
 if(config.hanjaReadingCheck!==true||!choice||!['hanja','mixed'].includes(choice.type))
  return true;
 if(!target||typeof target.context!=='string'||!Number.isInteger(target.start))
  return true;
 try{
  const projected=projectAnnotation(target.context,{...target,...choice});
  if(!projected.length)return false;
  return validateModelHanjaReadings(target.context,projected).status!=='mismatch';
 }catch{
  // The source/annotation geometry is invalid. Never transform it into an
  // apparently trustworthy dictionary hit.
  return false;
 }
}

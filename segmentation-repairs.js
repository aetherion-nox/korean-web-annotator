import {buildReviewPayload} from './review-payload.js';
import {literalOriginOption} from './experimental-options.js';
import {projectAnnotation} from './local-engine.js';
import {validateModelHanjaReadings} from './hanja-reading-check.js';
import {validateSegmentationRepairsCore} from './repair-validation-core.js';

// Keep the established literal-origin checks for worker-side repairs. The
// geometric validator is shared with the offline page recovery path.
export function verifySegmentationOrigin({start,end,surface,choice_id,sentence,config}){
 const virtual={target_id:'repair',start,end,surface,context:sentence.text,
  options:[{choice_id:'KEEP',type:'keep',replacement:surface,definitions:[],entry_id:null}]};
 let option=literalOriginOption(virtual,choice_id,{
  experimentalHanja:config.repairModes?.hanja===true,
  experimentalLoanword:config.repairModes?.loanword===true,
  hanjaReadingCheck:config.hanjaReadingCheck!==false
 });
 // Preserve explicitly unchanged Hangul anchors inside a Hanja repaired
 // surface; this does not authorize arbitrary truncation or invented suffixes.
 if(!option&&config.repairModes?.hanja===true&&!surface.includes(' ')&&
    /^[\p{Script=Han}가-힣]+$/u.test(choice_id)&&/\p{Script=Han}/u.test(choice_id)&&
    [...choice_id].length===[...surface].length&&
    [...choice_id].every((char,i)=>/\p{Script=Han}/u.test(char)||char===[...surface][i]))
   option={choice_id,type:'hanja',replacement:choice_id,entry_id:'experimental:hanja',
    definitions:['未经词典核实的修复词源']};
 if(!option)return null;
 try{
  let annotations=projectAnnotation(sentence.text,{...virtual,...option});
  if(!annotations.length)return null;
  if(option.type==='hanja'&&config.hanjaReadingCheck!==false&&
     validateModelHanjaReadings(sentence.text,annotations).status==='mismatch')return null;
  return annotations.map(a=>({...a,origin_source:'model-unverified'}));
 }catch{return null;}
}

export function validateSegmentationRepairs(targets,response,config={}){
 if(!config.smartSegmentation)return {accepted:[],rejected:[]};
 if(response?.repairs===undefined)return {accepted:[],rejected:[]};
 const payload=buildReviewPayload(config.context||'',targets,config).payload;
 return validateSegmentationRepairsCore(targets,response,{
  ...config,payload,verifyOrigin:details=>verifySegmentationOrigin({...details,config})
 });
}

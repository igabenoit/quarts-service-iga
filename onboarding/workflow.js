import {personalEmployerReady} from '../public/personal-information-schema.js';
import {retirementEmployerReady} from '../public/retirement-fields.js';
import {tuacEmployerReady} from '../public/tuac-fields.js';

export const sharedKinds=new Set(['renseignements','tuac','retraite','sst_general']);
export const directionReady=(kind,answers)=>kind==='renseignements'?personalEmployerReady(answers):kind==='retraite'?retirementEmployerReady(answers):kind==='tuac'?tuacEmployerReady(answers):false;
export function workflowState(doc){
 const done=!!(doc.done||doc.original_id),w=doc.draft?._workflow;
 if(doc.kind==='cheque')return {employeeSigned:false,submitted:done,submissionRequired:true,awaitingDirection:false,directionRequired:false,attachment:doc.draft?._attachment||null};
 return {employeeSigned:done||!!w?.employeeOriginalId,employeeSignedAt:w?.signedAt||null,
  employeeOriginalId:w?.employeeOriginalId||null,awaitingDirection:!done&&!!w?.employeeOriginalId,
  directionRequired:sharedKinds.has(doc.kind),directionReady:done||directionReady(doc.kind,doc.draft||{})};
}
export function publicDraft(draft={}){
 const {_workflow,...answers}=draft;return answers;
}

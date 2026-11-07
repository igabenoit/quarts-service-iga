export const FORM_SIGNERS=[['employee','Employé'],['trainer','Formateur / superviseur']];
export function emptyTrainingForm(){return {status:'draft',date:'',trainer:'',content:'',reference:'',version:'',procedureId:'',observationDate:'',supervisor:'',points:[],note:'',immediate:'',owner:'',dueDate:'',employeeDate:'',trainerDate:'',explained:false,demonstrated:false,practiced:false,questions:false,signatures:{employee:[],trainer:[]}};}
export function normalizeTrainingSignatures(value){
 const fail=()=>{throw Object.assign(Error('Tracé de signature invalide.'),{status:400});};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!FORM_SIGNERS.some(([s])=>s===k)))fail();
 return Object.fromEntries(FORM_SIGNERS.map(([key])=>{const strokes=value[key]||[];let count=0;
  if(!Array.isArray(strokes)||strokes.length>60)fail();
  return [key,strokes.map(stroke=>{if(!Array.isArray(stroke)||!stroke.length||(count+=stroke.length)>600)fail();return stroke.map(p=>{if(!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isInteger(n)||n<0||n>1000))fail();return [...p];});})];
 }));
}

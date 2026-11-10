import {readFile} from 'node:fs/promises';
import PDFLib from './tuac/pdf-lib.min.cjs';

// Nouvelle fiche SST 2026. L'annexe 11.1 historique conserve son propre type et ses originaux.
export const generalSstTopics=Array.from({length:6},(_,i)=>'accueil_sujet_'+(i+1));
export const generalSstRisks=['risque_caisse','risque_manutention','risque_chariots','risque_transpalette','risque_couteaux','risque_machines','risque_chaleur','risque_chimique'];
export const generalSstTasks=Array.from({length:5},(_,i)=>'tache_'+(i+1));
export const generalSstCheckKeys=[
 ...generalSstTopics,...generalSstRisks,
 ...generalSstTasks.flatMap(k=>[k+'_explique',k+'_pratique',k+'_autorise']),
 'accueil_complete','formation_complete','formation_a_poursuivre'
];
export const generalSstTextKeys=[
 'employe_nom','departement_poste','responsable_accueil','date_accueil','accueil_points_a_reprendre',
 'poste_employe','poste_formateur',...generalSstTasks,
 'poste_restrictions','date_suivi','responsable_suivi','remarques_suivi_final',
 'signature_nom_employe','signature_date_employe','signature_nom_responsable','signature_date_responsable'
];
export const generalSstFields=[...generalSstTextKeys,...generalSstCheckKeys,'confirmation'];
const employeeKeys=new Set([
 'employe_nom','departement_poste',...generalSstTopics,
 'accueil_points_a_reprendre','signature_nom_employe','signature_date_employe','confirmation'
]);
export function sanitizeGeneralSstAnswers(answers,onsite){
 const clean=Object.fromEntries(generalSstFields.map(k=>[k,String(answers?.[k]??'').slice(0,200)]));
 if(!onsite)for(const k of generalSstFields)if(!employeeKeys.has(k))clean[k]='';
 return clean;
}
export const blankGeneralSst=()=>readFile(new URL('./sst-general/form.pdf',import.meta.url));
const isDate=v=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
 const time=new Date(v+'T12:00:00Z');
 return !Number.isNaN(time.getTime())&&time.toISOString().slice(0,10)===v;
};
function validSignature(lines){
 return Array.isArray(lines)&&lines.length>0&&lines.length<=200&&
 lines.every(line=>Array.isArray(line)&&line.length>=2&&line.length<=4000&&line.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&v>=0&&v<=1)))&&
 lines.some(line=>line.some(p=>Math.hypot(p[0]-line[0][0],p[1]-line[0][1])>.01));
}
function drawSignature(page,lines,left,bottom,width,height){
 for(const line of lines){
  let previous;
  for(const [x,y] of line){
   const next={x:left+x*width,y:bottom+(1-y)*height};
   if(previous)page.drawLine({start:previous,end:next,color:PDFLib.rgb(.03,.16,.40),thickness:.85});
   previous=next;
  }
 }
}
export async function signedGeneralSst(input,employeeStrokes,options={}){
 const onsite=options.onsite===true;
 const answers=sanitizeGeneralSstAnswers(input,onsite);
 if(!answers.employe_nom.trim()||!answers.departement_poste.trim()||
    !answers.signature_nom_employe.trim()||!isDate(answers.signature_date_employe)||
    answers.confirmation!=='yes')throw Error('Complétez l’identification et la confirmation de l’employé.');
 if(generalSstTopics.some(k=>answers[k]!=='yes'))throw Error('Tous les sujets de l’accueil général doivent être réellement présentés avant la signature.');
 if(!validSignature(employeeStrokes))throw Error('Signature de l’employé requise.');
 for(const key of ['date_accueil','date_suivi','signature_date_responsable'])
  if(answers[key]&&!isDate(answers[key]))throw Error('Date invalide : '+key);
 if(answers.formation_complete==='yes'&&answers.formation_a_poursuivre==='yes')throw Error('Précisez un seul état pour la formation pratique.');
 if(answers.formation_complete==='yes'&&!generalSstTasks.some(k=>answers[k].trim()&&answers[k+'_explique']==='yes'&&answers[k+'_pratique']==='yes'&&answers[k+'_autorise']==='yes'))
  throw Error('La formation pratique ne peut être déclarée terminée sans démonstration et observation.');
 const managerialKeys=generalSstFields.filter(k=>!employeeKeys.has(k));
 const managed=onsite&&managerialKeys.some(k=>answers[k]&&answers[k]!=='no');
 if(managed&&(!answers.signature_nom_responsable.trim()||!isDate(answers.signature_date_responsable)||!validSignature(options.supervisorStrokes)))
  throw Error('Signature et date du responsable requises pour valider ses observations.');
 const pdf=await PDFLib.PDFDocument.load(await blankGeneralSst()),form=pdf.getForm();
 for(const key of generalSstTextKeys)form.getTextField(key).setText(answers[key]||'');
 for(const key of generalSstCheckKeys)if(answers[key]==='yes')form.getCheckBox(key).check();
 form.flatten();
 const page=pdf.getPage(2);
 // Coordonnées des deux zones de signature sur la page 3 du modèle original (lettre).
 drawSignature(page,employeeStrokes,98,144,176,30);
 if(managed)drawSignature(page,options.supervisorStrokes,367,144,174,30);
 return Buffer.from(await pdf.save());
}

import {normalizeTuacPhone} from './tuac-phone.js';
export const tuacFields=['Nom','Prénom','Naissance','Rue','Appartement','Ville','Province','Code postal','Indicatif','Téléphone','Courriel','Emploi','Signature'];
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
export const tuacEmployerReady=a=>a?._employerPrepared===true&&validDate(a.Emploi);
export function tuacAnswers(input,previous={},employer=false){
 const result=Object.fromEntries(tuacFields.map(key=>{
  const value=(key==='Emploi')===employer?input[key]??'':previous[key]??'';
  if(typeof value!=='string'||value.length>200)throw Error('Vérifiez les champs du TUAC.');
  return [key,value.trim()];
 }));
 result._employerPrepared=employer||previous._employerPrepared===true;
 return normalizeTuacPhone(result);
}

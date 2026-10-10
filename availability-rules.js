import {isDate,addDays} from './leave-rules.js';
import {normalizeEmail} from './employee-contacts.js';
export const OPEN=450,CLOSE=1290,EVENING=1020,RULE_VERSION='2026-10-v1';
export const localDate=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
export const historyOf=row=>Array.isArray(row.availability_history)?row.availability_history:[];
export const lastChange=row=>historyOf(row).filter(v=>v.source!=='baseline').at(-1)?.effectiveDate||null;
export function minimumEffectiveDate(row,today){const last=lastChange(row);return last&&addDays(last,28)>today?addDays(last,28):today;}
export function normalizeAvailability(body,{today,maxMinutes=3000}={}){
  if(!isDate(body.effectiveDate)||body.effectiveDate<today)throw new Error('Indiquez une date effective valide, aujourd’hui ou plus tard.');
  const target=body.targetMinutes;
  if(!Number.isInteger(target)||target<15||target%15||target>Math.min(3000,maxMinutes))throw new Error(`Indiquez les heures souhaitées, entre 0,25 et ${Math.min(3000,maxMinutes)/60} h, par quarts d’heure.`);
  if(body.acknowledged!==true)throw new Error('Vous devez cocher « J’ai lu et compris les exigences de disponibilité ».');
  const email=normalizeEmail(body.email);if(!email)throw new Error('Indiquez une adresse courriel valide pour la confirmation.');
  const employeeName=typeof body.employeeName==='string'?body.employeeName.trim():'';
  if(employeeName.length<2||employeeName.length>100)throw new Error('Le nom complet est obligatoire.');
  if(!body.availability||typeof body.availability!=='object'||Array.isArray(body.availability)||Object.keys(body.availability).some(k=>!['0','1','2','3','4','5','6'].includes(k)))throw new Error('Complétez les disponibilités de chaque journée.');
  const availability={};let evenings=[];
  for(let d=0;d<7;d++){
    const a=body.availability[d];
    if(!Array.isArray(a)||a.length>1)throw new Error('Choisissez une disponibilité pour chaque jour, du lundi au vendredi.');
    if(a.length){const w=a[0];if(!Array.isArray(w)||w.length!==2||w.some(n=>!Number.isInteger(n)||n%15)||w[0]<OPEN||w[1]>CLOSE||w[0]>=w[1])throw new Error('Les heures doivent être comprises entre 7 h 30 et 21 h 30, avec une fin après le début.');}
    if(d>=5&&(a.length!==1||a[0][0]!==OPEN||a[0][1]!==CLOSE))throw new Error('Le samedi et le dimanche sont obligatoires, de 7 h 30 à 21 h 30.');
    availability[d]=a.map(w=>[...w]);
    if(d<5&&a.some(([a,b])=>a<=EVENING&&b>=CLOSE))evenings.push(d);
  }
  if(evenings.length<2)throw new Error('Choisissez au moins deux soirs disponibles de 17 h à 21 h 30. Un début avant 17 h est aussi accepté.');
  if(!evenings.some(d=>d===3||d===4))throw new Error('Au moins un des soirs doit être le jeudi ou le vendredi, de 17 h à 21 h 30.');
  const comments=typeof body.comments==='string'?body.comments.trim():'';
  if(comments.length>500)throw new Error('Les commentaires sont limités à 500 caractères.');
  return {employeeName,email,effectiveDate:body.effectiveDate,targetMinutes:target,availability,comments,acknowledged:true,ruleVersion:RULE_VERSION};
}
export function profileAt(row,date){
  const version=historyOf(row).filter(v=>v.effectiveDate<=date).at(-1);
  return version||{availability:row.availability||{},targetMinutes:row.target_minutes??row.targetMinutes??0,effectiveDate:null};
}
export function employeeAvailability(row,{date=localDate(),weekStart=null}={}){
  const current=profileAt(row,date),history=historyOf(row);
  const availability=weekStart?Object.fromEntries(Array.from({length:7},(_,d)=>[d,profileAt(row,addDays(weekStart,d)).availability[d]||[]])):current.availability;
  // A weekly target belongs to the week containing its effective date; day windows use exact dates.
  return {availability,targetMinutes:weekStart?profileAt(row,addDays(weekStart,6)).targetMinutes:current.targetMinutes,
    profileAvailability:current.availability,profileTargetMinutes:current.targetMinutes,availabilityEffectiveDate:current.effectiveDate,
    nextAvailability:history.filter(v=>v.effectiveDate>date),availabilityHistory:history};
}
export function appendAvailability(row,change){
  let history=historyOf(row);
  if(!history.length)history=[{effectiveDate:'1900-01-01',availability:row.availability,targetMinutes:row.target_minutes,source:'baseline'}];
  if(change.effectiveDate<history.at(-1).effectiveDate)throw new Error('Une disponibilité plus récente est déjà prévue. Annulez-la dans le suivi avant de modifier une date antérieure.');
  return [...history,change];
}

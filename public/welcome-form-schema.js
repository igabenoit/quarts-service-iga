import {normalizeTrainingSignatures} from './training-form-schema.js';
export const GROUPS=[
 ['policies','Présentation des politiques et procédures en SST','Politiques en santé et sécurité du travail (Manuel, Section 1)', ['Déclaration d’événement et enquête d’accident','Assignation temporaire','Comité SST']],
 ['respect','','Politique en matière de respect au travail et programme de prévention',[]],
 ['board','Visite de l’établissement et du lieu de travail','Babillard SST',['Programme de prévention','Secouristes','Noms des membres et dernier compte-rendu du Comité SST']],
 ['firstAid','','Premiers soins, indiquez l’emplacement des éléments suivants :',['Registre des incidents','Formulaires d’assignation temporaire','Trousses de premiers soins','Douche oculaire','Fiches de données de sécurité (SIMDUT)']],
 ['emergency','','Mesures d’urgence',['Plan d’évacuation et consignes en cas d’évacuation','Point de rassemblement','Sorties de secours / extincteurs']],
 ['mentor','','Présentation au parrain',['Grille d’accompagnement SST propre au département (Manuel annexes 11.2 à 11.10)']],
 ['ppe','À remettre à l’employé','Équipements de protection individuelle adaptés en fonction des risques',[]]
];
export function emptyWelcome(){return {template:'welcome-11.1',job:'',responsible:'',ppe:'',initials:Object.fromEntries(GROUPS.map(([k])=>[k,''])),checked:[],locations:Array(5).fill(''),weeks:[{date:'',hours:''},{date:'',hours:''}],signatureDate:'',signature:[]};}
export function normalizeWelcome(value){
 const fail=()=>{throw Object.assign(Error('Vérifiez les renseignements du formulaire d’accueil.'),{status:400});};
 if(!value||value.template!=='welcome-11.1')fail();const out=emptyWelcome();
 const str=(v,max)=>{if(typeof v!=='string'||v.length>max)fail();return v.trim();};
 const date=v=>{v=str(v,10);if(v&&(!/^20\d\d-\d\d-\d\d$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v))fail();return v;};
 for(const k of ['job','responsible','ppe'])out[k]=str(value[k],k==='ppe'?1000:240);
 for(const [k] of GROUPS)out.initials[k]=str(value.initials?.[k],30);
 const allowed=GROUPS.flatMap(([k,,,items])=>items.map((_,i)=>k+'-'+i));
 if(!Array.isArray(value.checked)||value.checked.some(k=>!allowed.includes(k)))fail();out.checked=[...new Set(value.checked)].sort();
 if(!Array.isArray(value.locations)||value.locations.length!==5||!Array.isArray(value.weeks)||value.weeks.length!==2)fail();
 out.locations=value.locations.map(v=>str(v,500));out.weeks=value.weeks.map(w=>{const hours=str(w.hours,6);if(hours&&(!/^\d{1,3}([.,]\d{1,2})?$/.test(hours)||Number(hours.replace(',','.'))>168))fail();return {date:date(w.date),hours};});
 out.signatureDate=date(value.signatureDate);out.signature=normalizeTrainingSignatures({employee:value.signature}).employee;return out;
}
export function welcomeContent(form,includeDates=false){const f=normalizeWelcome(form);delete f.signature;if(!includeDates){delete f.signatureDate;f.weeks=f.weeks.map(({hours})=>({hours}));}return JSON.stringify(f);}
export function validateWelcomeCompletion(form,employeeKey){if(!employeeKey||!form.job||!form.responsible||!form.signatureDate||!form.signature.length)throw Object.assign(Error('Pour finaliser, indiquez l’employé, l’emploi occupé, le responsable et la signature datée du travailleur.'),{status:400});}

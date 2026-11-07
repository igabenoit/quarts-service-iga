export const REPORT_TEMPLATE='annexe-3.1';
export const CAUSE_GROUPS=[
 ['individual','Causes immédiates liées à l’individu',['Procédure de travail non respectée','Méthode de travail non sécuritaire','Règle de sécurité non-respectée','Dispositif de sécurité contourné','Outil ou équipement utilisé sans autorisation','Équipement de protection individuel non utilisé','Équipement de protection individuel mal utilisé','Implication d’une autre personne']],
 ['equipment','Causes immédiates liées à l’équipement',['Protecteur/dispositif de sécurité absent','Protecteur/dispositif de sécurité défectueux','Protecteur/dispositif de sécurité inadéquat','Équipement/outil manquant','Équipement/outil défectueux','Équipement/outil inadéquat pour la tâche','Absence d’équipement/outil pour réaliser la tâche','Palettier/étagère en mauvais état']],
 ['material','Causes immédiates liées au matériel',['Poids du matériel','Empilage ou charge instable','Produit dangereux présentant un risque inconnu','Produit dangereux mal identifié','Produit dangereux mal entreposé','Produit dangereux – réaction non contrôlée','Matériel en mauvais état','Matériel de mauvaise qualité']],
 ['environment','Causes immédiates liées à l’environnement',['Bruit ambiant','Éclairage','Lieux encombrés ou en désordre','Espace de travail restreint','Plancher ou sol glissant ou inégal','Absence de signalisation','Ventilation insuffisante','Gaz, fumée, vapeur nocive/toxique','Conditions atmosphériques extérieures']],
 ['organization','Causes immédiates liées à l’organisation',['Formation','Travailleur non formé pour la tâche','Information ou communication','Procédure de travail','Règlement','Inspection préventive','Entretien préventif','Supervision','Conception','Temps supplémentaire','Rythme de production inhabituel']]
];
export const CAUSE_IDS=CAUSE_GROUPS.flatMap(([key,,labels])=>labels.map((_,i)=>key+'-'+i));
export const SIGNERS=[['witness','Témoin'],['investigator','Enquêteur'],['worker','Travailleur'],['participant','Autre participant'],['employer','Représentant de l’employeur']];
export const ANSWER_FIELDS={eventTime:5,declarationDate:10,injurySite:240,injuryDescription:1200,jobTitle:240,reportedTo:240,tenureJob:240,tenureCompany:240,eventDescription:6000,placeDescription:3000,documentsAvailable:3,photosAvailable:3,witnessesAvailable:3,witnessStatement:6000,witnessName:240,witnessDate:10,otherWitnessesAvailable:3,materialWeight:40,individualOther:1200,equipmentOther:1200,materialOther:1200,environmentOther:1200,organizationOther:1200,investigatorName:240,investigatorDate:10,workerName:240,workerDate:10,participantName:240,participantDate:10,employerName:240,employerDate:10};
const fail=m=>{throw Object.assign(Error(m),{status:400})};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const string=(v,max)=>{if(v===undefined)return '';if(typeof v!=='string'||v.length>max)fail('Un champ du rapport est invalide ou trop long.');return v.trim()};
export function reportDate(v){if(!v)return '';if(typeof v!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)fail('Vérifiez les dates du rapport.');return v;}
export const emptyMeasure=()=>({cause:'',measure:'',owner:'',due:''});
export function emptyReport(){return {template:REPORT_TEMPLATE,version:1,answers:Object.fromEntries(Object.keys(ANSWER_FIELDS).map(k=>[k,''])),causes:[],measures:Array.from({length:4},emptyMeasure),signatures:Object.fromEntries(SIGNERS.map(([k])=>[k,[]]))};}
export function normalizeIncidentReport(input){
 if(!object(input)||input.template!==REPORT_TEMPLATE||input.version!==1||!object(input.answers)||!object(input.signatures)||!Array.isArray(input.causes)||!Array.isArray(input.measures))fail('Modèle de rapport d’enquête invalide.');
 if(new TextEncoder().encode(JSON.stringify(input)).length>180000)fail('Le rapport est trop volumineux. Joignez les longs détails dans une preuve.');
 for(const k of Object.keys(input.answers))if(!Object.hasOwn(ANSWER_FIELDS,k))fail('Champ inconnu dans le rapport.');
 const report=emptyReport();
 for(const [k,max] of Object.entries(ANSWER_FIELDS)){
  const v=string(input.answers[k],max);
  if(k.endsWith('Date'))reportDate(v);
  if(k.endsWith('Available')&&!['','yes','no'].includes(v))fail('Choisissez Oui, Non ou laissez la réponse vide.');
  if(k==='eventTime'&&v&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))fail('Heure de l’événement invalide.');
  report.answers[k]=v;
 }
 if(input.causes.length>CAUSE_IDS.length||input.causes.some(c=>!CAUSE_IDS.includes(c)))fail('Cause inconnue dans le rapport.');
 report.causes=[...new Set(input.causes)];
 if(input.measures.length>30)fail('Maximum de 30 mesures correctives par rapport.');
 report.measures=input.measures.map(row=>{if(!object(row))fail('Mesure corrective invalide.');return {cause:string(row.cause,1200),measure:string(row.measure,4000),owner:string(row.owner,240),due:reportDate(row.due)};});
 for(const key of Object.keys(input.signatures))if(!SIGNERS.some(([k])=>k===key))fail('Signataire inconnu.');
 for(const [key] of SIGNERS){
  const strokes=input.signatures[key]??[];
  if(!Array.isArray(strokes)||strokes.length>60)fail('Signature trop longue.');
  let points=0;report.signatures[key]=strokes.map(stroke=>{
   if(!Array.isArray(stroke)||!stroke.length||(points+=stroke.length)>600)fail('Signature trop longue.');
   return stroke.map(p=>{if(!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isInteger(v)||v<0||v>1000))fail('Tracé de signature invalide.');return [...p];});
  });
 }
 return report;
}

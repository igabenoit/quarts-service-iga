import {signedPersonalInformation,personalFields} from './personal-information.js';
import {personalAnswers} from '../public/personal-information-schema.js';
import {blankEthics,ethicsKeys,signedEthics} from './ethics.js';
import {signedRetirement,retirementKeys} from './retirement.js';
import {retirementAnswers} from '../public/retirement-fields.js';
import {sendPending,invitationToken,sendInvitation,invitationEmailReady} from './mail.js';
import {runsInWebProcess} from '../scheduled-work.js';
import {randomBytes,createHash} from 'node:crypto';
import {signedTuac,tuacFields} from './tuac.js';
import {tuacAnswers} from '../public/tuac-fields.js';
import {sharedKinds,directionReady,workflowState,publicDraft} from './workflow.js';
import {signedEmergency,emergencyFields} from './emergency.js';

import {annexKeys,signedAnnex,annexPdf} from './annexe-sst.js';
import {generalSstFields,generalSstEmployeeKeys,signedGeneralSst,blankGeneralSst,sanitizeGeneralSstAnswers} from './sst-general.js';
import {annexSource} from './ethics-source.js';
const blankAnnex=async()=>annexPdf(await annexSource());
const blankFor=kind=>kind==='sst'?blankAnnex():kind==='sst_general'?blankGeneralSst():blankEthics();
const base='/api/employee-files/onboarding';
const catalog={renseignements:{title:'Informations personnelles · Embauche',fields:personalFields,render:signedPersonalInformation},tuac:{title:'Adhésion TUAC 500',fields:tuacFields,render:signedTuac},retraite:{title:'Inscription au régime de retraite',fields:retirementKeys,render:signedRetirement},urgence:{title:'Informations en cas d’urgence',fields:emergencyFields,render:signedEmergency,category:'medical'},ethique:{title:'Code d’éthique et politiques – Septembre 2025',fields:ethicsKeys,render:signedEthics},sst:{title:'Accusé de réception – Programme d’accueil général SST (ancien modèle)',fields:annexKeys,render:signedAnnex},sst_general:{title:'Programme d’accueil général SST – 2026',fields:generalSstFields,render:signedGeneralSst,category:'sst'}};
export const onboardingTitle=kind=>catalog[kind]?.title||'Document d’accueil';
export const onboardingDefaults=['renseignements','tuac','retraite','urgence','ethique','sst_general'];
const digest=value=>createHash('sha256').update(value).digest('hex');
const mail=v=>typeof v==='string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length<=254;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};

export async function installOnboarding(app,{pool,sourcePool,auth,origin,wrap,transaction,directory,person,content,saveOriginal,publishedPolicy,date,trial=null,synthetic=false,event=null}){
 if(!pool)return;
 if(!process.env.VERCEL)await pool.query(`CREATE TABLE IF NOT EXISTS onboarding_cases(employee_key text PRIMARY KEY ${trial?"CHECK(employee_key='trial:unique')":''}, nonce text, token_hash text UNIQUE, generation integer NOT NULL DEFAULT 0, invited_at timestamptz, activity timestamptz, due date, reminder_at timestamptz, reminded boolean DEFAULT false, completed_at timestamptz, notified boolean DEFAULT false, employee_email text, manager_email text);
 CREATE TABLE IF NOT EXISTS onboarding_docs(employee_key text REFERENCES onboarding_cases, kind text, draft jsonb DEFAULT '{}', version integer DEFAULT 0, original_id uuid REFERENCES employee_file_originals, PRIMARY KEY(employee_key,kind));
 ALTER TABLE onboarding_docs ADD COLUMN IF NOT EXISTS invited boolean NOT NULL DEFAULT true`);
 const drain=!synthetic && process.env.RESEND_API_KEY && process.env.SESSION_SECRET ? ()=>sendPending(pool,{trial}) : undefined;
 if(runsInWebProcess() && drain){
  const timer=setInterval(()=>drain().catch(()=>{}),60000);timer.unref();
 }
 async function eligible(key){
  if(trial)return key===trial.key;
  const [kind,id]=key.split(':');
  const table=kind==='service'?'schedule_employees':'schedule_store_people';
  return (await sourcePool.query('SELECT onboarding_new FROM '+table+' WHERE id=$1',[id])).rows[0]?.onboarding_new===true || !!(await pool.query('SELECT 1 FROM onboarding_cases WHERE employee_key=$1',[key])).rowCount;
 }
 async function manager(req){
  const e=person(req.ef,await directory(),req.query.key);
  if(!['direction','gerant'].includes(req.ef.view)||!content(req.ef,e,'rh'))fail(403,'Accès RH requis.');
  return e;
 }
 const docs=async(db,key,allowedMedical=true)=>(await db.query("SELECT kind,version,original_id,invited,draft FROM onboarding_docs WHERE employee_key=$1 ORDER BY CASE kind WHEN 'renseignements' THEN -1 WHEN 'tuac' THEN 0 WHEN 'retraite' THEN 1 WHEN 'urgence' THEN 2 ELSE 3 END,kind",[key])).rows.map(d=>{
  const {draft,...doc}=d,state=workflowState(d);
  return d.kind==='urgence'&&!allowedMedical?{...doc,...state,done:!!d.original_id,original_id:null,employeeOriginalId:null,restricted:true}:{...doc,...state,done:!!d.original_id};
 });
 app.get(base+'/modele/sst-general',auth,wrap(async(req,res)=>{
  if(!['direction','gerant'].includes(req.ef.view))fail(403,'Accès réservé à la gestion.');
  res.set('Cache-Control','no-store').type('pdf').send(await blankGeneralSst());
 }));
 app.get(base,auth,wrap(async(req,res)=>{
  const e=await manager(req);
  if(!await eligible(e.key))return res.json({eligible:false,canStart:e.active&&!e.issue});
  await pool.query('INSERT INTO onboarding_cases(employee_key) VALUES($1) ON CONFLICT DO NOTHING',[e.key]);
  const row=(await pool.query('SELECT invited_at,activity,due::text,completed_at,employee_email,manager_email,generation,token_hash IS NOT NULL AS active FROM onboarding_cases WHERE employee_key=$1',[e.key])).rows[0];
  const lastDelivery=event?(await pool.query("SELECT created_at,data->>'status' AS status,data->>'email' AS email FROM employee_file_events WHERE action IN ('onboarding.delivery','onboarding.invite','onboarding.renew') AND data->>'employeeKey'=$1 ORDER BY id DESC LIMIT 1",[e.key])).rows[0]:null;
  const suggestedEmployeeEmail=!trial&&e.personId?(await sourcePool.query("SELECT COALESCE(NULLIF(c.email,''),p.email,'') AS email FROM schedule_store_people p LEFT JOIN schedule_employee_contacts c ON c.employee_id=p.service_employee_id WHERE p.id=$1",[e.personId])).rows[0]?.email||'':'';
  res.json({eligible:true,...(trial?{trialPolicy:trial.policy,policyId:trial.policyId,employeeEmail:trial.employeeEmail,managerEmail:trial.managerEmail}:{}),...row,suggestedEmployeeEmail,emailReady:!synthetic&&invitationEmailReady(),lastDelivery,defaultDocuments:onboardingDefaults,documents:await docs(pool,e.key,content(req.ef,e,'medical')),catalog:Object.fromEntries(Object.entries(catalog).map(([k,v])=>[k,v.title]))});
 }));
 app.post(base+'/:operation',auth,origin,wrap(async(req,res)=>{
  const e=await manager(req), op=req.params.operation;
  if(!e.active||e.issue)fail(409,'Vérifiez le matricule et le statut actif de cette fiche.');
  if(op==='start'){
   if(trial&&e.key!==trial.key)fail(403,'Fiche hors essai.');
   await transaction(async db=>{await db.query('INSERT INTO onboarding_cases(employee_key) VALUES($1) ON CONFLICT DO NOTHING',[e.key]);if(event)await event(db,req.ef,'onboarding.started',{employeeKey:e.key});});
   return res.json({ok:true});
  }
  if(!await eligible(e.key))fail(409,'Ouvrez d’abord le dossier d’embauche.');
  async function delivery(){
   return transaction(async db=>{
    const row=(await db.query('SELECT * FROM onboarding_cases WHERE employee_key=$1 FOR UPDATE',[e.key])).rows[0];
    if(!row?.invited_at||!row.token_hash||row.completed_at)fail(409,'Le lien est révoqué ou le dossier est complet.');
    if(trial&&(row.employee_email!==trial.employeeEmail||row.manager_email!==trial.managerEmail))fail(403,'Destinataires hors essai.');
    const items=(await docs(db,e.key)).filter(d=>d.invited);
    let result;
    if(synthetic||!invitationEmailReady())result={status:'unavailable',email:row.employee_email};
    else try{result=await sendInvitation(row,items.map(d=>catalog[d.kind].title));}catch{result={status:'failed',email:row.employee_email};}
    if(event)await event(db,req.ef,'onboarding.delivery',{employeeKey:e.key,generation:row.generation,...result});
    return {delivery:result,path:'/accueil-employe.html#'+invitationToken(row.nonce)};
   });
  }
  if(op==='send')return res.json(await delivery());
  const result=await transaction(async db=>{
   const row=(await db.query('SELECT * FROM onboarding_cases WHERE employee_key=$1 FOR UPDATE',[e.key])).rows[0];
   if(!row)fail(409,'Dossier indisponible.');
   if(op==='revoke'){await db.query('UPDATE onboarding_cases SET token_hash=NULL WHERE employee_key=$1',[e.key]);return {};}
   let nonce=row.nonce,token;
   if(op==='invite'){
    const b=req.body;
    if(trial && (b.email!==trial.employeeEmail||b.managerEmail!==trial.managerEmail||b.approvedPolicy!==trial.policyId))fail(400,'Vérifiez les destinataires et approuvez la politique de cet essai.');
    if(!await publishedPolicy(db))fail(428,'Publiez la politique de confidentialité avant l’invitation.');
    if(!Array.isArray(b.documents)||!b.documents.length||b.documents.some(k=>!Object.hasOwn(catalog,k))||!mail(b.email)||!mail(b.managerEmail)||!date(b.due)||!Number.isInteger(b.days)||b.days<1||b.days>365)fail(400,'Vérifiez les documents, les courriels, l’échéance et le délai.');
    for(const k of new Set(b.documents))await db.query('INSERT INTO onboarding_docs(employee_key,kind) VALUES($1,$2) ON CONFLICT(employee_key,kind) DO UPDATE SET invited=true',[e.key,k]);
    if(!(await db.query('SELECT 1 FROM onboarding_docs WHERE employee_key=$1 AND invited AND original_id IS NULL LIMIT 1',[e.key])).rowCount)fail(409,'Les formulaires sélectionnés sont déjà signés.');
    await db.query("UPDATE onboarding_cases SET invited_at=COALESCE(invited_at,now()),due=$2,reminder_at=now()+$3::int*interval '1 day',employee_email=$4,manager_email=$5,completed_at=NULL,notified=false,reminded=false WHERE employee_key=$1",[e.key,b.due,b.days,b.email,b.managerEmail]);
    // A corrected recipient must not leave the previous recipient's link active.
    if(row.employee_email&&row.employee_email!==b.email)nonce=null;
   }else if(op!=='renew'||!row.invited_at||row.completed_at)fail(409,'Actualisez le dossier.');
   if(op==='renew'||!row.token_hash||!nonce){
    nonce=randomBytes(32).toString('hex');token=invitationToken(nonce);
    await db.query('UPDATE onboarding_cases SET token_hash=$2,nonce=$3,generation=generation+1 WHERE employee_key=$1',[e.key,digest(token),nonce]);
   }else token=invitationToken(nonce);
   if(event)await event(db,req.ef,'onboarding.'+op,{employeeKey:e.key,documents:req.body?.documents});
   return {path:'/accueil-employe.html#'+token};
  });
  res.json(op==='invite'&&req.body.delivery==='email'?await delivery():result);
 }));
 async function updateDocument(db,req,row,policy,action,onsite){
   const key=row.employee_key;
   if(action!=='state'){
    if(!['save','sign','finalize'].includes(action)||(!onsite&&row.completed_at))fail(409,'Dossier fermé.');
    const b=req.body,doc=(await db.query('SELECT * FROM onboarding_docs WHERE employee_key=$1 AND kind=$2',[key,b.kind])).rows[0];
    if(!doc||(!onsite&&!doc.invited)||doc.original_id||doc.version!==b.version)fail(409,'Rechargez le document.');
    const previous=doc.draft||{},workflow=previous._workflow,pending=!!workflow?.employeeOriginalId;
    if(pending&&!onsite)fail(409,'Votre partie est déjà signée et verrouillée. La direction doit maintenant finaliser le document.');
    if(action==='finalize'&&(!onsite||!pending||!sharedKinds.has(doc.kind)))fail(400,'Une partie employé signée est requise avant la finalisation.');
    if(pending&&action==='sign')fail(400,'Utilisez la finalisation pour conserver la signature de l’employé.');
     if(!Object.hasOwn(catalog,doc.kind))fail(400,'Formulaire inconnu.');
    if(b.policy!==String(policy.id)||!b.answers||typeof b.answers!=='object')fail(400,'Confirmez la politique et vérifiez les champs.');
    const spec=catalog[doc.kind];
    let answers=Object.fromEntries(spec.fields.map(k=>[k,String(b.answers[k]??'').slice(0,200)]));
    if(doc.kind==='tuac'){
     if(onsite&&action==='sign')fail(400,'L’employé doit signer sa partie depuis son lien personnel.');
     try{answers=tuacAnswers(b.answers,previous,onsite);}catch(error){fail(400,error.message);}
    }
    if(doc.kind==='renseignements'){
     if(onsite&&action==='sign')fail(400,'L’employé doit signer ce formulaire depuis son lien personnel.');
     try{answers=personalAnswers(b.answers,doc.draft||{},onsite);}catch(error){fail(400,error.message);}
    }
    if(doc.kind==='retraite'){
     if(onsite&&action==='sign')fail(400,'L’employé doit signer ce formulaire depuis son lien personnel.');
     try{answers=retirementAnswers(b.answers,doc.draft||{},onsite);}catch(error){fail(400,error.message);}
    }
    if(doc.kind==='sst_general'){
     answers=sanitizeGeneralSstAnswers(answers,onsite);
     if(pending&&onsite)for(const key of generalSstEmployeeKeys)answers[key]=previous[key]||'';
    }
    if(doc.kind==='sst'&&!onsite){
      for(const k of spec.fields.filter(k=>k.startsWith('initiales')))answers[k]=doc.draft?.[k]||'';
    }
    let original=null;
    if(workflow)answers._workflow=workflow;
    if(action==='sign'||action==='finalize'){
     const employeeOnly=!onsite&&sharedKinds.has(doc.kind)&&!directionReady(doc.kind,answers);
     const finalizing=action==='finalize',strokes=finalizing?workflow.strokes:b.strokes;
     if(finalizing&&doc.kind==='sst_general'&&(!answers.signature_nom_responsable?.trim()||!answers.signature_date_responsable||!answers.responsable_accueil?.trim()||!answers.date_accueil))fail(400,'Complétez le responsable de l’accueil, la date et la signature du responsable.');
     let bytes;try{bytes=await spec.render(answers,strokes,{onsite,employeeOnly,supervisorStrokes:onsite?b.supervisorStrokes:[]});}catch(error){fail(400,sharedKinds.has(doc.kind)?error.message:'Vérifiez les champs et la signature.');}
     const provenance=employeeOnly?'Partie employé signée · à finaliser par la direction':finalizing?'Finalisation de la direction · partie employé signée conservée : '+workflow.employeeOriginalId:onsite?'Signature en présence de l’employé':'Signature du parcours d’accueil';
     const file=await saveOriginal(db,{audit:onsite?{...req.ef.audit,kind:finalizing?'finalisation-direction':'sur-place',policy:String(policy.id)}:{kind:'invitation',generation:row.generation,policy:String(policy.id)}},{key},spec.category||'rh',bytes,{name:spec.title+(employeeOnly?' - Partie employé signée':'')+'.pdf',mime:'application/pdf',provenance,documentDate:new Date().toISOString().slice(0,10),signatureKind:'drawn'});
     if(employeeOnly){
      const employee=(await directory()).employees.find(e=>e.key===key);
      answers._workflow={employeeOriginalId:file.id,signedAt:new Date().toISOString(),strokes,policy:String(policy.id),title:spec.title,employeeName:employee?.name||'Employé',notifiedAt:null};
     }else{
      original=file.id;
      if(finalizing)answers._workflow={...workflow,strokes:null,finalizedAt:new Date().toISOString()};
     }
     if(event)await event(db,onsite?req.ef:{audit:{kind:'invitation',generation:row.generation}},employeeOnly?'onboarding.employee_signed':finalizing?'onboarding.finalized':'onboarding.signed',{employeeKey:key,kind:doc.kind,originalId:file.id});
    }
    await db.query('UPDATE onboarding_docs SET draft=$3,version=version+1,original_id=$4 WHERE employee_key=$1 AND kind=$2',[key,doc.kind,JSON.stringify(original?(answers._workflow?{_workflow:answers._workflow}:{}):answers),original]);
    await db.query('UPDATE onboarding_cases SET activity=now(),completed_at=CASE WHEN completed_at IS NOT NULL THEN completed_at WHEN invited_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM onboarding_docs WHERE employee_key=$1 AND invited AND original_id IS NULL) THEN now() END WHERE employee_key=$1',[key]);
   }
 }
 app.post(base+'/sur-place/:action',auth,origin,wrap(async(req,res)=>{
  const e=await manager(req),kind=req.body.kind,action=req.params.action;
  if(['retraite','tuac'].includes(kind)&&req.ef.view!=='direction')fail(403,'Section réservée à la direction.');
  if(!e.active||e.issue||!Object.hasOwn(catalog,kind)||!['state','save','sign',...(sharedKinds.has(kind)?['finalize']:[]),...(['ethique','sst','sst_general'].includes(kind)?['lecture']:[])].includes(action))fail(400,'Vérifiez le dossier et le formulaire.');
  if(action==='lecture')return res.set('Cache-Control','no-store').type('pdf').send(await blankFor(kind));
  if(kind==='urgence'&&!content(req.ef,e,'medical'))fail(403,'Accès aux informations médicales réservé aux personnes autorisées.');
  const policy=await publishedPolicy(pool);
  if(!policy)fail(428,'Publiez la politique de confidentialité avant de remplir un formulaire.');
  res.set('Cache-Control','no-store');
  res.json(await transaction(async db=>{
   if(action!=='state'){
    await db.query('INSERT INTO onboarding_cases(employee_key) VALUES($1) ON CONFLICT DO NOTHING',[e.key]);
    const row=(await db.query('SELECT * FROM onboarding_cases WHERE employee_key=$1 FOR UPDATE',[e.key])).rows[0];
    await db.query('INSERT INTO onboarding_docs(employee_key,kind,invited) VALUES($1,$2,false) ON CONFLICT DO NOTHING',[e.key,kind]);
    await updateDocument(db,req,row,policy,action,true);
   }
   const saved=(await db.query('SELECT draft,version,original_id FROM onboarding_docs WHERE employee_key=$1 AND kind=$2',[e.key,kind])).rows[0];
   return {employee:e.name,documents:[{kind,title:catalog[kind].title,fields:catalog[kind].fields,draft:publicDraft(saved?.draft),version:saved?.version||0,done:!!saved?.original_id,originalId:saved?.original_id,...workflowState({kind,...saved})}],policy:{id:String(policy.id),text:policy.text}};
  }));
 }));
 app.post('/api/accueil-employe/:action',origin,wrap(async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!/^Bearer [A-Za-z0-9_-]{43}$/.test(req.get('authorization')||''))fail(404,'Lien indisponible.');
  const token=req.get('authorization').slice(7);
  const result=await transaction(async db=>{
   const row=(await db.query('SELECT * FROM onboarding_cases WHERE token_hash=$1 FOR UPDATE',[digest(token)])).rows[0];
   if(!row || (trial && row.employee_key!==trial.key) || !(await directory()).employees.some(e=>e.key===row.employee_key && e.active && !e.issue))fail(404,'Lien indisponible.');
   const policy=await publishedPolicy(db);
   if(!policy)fail(428,'Politique temporairement indisponible.');
   const key=row.employee_key,action=req.params.action;
   if(action==='lecture'){
    const kind=req.body.kind||'ethique';
    if(!['sst','sst_general','ethique'].includes(kind))fail(404,'Document indisponible.');
    const allowed=await db.query("SELECT 1 FROM onboarding_docs WHERE employee_key=$1 AND kind=$2 AND invited",[key,kind]);
    if(!allowed.rowCount)fail(404,'Document indisponible.');
    return null;
   }
   await updateDocument(db,req,row,policy,action,false);
   const items=(await db.query("SELECT kind,draft,version,original_id IS NOT NULL AS done FROM onboarding_docs WHERE employee_key=$1 AND invited ORDER BY CASE kind WHEN 'renseignements' THEN -1 WHEN 'tuac' THEN 0 WHEN 'retraite' THEN 1 WHEN 'urgence' THEN 2 ELSE 3 END,kind",[key])).rows;
   return {documents:items.map(d=>({...d,...workflowState(d),draft:publicDraft(d.draft),title:catalog[d.kind].title,fields:catalog[d.kind].fields})),policy:{id:String(policy.id),text:policy.text},due:row.due};
  });
  if(result===null)return res.type('pdf').send(await blankFor(req.body.kind));
  res.json(result);
 }));
 return drain;
}

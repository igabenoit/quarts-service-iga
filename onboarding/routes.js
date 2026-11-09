import {sendPending,invitationToken} from './mail.js';
import {randomBytes,createHash} from 'node:crypto';
import {signedTuac,tuacFields} from './tuac.js';

const base='/api/employee-files/onboarding';
const catalog={tuac:{title:'Adhésion TUAC 500',fields:tuacFields,render:signedTuac}};
const digest=value=>createHash('sha256').update(value).digest('hex');
const mail=v=>typeof v==='string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length<=254;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};

export async function installOnboarding(app,{pool,sourcePool,auth,origin,wrap,transaction,directory,person,content,saveOriginal,publishedPolicy,date,trial=null}){
 if(!pool)return;
 await pool.query(`CREATE TABLE IF NOT EXISTS onboarding_cases(employee_key text PRIMARY KEY ${trial?"CHECK(employee_key='trial:unique')":''}, nonce text, token_hash text UNIQUE, generation integer NOT NULL DEFAULT 0, invited_at timestamptz, activity timestamptz, due date, reminder_at timestamptz, reminded boolean DEFAULT false, completed_at timestamptz, notified boolean DEFAULT false, employee_email text, manager_email text);
 CREATE TABLE IF NOT EXISTS onboarding_docs(employee_key text REFERENCES onboarding_cases, kind text, draft jsonb DEFAULT '{}', version integer DEFAULT 0, original_id uuid REFERENCES employee_file_originals, PRIMARY KEY(employee_key,kind))`);
 if(process.env.RESEND_API_KEY && process.env.SESSION_SECRET){
  const timer=setInterval(()=>sendPending(pool,{trial}).catch(()=>{}),60000);timer.unref();
 }
 async function eligible(key){
  if(trial)return key===trial.key;
  const [kind,id]=key.split(':');
  const table=kind==='service'?'schedule_employees':'schedule_store_people';
  return (await sourcePool.query('SELECT onboarding_new FROM '+table+' WHERE id=$1',[id])).rows[0]?.onboarding_new===true;
 }
 async function manager(req){
  const e=person(req.ef,await directory(),req.query.key);
  if(!['direction','gerant'].includes(req.ef.view)||!content(req.ef,e,'rh'))fail(403,'Accès RH requis.');
  return e;
 }
 const docs=async(db,key)=>(await db.query('SELECT kind,version,original_id FROM onboarding_docs WHERE employee_key=$1 ORDER BY kind',[key])).rows;
 app.get(base,auth,wrap(async(req,res)=>{
  const e=await manager(req);
  if(!await eligible(e.key))return res.json({eligible:false});
  await pool.query('INSERT INTO onboarding_cases(employee_key) VALUES($1) ON CONFLICT DO NOTHING',[e.key]);
  const row=(await pool.query('SELECT invited_at,activity,due::text,completed_at,token_hash IS NOT NULL AS active FROM onboarding_cases WHERE employee_key=$1',[e.key])).rows[0];
  res.json({eligible:true,...(trial?{trialPolicy:trial.policy,policyId:trial.policyId,employeeEmail:trial.employeeEmail,managerEmail:trial.managerEmail}:{}),...row,documents:await docs(pool,e.key),catalog:Object.fromEntries(Object.entries(catalog).map(([k,v])=>[k,v.title]))});
 }));
 app.post(base+'/:operation',auth,origin,wrap(async(req,res)=>{
  const e=await manager(req), op=req.params.operation;
  if(!await eligible(e.key)||!e.active||e.issue)fail(409,'Vérifiez la fiche de cette nouvelle embauche.');
  const result=await transaction(async db=>{
   const row=(await db.query('SELECT * FROM onboarding_cases WHERE employee_key=$1 FOR UPDATE',[e.key])).rows[0];
   if(!row||row.completed_at)fail(409,'Dossier indisponible.');
   if(op==='revoke'){await db.query('UPDATE onboarding_cases SET token_hash=NULL WHERE employee_key=$1',[e.key]);return {};}
   const nonce=randomBytes(32).toString('hex'), token=invitationToken(nonce);
   if(op==='invite'&&!row.invited_at){
    const b=req.body;
    if(trial && (b.email!==trial.employeeEmail||b.managerEmail!==trial.managerEmail||b.approvedPolicy!==trial.policyId))fail(400,'Vérifiez les destinataires et approuvez la politique de cet essai.');
    if(!await publishedPolicy(db))fail(428,'Publiez la politique de confidentialité avant l’invitation.');
    if(!Array.isArray(b.documents)||!b.documents.length||b.documents.some(k=>!Object.hasOwn(catalog,k))||!mail(b.email)||!mail(b.managerEmail)||!date(b.due)||!Number.isInteger(b.days)||b.days<1||b.days>365)fail(400,'Vérifiez les documents, les courriels, l’échéance et le délai.');
    for(const k of new Set(b.documents))await db.query('INSERT INTO onboarding_docs(employee_key,kind) VALUES($1,$2)',[e.key,k]);
    await db.query("UPDATE onboarding_cases SET invited_at=now(),due=$2,reminder_at=now()+$3::int*interval '1 day',employee_email=$4,manager_email=$5 WHERE employee_key=$1",[e.key,b.due,b.days,b.email,b.managerEmail]);
   }else if(op!=='renew'||!row.invited_at)fail(409,'Actualisez le dossier.');
   await db.query('UPDATE onboarding_cases SET token_hash=$2,nonce=$3,generation=generation+1 WHERE employee_key=$1',[e.key,digest(token),nonce]);
   return {path:'/accueil-employe.html#'+token};
  });
  res.json(result);
 }));
 app.post('/api/accueil-employe/:action',origin,wrap(async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!/^Bearer [A-Za-z0-9_-]{43}$/.test(req.get('authorization')||''))fail(404,'Lien indisponible.');
  const token=req.get('authorization').slice(7);
  res.json(await transaction(async db=>{
   const row=(await db.query('SELECT * FROM onboarding_cases WHERE token_hash=$1 FOR UPDATE',[digest(token)])).rows[0];
   if(!row || (trial && row.employee_key!==trial.key) || !(await directory()).employees.some(e=>e.key===row.employee_key && e.active && !e.issue))fail(404,'Lien indisponible.');
   const policy=await publishedPolicy(db);
   if(!policy)fail(428,'Politique temporairement indisponible.');
   const key=row.employee_key,action=req.params.action;
   if(action!=='state'){
    if(!['save','sign'].includes(action)||row.completed_at)fail(409,'Dossier fermé.');
    const b=req.body,doc=(await db.query('SELECT * FROM onboarding_docs WHERE employee_key=$1 AND kind=$2',[key,b.kind])).rows[0];
    if(!doc||doc.original_id||doc.version!==b.version)fail(409,'Rechargez le document.');
    if(b.policy!==String(policy.id)||!b.answers||typeof b.answers!=='object')fail(400,'Confirmez la politique et vérifiez les champs.');
    const spec=catalog[doc.kind], answers=Object.fromEntries(spec.fields.map(k=>[k,String(b.answers[k]??'').slice(0,200)]));
    let original=null;
    if(action==='sign'){
     let bytes;try{bytes=await spec.render(answers,b.strokes);}catch{fail(400,'Vérifiez les champs et la signature.');}
     const file=await saveOriginal(db,{audit:{kind:'invitation',generation:row.generation,policy:String(policy.id)}},{key},'rh',bytes,{name:spec.title+'.pdf',mime:'application/pdf',provenance:'Signature du parcours d’accueil',documentDate:new Date().toISOString().slice(0,10),signatureKind:'drawn'});
     original=file.id;
    }
    await db.query('UPDATE onboarding_docs SET draft=$3,version=version+1,original_id=$4 WHERE employee_key=$1 AND kind=$2',[key,doc.kind,JSON.stringify(original?{}:answers),original]);
    await db.query('UPDATE onboarding_cases SET activity=now(),completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM onboarding_docs WHERE employee_key=$1 AND original_id IS NULL) THEN now() END WHERE employee_key=$1',[key]);
   }
   const items=(await db.query('SELECT kind,draft,version,original_id IS NOT NULL AS done FROM onboarding_docs WHERE employee_key=$1 ORDER BY kind',[key])).rows;
   return {documents:items.map(d=>({...d,title:catalog[d.kind].title,fields:catalog[d.kind].fields})),policy:{id:String(policy.id),text:policy.text},due:row.due};
  }));
 }));
}

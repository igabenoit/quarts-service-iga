import {randomUUID,createHash} from 'node:crypto';
import {jsPDF} from 'jspdf';

export const tuacOwnerId=69574;
export const departments={A:'BOUCHERIE',B:'POISSONNERIE',C:'CHARCUTERIE',D:'ÉPICERIE',E:'FRUITS ET LÉGUMES',F:'BOULANGERIE',G:'COMMIS EMBALLEURS',H:'COMMIS CAISSE',M:'PRÊT-À-MANGER'};
const directoryDepartments={A:['viande','boucherie'],B:['poissonnerie'],C:['charcuterie'],D:['epicerie'],E:['fruitslegumes','fruitsetlegumes'],F:['boulangerie'],G:['service'],H:['service'],M:['pretamanger']};
const normalized=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]/g,'');
export function departmentEmployees(directory,department){
 const ids=directory.departments.filter(d=>d.active!==false&&directoryDepartments[department]?.includes(normalized(d.code||d.name))).map(d=>Number(d.id));
 return directory.employees.filter(e=>e.active&&e.departments.some(id=>ids.includes(Number(id)))).map(e=>({key:e.key,name:e.name,matricule:e.matricule||null})).sort((a,b)=>a.name.localeCompare(b.name,'fr'));
}
export const tuacSchemaSQL=`CREATE TABLE IF NOT EXISTS tuac_postings(id uuid PRIMARY KEY,reference text NOT NULL UNIQUE,department text NOT NULL,data jsonb NOT NULL,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tuac_posting_history(id bigserial PRIMARY KEY,posting_id uuid NOT NULL REFERENCES tuac_postings(id),version integer NOT NULL,data jsonb NOT NULL,actor jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(posting_id,version));
CREATE TABLE IF NOT EXISTS tuac_posting_mail(id uuid PRIMARY KEY,posting_id uuid NOT NULL REFERENCES tuac_postings(id),fingerprint text NOT NULL,payload jsonb NOT NULL,status text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE tuac_postings ENABLE ROW LEVEL SECURITY; ALTER TABLE tuac_posting_history ENABLE ROW LEVEL SECURITY; ALTER TABLE tuac_posting_mail ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tuac_postings,tuac_posting_history,tuac_posting_mail FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON tuac_postings,tuac_posting_history,tuac_posting_mail FROM anon; END IF; IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON tuac_postings,tuac_posting_history,tuac_posting_mail FROM authenticated; END IF; END $$;`;
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const text=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||required&&!v.trim())fail('Vérifiez les champs obligatoires et leur longueur.');return v.trim();};
export function endDate(value){const d=new Date(value+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(+d)||d.toISOString().slice(0,10)!==value)fail('Date invalide.');d.setUTCDate(d.getUTCDate()+7);return d.toISOString().slice(0,10);}
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function fields(b){
 const department=b.department;if(!Object.hasOwn(departments,department))fail('Département invalide.');
 const reference=text(b.reference,40,true);if(!new RegExp('^'+department+'-[A-Za-z0-9-]+$').test(reference))fail('Le numéro doit commencer par '+department+'- (ex. '+department+'-01).');
 if(!['Partiel','Régulier'].includes(b.employmentStatus))fail('Choisissez le statut.');
 const startDate=text(b.startDate,10,true),closeDate=endDate(startDate);
 let nomination=null;if(b.nomination){const effectiveDate=text(b.nomination.effectiveDate,10,true);endDate(effectiveDate);nomination={employee:text(b.nomination.employee,180,true),effectiveDate,...(b.nomination.employeeKey?{employeeKey:text(b.nomination.employeeKey,100,true)}:{})};}
 return {department,reference,job:text(b.job,180,true),employmentStatus:b.employmentStatus,startDate,endDate:closeDate,supervisor:text(b.supervisor,180,true),requirements:text(b.requirements,6000,true),candidates:text(b.candidates??'',6000),nomination};
}
export function documentPdf(data,kind){
 if(!['affichage','nomination'].includes(kind)||kind==='nomination'&&!data.nomination)fail('Nomination non remplie.');
 const doc=new jsPDF({format:'letter'});let y=24;const width=174;
 const line=(s,size=12,bold=false,gap=6)=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);for(const part of doc.splitTextToSize(s,width)){if(y>255){doc.addPage();y=24;}doc.text(part,20,y);y+=gap;}y+=4;};
 line(kind==='affichage'?'AFFICHAGE DE POSTE':'NOMINATION DE POSTE',19,true,9);
 line('TUAC 500 · '+data.department+' - '+departments[data.department],11);
 line('Affichage # : '+data.reference,12,true);
 line(kind==='affichage'?'Conformément aux dispositions de la présente convention collective, nous affichons le poste ci-dessous :':'Conformément aux dispositions de la présente convention collective, nous confirmons la nomination au poste suivant :');
 if(kind==='nomination')line('Employé(e) nommé(e) : '+data.nomination.employee,12,true);
 line('Poste : '+data.job);line('Statut : '+data.employmentStatus);
 if(kind==='affichage')line('Période : du '+data.startDate+' à 00 h au '+data.endDate+' à 00 h (7 jours).');
 else line('Date d’entrée en fonction : '+data.nomination.effectiveDate);
 line('Supérieur immédiat : '+data.supervisor);line('Exigences du poste :',12,true);line(data.requirements);
 if(kind==='affichage'){line('Candidats :',12,true);line(data.candidates||'________________________________________________\n\n________________________________________________\n\n________________________________________________');line('CE DOCUMENT EST SÉRIEUX. NE PAS INSCRIRE VOTRE NOM OU CELUI DE QUELQU’UN D’AUTRE SI VOUS N’ÊTES PAS INTÉRESSÉ.',10,true);}
 else line('Cette nomination est effective à compter de la date indiquée ci-dessus et sera consignée au dossier de l’employé(e).');
 return Buffer.from(doc.output('arraybuffer'));
}
export async function installTuacPostings(app,{pool,auth,origin,wrap,transaction,directory,fetchImpl=fetch}){
 if(pool&&!process.env.VERCEL)await pool.query(tuacSchemaSQL);
 const base='/api/employee-files/tuac';
 const owner=(req,res,next)=>{if(!req.ef.admin||req.ef.manager?.authentication!=='passkey'||Number(req.ef.manager?.personId)!==tuacOwnerId)return res.status(403).json({error:'Cette section est réservée à Marc-André Benoit pour le moment.'});next();};
 const get=async(id,db=pool)=>{if(!uuid(id))fail('Affichage introuvable.',404);const r=(await db.query('SELECT * FROM tuac_postings WHERE id=$1',[id])).rows[0];if(!r)fail('Affichage introuvable.',404);return r;};
 const employees=async department=>{if(!directory)fail('La liste des employés est temporairement indisponible.',503);return departmentEmployees(await directory(),department);};
 const resolveNomination=async(b,previous)=>{
  if(!b.nomination)return b;
  // Preserve the saved snapshot when editing only the posting, including legacy nominations.
  if(previous&&JSON.stringify(b.nomination)===JSON.stringify(previous.nomination))return b;
  const employee=(await employees(b.department)).find(e=>e.key===b.nomination.employeeKey);
  if(!employee)fail('Choisissez un employé actif du département de cet affichage.');
  return {...b,nomination:{employeeKey:employee.key,employee:employee.name,effectiveDate:b.nomination.effectiveDate}};
 };
 app.get(base+'/:id/employees',auth,owner,wrap(async(req,res)=>{const r=await get(req.params.id);res.json({employees:await employees(r.department)});}));
 app.get(base,auth,owner,wrap(async(req,res)=>res.json({departments,today:today(),records:(await pool.query('SELECT * FROM tuac_postings ORDER BY created_at DESC')).rows,mailEnabled:!!process.env.RESEND_API_KEY})));
 app.post(base,auth,owner,origin,wrap(async(req,res)=>{
  const data=fields(await resolveNomination({...req.body,reference:req.body?.department+'-01'})),id=randomUUID();
  await transaction(async db=>{
   // Serialize allocation with insertion so simultaneous saves never share a number.
   await db.query('SELECT pg_advisory_xact_lock(835110)');
   const {rows:[last]}=await db.query(`SELECT COALESCE(MAX(split_part(reference,'-',2)::numeric),0)::text AS number FROM (
    SELECT reference FROM tuac_postings UNION ALL SELECT data->>'reference' FROM tuac_posting_history
   ) refs WHERE reference ~ $1`,['^'+data.department+'-[0-9]+$']);
   data.reference=data.department+'-'+String(BigInt(last.number)+1n).padStart(2,'0');
   await db.query('INSERT INTO tuac_postings(id,reference,department,data) VALUES($1,$2,$3,$4)',[id,data.reference,data.department,JSON.stringify(data)]);
   await db.query('INSERT INTO tuac_posting_history(posting_id,version,data,actor) VALUES($1,1,$2,$3)',[id,JSON.stringify(data),JSON.stringify(req.ef.audit)]);
  });res.status(201).json({id,reference:data.reference});
 }));
 app.post(base+'/:id',auth,owner,origin,wrap(async(req,res)=>{
  await transaction(async db=>{const old=await get(req.params.id,db);if(old.version!==req.body.version)fail('Le document a changé. Rechargez-le avant de modifier.',409);
   if(req.body.department!==old.department)fail('Le département est lié au numéro attribué. Créez un affichage dans le nouveau département.');
   const data=fields(await resolveNomination({...req.body,department:old.department,reference:old.reference},old.data));
   await db.query('UPDATE tuac_postings SET data=$2,version=version+1,updated_at=now() WHERE id=$1',[old.id,JSON.stringify(data)]);
   await db.query('INSERT INTO tuac_posting_history(posting_id,version,data,actor) VALUES($1,$2,$3,$4)',[old.id,old.version+1,JSON.stringify(data),JSON.stringify(req.ef.audit)]);
  });res.json({ok:true});
 }));
 app.get(base+'/:id/history',auth,owner,wrap(async(req,res)=>{await get(req.params.id);res.json({history:(await pool.query('SELECT version,data,created_at FROM tuac_posting_history WHERE posting_id=$1 ORDER BY version DESC',[req.params.id])).rows,mail:(await pool.query("SELECT status,created_at,payload->'to' AS recipients,payload->>'subject' AS subject FROM tuac_posting_mail WHERE posting_id=$1 ORDER BY created_at DESC",[req.params.id])).rows});}));
 app.get(base+'/:id/:kind/pdf',auth,owner,wrap(async(req,res)=>{const r=await get(req.params.id),bytes=documentPdf(r.data,req.params.kind);res.set({'Content-Type':'application/pdf','Content-Disposition':`inline; filename="${req.params.kind}-${r.reference}.pdf"`,'Cache-Control':'private, no-store'}).send(bytes);}));
 app.post(base+'/:id/:kind/email',auth,owner,origin,wrap(async(req,res)=>{
  if(!process.env.RESEND_API_KEY)fail('Le service de courriel est indisponible.',503);
  const {requestId}=req.body;if(!uuid(requestId))fail('Identifiant d’envoi invalide.');
  const to=text(req.body.to,1500,true).split(/[;,]/).map(x=>x.trim()).filter(Boolean);if(!to.length||to.length>10||to.some(x=>! /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x)))fail('Indiquez de 1 à 10 adresses courriel valides.');
  const r=await get(req.params.id),kind=req.params.kind,bytes=documentPdf(r.data,kind);
  if(r.version!==req.body.version)fail('Le document a changé. Rechargez-le.',409);
  const fingerprint=createHash('sha256').update(JSON.stringify([r.id,r.version,kind,to])).digest('hex');
  const payload={from:process.env.RESEND_FROM_EMAIL||process.env.RESEND_FROM||process.env.EMAIL_FROM||'Quarts Service <onboarding@resend.dev>',to,subject:(kind==='affichage'?'Affichage de poste':'Nomination de poste')+' '+r.reference+' — '+r.data.job,text:'Bonjour,\n\nVeuillez trouver le document en pièce jointe.\n\nIGA Extra Famille Benoit',attachments:[{filename:kind+'-'+r.reference+'.pdf',content:bytes.toString('base64')}]};
  await pool.query('INSERT INTO tuac_posting_mail(id,posting_id,fingerprint,payload) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[requestId,r.id,fingerprint,JSON.stringify(payload)]);
  const mail=(await pool.query('SELECT * FROM tuac_posting_mail WHERE id=$1',[requestId])).rows[0];if(mail.fingerprint!==fingerprint)fail('Cet envoi correspond à une autre version. Fermez puis rouvrez le formulaire.',409);if(mail.status==='sent')return res.json({ok:true});if(Date.now()-new Date(mail.created_at)>20*3600000)fail('Envoi ancien à vérifier dans la messagerie avant de recommencer.',409);
  let result;try{result=await fetchImpl('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'tuac-'+requestId},body:JSON.stringify(mail.payload)});}catch{fail('Envoi non confirmé. Réessayez ici pour éviter un doublon.',502);}
  if(!result.ok)fail('Envoi non confirmé par le service. Réessayez ici.',502);
  await pool.query("UPDATE tuac_posting_mail SET status='sent' WHERE id=$1",[requestId]);res.json({ok:true});
 }));
}

import crypto from 'node:crypto';
import {normalizeEmail} from './employee-contacts.js';
import {isDate,monday} from './public/departments-core.js';
const labels={draft:'Ébauche',blank:'Gabarit vierge',filled:'Horaire rempli'};
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export function recipients(value){
  if(!Array.isArray(value)||value.length>20)fail('Indiquez au plus 20 adresses courriel.');
  const list=value.map(normalizeEmail);if(list.some(v=>!v))fail('Une adresse courriel est invalide.');
  return [...new Set(list)];
}
export async function installDepartmentMail(app,pool,{requireManager,sameOrigin,fetchImpl=fetch}){
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_department_mail_settings(department_id BIGINT PRIMARY KEY REFERENCES schedule_leave_departments(id),recipients JSONB NOT NULL DEFAULT '[]',version INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS schedule_department_document_mail(id UUID PRIMARY KEY,department_id BIGINT REFERENCES schedule_leave_departments(id),week_start DATE NOT NULL,kind TEXT NOT NULL,recipients JSONB NOT NULL,digest TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),attempt_at TIMESTAMPTZ,provider_id TEXT);`);
  const endpoint=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Le courriel n’a pas pu être confirmé. Réessayez avec le même document.'});}};
  const dept=async id=>{if(!/^\d+$/.test(String(id)))fail('Département invalide.');const d=(await pool.query("SELECT id,name,schedule_key FROM schedule_leave_departments WHERE id=$1 AND schedule_key IS NOT NULL AND schedule_key<>'service'",[id])).rows[0];if(!d)fail('Département introuvable.',404);return d;};
  const settings=async id=>(await pool.query('SELECT recipients,version FROM schedule_department_mail_settings WHERE department_id=$1',[id])).rows[0]||{recipients:[],version:0};
  app.get('/api/departments/:id/mail',requireManager,endpoint(async(req,res)=>{const d=await dept(req.params.id);res.set('Cache-Control','no-store').json({...await settings(d.id),configured:Boolean(process.env.RESEND_API_KEY),history:(await pool.query('SELECT id,week_start,kind,recipients,status,created_at FROM schedule_department_document_mail WHERE department_id=$1 ORDER BY created_at DESC LIMIT 10',[d.id])).rows});}));
  app.put('/api/departments/:id/mail',requireManager,sameOrigin,endpoint(async(req,res)=>{
    const d=await dept(req.params.id),list=recipients(req.body.recipients),version=req.body.version;
    if(!Number.isInteger(version)||version<0)fail('Rechargez les destinataires.',409);
    const r=await pool.query(`INSERT INTO schedule_department_mail_settings(department_id,recipients,version) SELECT $1,$2,1 WHERE $3=0
      ON CONFLICT(department_id) DO NOTHING RETURNING version`,[d.id,JSON.stringify(list),version]);
    const updated=r.rows.length?r:await pool.query('UPDATE schedule_department_mail_settings SET recipients=$2,version=version+1 WHERE department_id=$1 AND version=$3 RETURNING version',[d.id,JSON.stringify(list),version]);
    if(!updated.rows.length)fail('Les destinataires ont changé. Fermez puis rouvrez cette fenêtre.',409);
    res.json({recipients:list,version:updated.rows[0].version});
  }));
  app.post('/api/departments/document-mail/:id',requireManager,sameOrigin,endpoint(async(req,res)=>{
    const d=await dept(req.params.id),b=req.body||{};
    if(!process.env.RESEND_API_KEY)fail('L’envoi attend la configuration du service courriel sur le serveur.',503);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.requestId||''))fail('Référence d’envoi invalide.');
    if(!Object.hasOwn(labels,b.kind)||!isDate(b.weekStart)||monday(b.weekStart)!==b.weekStart)fail('Document ou semaine invalide.');
    if(typeof b.note!=='string'||b.note.length>2000)fail('Le message doit contenir au plus 2 000 caractères.');
    if(typeof b.pdf!=='string'||b.pdf.length>12*1024*1024||!/^JVBERi0[A-Za-z0-9+/]*={0,2}$/.test(b.pdf))fail('La pièce jointe doit être un PDF de moins de 9 Mo.');
    const bytes=Buffer.from(b.pdf,'base64');if(bytes.length<100||!bytes.subarray(-1024).includes(Buffer.from('%%EOF')))fail('PDF incomplet. Préparez de nouveau la pièce jointe.');
    const prefs=await settings(d.id);if(!prefs.recipients.length)fail('Enregistrez les destinataires de ce département.');
    const digest=crypto.createHash('sha256').update(JSON.stringify([String(d.id),b.weekStart,b.kind,b.note,b.pdf,b.recipientsVersion])).digest('hex');
    const existing=(await pool.query('SELECT * FROM schedule_department_document_mail WHERE id=$1',[b.requestId])).rows[0];
    if(existing&&existing.digest!==digest)fail('Cette référence correspond à un autre document. Préparez un nouvel envoi.',409);
    if(existing?.status==='sent')return res.json({ok:true,status:'sent',alreadySent:true});
    if(!existing&&prefs.version!==b.recipientsVersion)fail('Les destinataires ont changé. Fermez puis rouvrez cette fenêtre.',409);
    await pool.query('INSERT INTO schedule_department_document_mail(id,department_id,week_start,kind,recipients,digest) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[b.requestId,d.id,b.weekStart,b.kind,JSON.stringify(prefs.recipients),digest]);
    const job=(await pool.query(`UPDATE schedule_department_document_mail SET status='sending',attempt_at=clock_timestamp() WHERE id=$1 AND digest=$2 AND created_at>clock_timestamp()-interval '20 hours' AND (status IN ('pending','error') OR (status='sending' AND attempt_at<clock_timestamp()-interval '1 minute')) RETURNING *`,[b.requestId,digest])).rows[0];
    if(!job)fail('Envoi en cours ou à vérifier dans l’historique avant toute nouvelle tentative.',409);
    const payload={from:process.env.RESEND_FROM_EMAIL||process.env.RESEND_FROM||process.env.EMAIL_FROM||'Quarts Service <onboarding@resend.dev>',to:job.recipients,
      subject:`${labels[b.kind]} — ${d.name} — semaine du ${b.weekStart}`,
      text:`${labels[b.kind]} du département ${d.name}, semaine du ${b.weekStart}.\n${b.kind==='draft'?'Document de travail — non définitif.\n':''}\n${b.note}\n\nLe document PDF est joint à ce courriel.`,
      attachments:[{filename:`${b.kind}-${d.schedule_key}-${b.weekStart}.pdf`,content:b.pdf}]};
    try{
      const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`department-document-${b.requestId}`},body:JSON.stringify(payload)});
      const result=await response.json();if(!response.ok||!result.id)throw Error('provider');
      await pool.query("UPDATE schedule_department_document_mail SET status='sent',provider_id=$2 WHERE id=$1",[b.requestId,result.id]);res.json({ok:true,status:'sent'});
    }catch{
      await pool.query("UPDATE schedule_department_document_mail SET status='error' WHERE id=$1",[b.requestId]);fail('L’envoi n’est pas confirmé. Réessayez ici avec la même pièce jointe; les doublons sont protégés. Vérifiez aussi la configuration courriel si le problème persiste.',502);
    }
  }));
}

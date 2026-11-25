import {escapeHTML as escape} from './public/departments-core.js';
import {errorCode,logEvent,mailResult} from './runtime-diagnostics.js';
import {needsSchema} from './preview-schema.js';

const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const sender=()=>process.env.RESEND_FROM_EMAIL||process.env.RESEND_FROM||process.env.EMAIL_FROM||'Quarts Service <onboarding@resend.dev>';
export function normalizeFormMail(body={}){
  if(!body||typeof body!=='object'||Array.isArray(body))fail('Vérifiez les renseignements du courriel.');
  const recipient=typeof body.recipient==='string'?body.recipient.trim().toLowerCase():'';
  const name=typeof body.name==='string'?body.name.trim():'';
  if(recipient.length>254||!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(recipient))fail('Indiquez une seule adresse courriel valide.');
  if(name.length>100||/[\r\n]/.test(name))fail('Le nom doit contenir au plus 100 caractères, sur une seule ligne.');
  if(typeof body.isTest!=='boolean')fail('Choisissez le formulaire employé ou le mode test.');
  return {recipient,name,isTest:body.isTest};
}

export function formMailPayload(input,{baseUrl=process.env.PUBLIC_BASE_URL||'https://quartservice.igabenoit.com'}={}){
  const {recipient,name,isTest}=normalizeFormMail(input);
  const base=new URL(baseUrl);
  if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))throw Error('Adresse publique du formulaire invalide.');
  const url=new URL(isTest?'/conges-test':'/conges',base).href;
  const subject=`${isTest?'[TEST] ':''}Votre formulaire de demande de congé · IGA extra Famille Benoit`;
  const greeting=name?`Bonjour ${name},`:'Bonjour,';
  const access=isTest?'Connectez-vous au portail avec votre accès de gestion pour ouvrir le formulaire d’essai.':'Connectez-vous avec votre code employé : les 6 derniers chiffres de votre matricule, en conservant les zéros au début.';
  const steps=[access,'Vérifiez votre nom, votre département et votre adresse courriel.','Choisissez vos dates et, pour chaque journée, « Journée complète » ou les heures de votre absence.','Indiquez le motif, vérifiez le résumé et cliquez sur « Envoyer ma demande ».'];
  const deadline='La demande doit être reçue avant 9 h le jeudi précédant la semaine du congé (du lundi au dimanche), à l’heure du Québec. Pour plusieurs semaines, l’échéance de la première semaine s’applique.';
  const next='L’envoi de la demande ne constitue pas une approbation. Attendez la décision de votre responsable. Un accord sous conditions exige une validation finale; votre horaire reste en vigueur jusque-là.';
  const cta=isTest?'Essayer le formulaire':'Remplir ma demande de congé';
  const testNote='ESSAI — aucune demande réelle ni modification d’horaire. Les avis de suivi utilisent le destinataire de test configuré dans la gestion des congés.';
  const text=`${isTest?testNote+'\n\n':''}${greeting}\n\nVoici le formulaire à utiliser pour votre demande de congé.\n\n${cta}\n${url}\n\nCOMMENT FAIRE\n${steps.map((s,i)=>`${i+1}. ${s}`).join('\n')}\n\nDATE LIMITE : JEUDI AVANT 9 H\n${deadline}\nSi le délai est dépassé, communiquez avec votre responsable.\n\nAPRÈS L’ENVOI\n${next}\n\nRemplissez le formulaire en ligne; une réponse à ce courriel ne dépose pas de demande.\n\nIGA extra Famille Benoit · Saint-Hyacinthe`;
  const html=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f5f4;color:#26332f;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">Votre lien, les étapes et la date limite pour transmettre votre demande de congé.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#fff;border:1px solid #dce3df;border-radius:12px">
<tr><td style="padding:25px 26px;border-bottom:4px solid #b51f28"><p style="margin:0;font-size:14px;font-weight:bold;letter-spacing:1px;color:#9b1820">IGA EXTRA FAMILLE BENOIT</p><p style="margin:6px 0 0;font-size:14px;color:#5b655e">Saint-Hyacinthe · Demandes de congé</p></td></tr>
${isTest?`<tr><td style="padding:16px 26px;background:#fff0c6;font-size:14px;line-height:1.6">${testNote}</td></tr>`:''}
<tr><td style="padding:28px 26px 12px"><h1 style="margin:0 0 22px;font-size:30px;line-height:1.2">Votre demande de congé,<br>en quelques étapes.</h1><p style="font-size:16px;line-height:1.6">${escape(greeting)}</p><p style="font-size:16px;line-height:1.6">Voici le formulaire à utiliser pour transmettre votre demande à votre responsable.</p><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#b51f28" style="border-radius:7px;text-align:center"><a href="${escape(url)}" style="display:inline-block;padding:16px 22px;border:1px solid #b51f28;border-radius:7px;color:#fff;font-size:16px;line-height:1.5;font-weight:bold;text-decoration:none">${cta}</a></td></tr></table></td></tr>
<tr><td style="padding:12px 26px 24px"><h2 style="font-size:19px;margin:12px 0">Comment faire</h2><ol style="margin:0;padding-left:23px;font-size:16px;line-height:1.65">${steps.map(s=>`<li style="padding:5px 0">${escape(s)}</li>`).join('')}</ol></td></tr>
<tr><td style="padding:0 26px 24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:18px;background:#fff4df;border-left:4px solid #b47b1e"><h2 style="margin:0 0 8px;font-size:18px">Date limite : jeudi avant 9 h</h2><p style="margin:0;font-size:16px;line-height:1.6">${deadline}</p><p style="margin:12px 0 0;font-size:14px;line-height:1.6">Si le délai est dépassé, communiquez avec votre responsable.</p></td></tr></table></td></tr>
<tr><td style="padding:0 26px 24px"><h2 style="font-size:19px;margin:0 0 10px">Après l’envoi</h2><p style="margin:0;font-size:16px;line-height:1.6">${next}</p><p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#5b655e">Remplissez le formulaire en ligne; une réponse à ce courriel ne dépose pas de demande.</p></td></tr>
<tr><td style="padding:20px 26px;background:#f6f8f6;border-top:1px solid #dce3df"><p style="margin:0;font-size:14px;line-height:1.6;color:#5b655e">Si le bouton ne fonctionne pas, ouvrez ce lien :<br><a href="${escape(url)}" style="color:#9b1820;word-break:break-all">${escape(url)}</a></p><p style="margin:16px 0 0;font-size:14px;color:#5b655e">IGA extra Famille Benoit · Saint-Hyacinthe</p></td></tr>
</table></td></tr></table></body></html>`;
  return {from:sender(),to:[recipient],subject,text,html};
}

// Explicit sends only: no automatic campaign, and retries reuse the frozen payload.
export const formMailSchema=`CREATE TABLE IF NOT EXISTS schedule_leave_form_mail (
    submission_key UUID PRIMARY KEY,actor TEXT NOT NULL,input JSONB NOT NULL,payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','error','review')),created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    first_attempt_at TIMESTAMPTZ,last_attempt_at TIMESTAMPTZ,sent_at TIMESTAMPTZ,provider_id TEXT
  );
  ALTER TABLE schedule_leave_form_mail ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON schedule_leave_form_mail FROM PUBLIC;`;
export async function installFormMail(app,pool,{requireManager,sameOrigin,fetchImpl=fetch}){
  if(needsSchema(pool))await pool.query(formMailSchema);
  const endpoint=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(e){
    if(!e.status)logEvent('form_mail_failed',{component:'leave_form',code:errorCode(e)},'error');
    res.status(e.status||500).json({error:e.status?e.message:'Envoi non confirmé. Réessayez avec le même formulaire pour vérifier sans doublon.'});
  }};
  app.get('/api/leave/form-email/preview',requireManager,endpoint(async(req,res)=>{
    const payload=formMailPayload({recipient:'preview@example.invalid',name:'',isTest:req.query.test==='true'});
    res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox");
    res.set('X-Frame-Options','SAMEORIGIN');
    res.type('html').send(payload.html);
  }));
  app.post('/api/leave/form-email',requireManager,sameOrigin,endpoint(async(req,res)=>{
    const input=normalizeFormMail(req.body),key=req.body.submissionKey;
    if(typeof key!=='string'||!/^\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b$/i.test(key))fail('Référence d’envoi invalide. Actualisez la page.');
    const actor=`${req.manager.kind}:${req.manager.personId||req.manager.id||'direction'}`;
    await pool.query(`INSERT INTO schedule_leave_form_mail(submission_key,actor,input,payload) VALUES($1,$2,$3::jsonb,$4::jsonb) ON CONFLICT DO NOTHING`,[key,actor,JSON.stringify(input),JSON.stringify(formMailPayload(input))]);
    let row=(await pool.query('SELECT * FROM schedule_leave_form_mail WHERE submission_key=$1',[key])).rows[0];
    if(row.actor!==actor||Object.keys(input).some(k=>input[k]!==row.input[k]))fail('Cette référence correspond à un autre envoi. Préparez un nouveau courriel.',409);
    const receipt=r=>({status:'sent',recipient:r.input.recipient,isTest:r.input.isTest,sentAt:r.sent_at,reference:r.submission_key});
    if(row.status==='sent')return res.json(receipt(row));
    await pool.query(`UPDATE schedule_leave_form_mail SET status='review' WHERE submission_key=$1 AND first_attempt_at<clock_timestamp()-interval '20 hours'`,[key]);
    row=(await pool.query('SELECT * FROM schedule_leave_form_mail WHERE submission_key=$1',[key])).rows[0];
    if(row.status==='review')fail('Cet envoi reste à vérifier dans Resend avant toute relance. Aucun nouveau courriel n’a été envoyé.',409);
    if(!process.env.RESEND_API_KEY)fail('Le service de courriel n’est pas configuré. Communiquez avec l’administration.',503);
    const claimed=await pool.query(`UPDATE schedule_leave_form_mail SET status='sending',first_attempt_at=COALESCE(first_attempt_at,clock_timestamp()),last_attempt_at=clock_timestamp()
      WHERE submission_key=$1 AND (status IN ('pending','error') OR (status='sending' AND last_attempt_at<clock_timestamp()-interval '30 seconds')) RETURNING payload`,[key]);
    if(!claimed.rows.length)fail('L’envoi est encore en cours. Attendez quelques secondes, puis vérifiez avec le même bouton.',409);
    try{
      const result=await fetchImpl('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`leave-form-${key}`},body:JSON.stringify(claimed.rows[0].payload)});
      const data=await result.json();mailResult('leave_form',key,result,data);
      if(!result.ok||typeof data.id!=='string'||!data.id)throw Error('Provider did not confirm acceptance');
      row=(await pool.query(`UPDATE schedule_leave_form_mail SET status='sent',provider_id=$2,sent_at=clock_timestamp() WHERE submission_key=$1 RETURNING *`,[key,data.id])).rows[0];
      res.json(receipt(row));
    }catch(e){
      await pool.query(`UPDATE schedule_leave_form_mail SET status='error' WHERE submission_key=$1 AND status='sending'`,[key]);
      logEvent('mail_attempt_failed',{component:'leave_form',jobId:key,code:errorCode(e)},'error');
      fail('Envoi non confirmé. Vérifiez ou réessayez avec ce même formulaire : la reprise évite les doublons.',502);
    }
  }));
}

import {normalizeEmail} from './employee-contacts.js';
import {deadlineForDate} from './public/leave-calendar.js';

const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const date=value=>new Intl.DateTimeFormat('fr-CA',{dateStyle:'full',timeZone:'UTC'}).format(new Date(String(value).slice(0,10)+'T12:00:00Z'));
const stamp=value=>new Intl.DateTimeFormat('fr-CA',{dateStyle:'full',timeStyle:'short',timeZone:'America/Toronto'}).format(new Date(value));
const time=value=>String(Math.floor(value/60)).padStart(2,'0')+' h '+String(value%60).padStart(2,'0');
const rule='Toute demande doit être reçue avant 9 h le jeudi précédant la semaine du congé (du lundi au dimanche), à l’heure du Québec.';

export function employeeNoticePayload(job,{testRecipient='',from='Quarts Service <onboarding@resend.dev>'}={}){
  const s=job.snapshot,late=job.kind==='late';
  if(!['late','refused'].includes(job.kind))throw new Error('Type d’avis invalide.');
  const to=normalizeEmail(s.is_test?testRecipient:s.email);
  if(!to)throw new Error(s.is_test?'Destinataire de test à configurer.':'Courriel de la demande invalide.');
  if(!late&&!String(s.decision_note||'').trim())throw new Error('La raison du refus est manquante.');
  const reply=s.is_test?'':normalizeEmail(s.recipient),deadline=date(deadlineForDate(s.periods[0].date));
  const periods=s.periods.map(p=>`${date(p.date)} — ${p.allDay?'journée complète':time(p.startMinute)+' à '+time(p.endMinute)}`);
  const title=late?'Votre demande est hors délai.':'Votre demande est refusée.';
  const eyebrow=late?'DÉLAI DÉPASSÉ':'DÉCISION DE LA GESTION';
  const subject=`${s.is_test?'[TEST] ':''}${late?'[HORS DÉLAI] Demande de congé — échéance dépassée':'[REFUS] Demande de congé — décision et raison'} · n° ${job.request_id}`;
  const intro=late?'Votre demande de congé a été reçue après la date limite. Pour les prochaines demandes, merci de respecter l’échéance ci-dessous.':'Après examen, votre demande de congé a été refusée. Voici la raison communiquée par votre gestionnaire.';
  const education='Ce délai permet de préparer l’horaire et d’organiser les remplacements. Une demande envoyée après l’échéance complique cette planification.';
  const next=late?'Veuillez vous adresser à votre gérante pour cette demande. Cet avis signale le retard de dépôt; il ne constitue pas une décision d’approbation ou de refus.':'Ce courriel confirme le refus des périodes indiquées. Pour toute question sur cette décision, communiquez avec votre responsable.';
  const footer='Un dépôt de demande ne constitue pas une autorisation de congé. Attendez la confirmation de votre responsable.';
  const text=[s.is_test?'ESSAI — aucun congé réel ni changement d’horaire.\n':'',`Bonjour ${s.employee_name},`,title,intro,
    late?`DATE LIMITE À RESPECTER\n${deadline}, avant 9 h (Québec)\n\nDEMANDE REÇUE\n${stamp(s.submitted_at)} (Québec)`:`RAISON DU REFUS\n${s.decision_note}`,
    `PÉRIODES DEMANDÉES\n${periods.join('\n')}`,`Département : ${s.department_name}\nRéférence : ${job.request_id}`,
    late?`POUR VOS PROCHAINES DEMANDES\n${rule}\n\n${education}`:s.was_late?`Cette demande a aussi été déposée hors délai.\nÉchéance : ${deadline}, avant 9 h (Québec).\n${rule}`:'',next,footer,'IGA extra Famille Benoit'].filter(Boolean).join('\n\n');
  const latePanel=`<tr><td style="padding:24px;background:#fff0ed;border-left:6px solid #ba1827"><p style="margin:0 0 10px;font-size:12px;letter-spacing:1px;font-weight:bold;color:#961322">DATE LIMITE À RESPECTER</p><p style="margin:0;font-size:23px;line-height:1.35;font-weight:bold;color:#8f1420">${escape(deadline)}<br>avant 9 h</p><p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#403e3d"><strong>Votre demande a été reçue :</strong><br>${escape(stamp(s.submitted_at))}<br><span style="color:#68605d">Heure du Québec</span></p></td></tr>`;
  const refusalPanel=`<tr><td style="padding:24px;background:#fff0ed;border-left:6px solid #ba1827"><h2 style="margin:0 0 12px;font-size:14px;letter-spacing:.6px;color:#961322">RAISON DU REFUS</h2><p style="margin:0;font-size:19px;line-height:1.55;color:#352324;overflow-wrap:anywhere">${escape(s.decision_note).replaceAll('\n','<br>')}</p></td></tr>`;
  const html=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;padding:0;background:#f2f0ed;font-family:Arial,Helvetica,sans-serif;color:#292727"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escape(late?'Échéance dépassée : '+deadline+', avant 9 h. Consultez la règle pour vos prochaines demandes.':'Consultez la raison du refus et les périodes concernées.')}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f0ed"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e5dfdb">
<tr><td style="padding:21px 24px;border-top:7px solid #ba1827"><p style="margin:0;color:#8f1420;font-size:14px;font-weight:bold;letter-spacing:1px">IGA EXTRA FAMILLE BENOIT</p><p style="margin:6px 0 0;color:#766f6b;font-size:12px">QUARTS SERVICE · DEMANDES DE CONGÉ</p></td></tr>
${s.is_test?'<tr><td style="padding:12px 24px;background:#fff0bf;font-weight:bold">ESSAI — aucun congé réel ni changement d’horaire.</td></tr>':''}
<tr><td style="padding:28px 24px;background:#a71625;color:#ffffff"><p style="margin:0 0 13px;font-size:12px;font-weight:bold;letter-spacing:1.5px">${eyebrow}</p><h1 style="margin:0;font-size:34px;line-height:1.15;letter-spacing:-.5px;color:#ffffff">${title}</h1></td></tr>
<tr><td style="padding:26px 24px 22px"><p style="margin:0 0 14px;font-size:16px;line-height:1.6">Bonjour ${escape(s.employee_name)},</p><p style="margin:0;font-size:16px;line-height:1.65">${intro}</p></td></tr>
${late?latePanel:refusalPanel}
<tr><td style="padding:24px"><h2 style="margin:0 0 14px;font-size:12px;letter-spacing:1px;color:#76655d">PÉRIODES DEMANDÉES</h2><p style="margin:0;font-size:15px;line-height:1.8">${periods.map(escape).join('<br>')}</p><p style="margin:16px 0 0;padding-top:14px;border-top:1px solid #e7e0dc;font-size:13px;color:#6c625b;line-height:1.7">Département : ${escape(s.department_name)}<br>Référence : ${escape(job.request_id)}</p></td></tr>
${late?`<tr><td style="padding:24px;background:#f7f5f2;border-top:1px solid #e7e0dc"><h2 style="margin:0 0 14px;font-size:19px;color:#302b28">Pour vos prochaines demandes</h2><p style="margin:0 0 14px;font-size:20px;line-height:1.45;font-weight:bold;color:#961322">Avant 9 h le jeudi<br>précédant la semaine du congé.</p><p style="margin:0 0 12px;font-size:14px;line-height:1.65">La semaine du congé va du lundi au dimanche. Heure du Québec.</p><p style="margin:0;font-size:14px;line-height:1.65">${education}</p></td></tr>`:s.was_late?`<tr><td style="padding:20px 24px;background:#fff0ed;color:#8f1420;font-size:14px;line-height:1.65"><strong>Cette demande a aussi été déposée hors délai.</strong><br>Échéance : ${escape(deadline)}, avant 9 h (Québec).<br>${rule}</td></tr>`:''}
<tr><td style="padding:24px"><p style="margin:0 0 16px;font-size:15px;line-height:1.65">${next}</p>${reply?`<p style="margin:0 0 18px"><a href="mailto:${escape(encodeURIComponent(reply))}?subject=${escape(encodeURIComponent('Demande de congé n° '+job.request_id))}" style="display:inline-block;padding:13px 18px;background:#302b28;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;border-radius:4px">Communiquer avec mon responsable</a></p>`:''}<p style="margin:0;border-top:1px solid #e7e0dc;padding-top:18px;font-size:13px;line-height:1.65;color:#625a55"><strong>${footer}</strong></p></td></tr>
<tr><td style="padding:17px 24px;background:#302b28;color:#ffffff;font-size:12px;line-height:1.6">IGA extra Famille Benoit<br>Message automatique de suivi des demandes de congé.</td></tr></table></td></tr></table></body></html>`;
  return {from,to:[to],...(reply?{reply_to:reply}:{}),subject,text,html};
}

export async function installEmployeeNoticeSchema(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_leave_employee_notices (
    id BIGSERIAL PRIMARY KEY,request_id BIGINT NOT NULL REFERENCES schedule_leave_requests(id),request_version INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('late','refused')),snapshot JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',payload JSONB,attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp()+interval '15 seconds'),
    first_attempt_at TIMESTAMPTZ,last_attempt_at TIMESTAMPTZ,provider_id TEXT,error TEXT NOT NULL DEFAULT '',
    UNIQUE(request_id,kind,request_version)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS schedule_leave_one_late_notice ON schedule_leave_employee_notices(request_id) WHERE kind='late';`);
}

export async function queueEmployeeNotice(client,id,kind){
  if(!['late','refused'].includes(kind))throw new Error('Type d’avis invalide.');
  const row=(await client.query(`SELECT r.id,r.version,r.status,r.archived_at,r.employee_name,r.email,r.is_test,r.periods,r.submitted_at,r.department_name,r.decision_note,d.recipient,
    EXISTS(SELECT 1 FROM schedule_leave_events e WHERE e.request_id=r.id AND e.status='late') AS was_late
    FROM schedule_leave_requests r LEFT JOIN schedule_leave_departments d ON d.id=r.department_id WHERE r.id=$1`,[id])).rows[0];
  if(!row||row.status!==kind||row.archived_at)return false;
  const snapshot={employee_name:row.employee_name,email:row.email,is_test:row.is_test,periods:row.periods,submitted_at:row.submitted_at,department_name:row.department_name,recipient:row.recipient,was_late:row.was_late,decision_note:kind==='refused'?row.decision_note:''};
  const result=await client.query(`INSERT INTO schedule_leave_employee_notices(request_id,request_version,kind,snapshot) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING id`,[id,row.version,kind,JSON.stringify(snapshot)]);
  return result.rows.length>0;
}

// No historical backfill. Late notices state a submission fact; refusal notices follow the decision version.
export async function installEmployeeNotices(pool,{autoStart=true,fetchImpl=fetch}={}){
  await installEmployeeNoticeSchema(pool);
  let running=false;
  async function run(){
    if(running||!process.env.RESEND_API_KEY)return;
    running=true;
    try{
      await pool.query(`UPDATE schedule_leave_employee_notices m SET status='cancelled',error='Demande archivée ou décision modifiée avant confirmation de l’envoi.'
        FROM schedule_leave_requests r WHERE r.id=m.request_id AND m.status IN ('pending','sending','error')
        AND (r.archived_at IS NOT NULL OR (m.kind='refused' AND (r.status<>'refused' OR r.version<>m.request_version)))`);
      await pool.query(`UPDATE schedule_leave_employee_notices SET status='review',error='Envoi à vérifier dans Resend avant toute relance.'
        WHERE status IN ('pending','sending','error') AND first_attempt_at<clock_timestamp()-interval '20 hours'`);
      const jobs=(await pool.query(`SELECT id FROM schedule_leave_employee_notices WHERE available_at<=clock_timestamp() AND
        ((status IN ('pending','error') AND (last_attempt_at IS NULL OR last_attempt_at<clock_timestamp()-interval '1 minute'))
        OR (status='sending' AND last_attempt_at<clock_timestamp()-interval '2 minutes')) ORDER BY id LIMIT 10`)).rows;
      const settings=(await pool.query('SELECT test_recipient FROM schedule_leave_mail_settings WHERE id=1')).rows[0]||{};
      for(const job of jobs){
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          const row=(await client.query(`SELECT m.*,r.status AS request_status,r.version,r.archived_at FROM schedule_leave_employee_notices m
            JOIN schedule_leave_requests r ON r.id=m.request_id WHERE m.id=$1 AND
            ((m.status IN ('pending','error') AND (m.last_attempt_at IS NULL OR m.last_attempt_at<clock_timestamp()-interval '1 minute'))
            OR (m.status='sending' AND m.last_attempt_at<clock_timestamp()-interval '2 minutes')) FOR UPDATE OF r,m SKIP LOCKED`,[job.id])).rows[0];
          if(!row){await client.query('ROLLBACK');continue;}
          const obsolete=r=>!r||r.archived_at||(row.kind==='refused'&&(r.status!=='refused'||r.version!==row.request_version));
          if(obsolete({status:row.request_status,version:row.version,archived_at:row.archived_at})){
            await client.query("UPDATE schedule_leave_employee_notices SET status='cancelled' WHERE id=$1",[job.id]);await client.query('COMMIT');continue;
          }
          let payload=row.payload;
          if(!payload){
            try{payload=employeeNoticePayload(row,{testRecipient:settings.test_recipient||process.env.LEAVE_TEST_NOTIFY_EMAIL,
              from:process.env.RESEND_FROM_EMAIL||process.env.RESEND_FROM||process.env.EMAIL_FROM||'Quarts Service <onboarding@resend.dev>'});}
            catch(error){await client.query("UPDATE schedule_leave_employee_notices SET status='review',error=$2 WHERE id=$1",[job.id,error.message]);await client.query('COMMIT');continue;}
          }
          await client.query(`UPDATE schedule_leave_employee_notices SET status='sending',payload=$2::jsonb,attempts=attempts+1,
            first_attempt_at=COALESCE(first_attempt_at,clock_timestamp()),last_attempt_at=clock_timestamp() WHERE id=$1`,[job.id,JSON.stringify(payload)]);
          await client.query('COMMIT');
          await client.query('BEGIN');
          const current=(await client.query('SELECT status,version,archived_at FROM schedule_leave_requests WHERE id=$1 FOR UPDATE',[row.request_id])).rows[0];
          if(obsolete(current)){await client.query("UPDATE schedule_leave_employee_notices SET status='cancelled' WHERE id=$1",[job.id]);await client.query('COMMIT');continue;}
          try{
            const result=await fetchImpl('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),
              headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`quarts-leave-notice-${row.kind}-${row.request_id}-v${row.request_version}`},body:JSON.stringify(payload)});
            const data=await result.json();if(!result.ok||!data.id)throw new Error(`Resend HTTP ${result.status}. Vérifiez la clé et l’expéditeur dans Render/Resend.`);
            await client.query("UPDATE schedule_leave_employee_notices SET status='sent',provider_id=$2,error='' WHERE id=$1",[job.id,data.id]);
          }catch(error){await client.query("UPDATE schedule_leave_employee_notices SET status='error',error=$2 WHERE id=$1",[job.id,error.message.startsWith('Resend HTTP')?error.message:'Envoi non confirmé. Nouvelle tentative prévue.']);}
          await client.query('COMMIT');
        }catch{await client.query('ROLLBACK').catch(()=>{});}finally{client.release();}
      }
    }finally{running=false;}
  }
  if(autoStart){const timer=setInterval(()=>run().catch(()=>{}),30000);timer.unref();run().catch(()=>{});}
  return {run,queue:queueEmployeeNotice};
}

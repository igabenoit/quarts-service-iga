import {normalizeEmail} from './employee-contacts.js';

export async function installApprovalMailSchema(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_leave_approval_mail (
    id BIGSERIAL PRIMARY KEY,request_id BIGINT NOT NULL REFERENCES schedule_leave_requests(id),request_version INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',payload JSONB,attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp()+interval '15 seconds'),
    first_attempt_at TIMESTAMPTZ,last_attempt_at TIMESTAMPTZ,provider_id TEXT,error TEXT NOT NULL DEFAULT '',
    UNIQUE(request_id,request_version)
  );`);
}
export async function queueApprovalMail(client,id){
  await client.query(`INSERT INTO schedule_leave_approval_mail(request_id,request_version)
    SELECT id,version FROM schedule_leave_requests WHERE id=$1 AND status='approved' AND archived_at IS NULL ON CONFLICT DO NOTHING`,[id]);
}
export function approvalPayload(job,{testRecipient='',from='Quarts Service <onboarding@resend.dev>'}={}){
  const to=normalizeEmail(job.is_test?testRecipient:job.email);
  if(!to)throw new Error(job.is_test?'Destinataire de test à configurer.':'Courriel de la demande invalide. Vérifiez l’adresse avant tout envoi.');
  const date=d=>new Intl.DateTimeFormat('fr-CA',{dateStyle:'long',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'));
  const time=m=>String(Math.floor(m/60)).padStart(2,'0')+' h '+String(m%60).padStart(2,'0');
  const periods=(job.effective_periods??job.periods).map(p=>`${date(p.date)} : ${p.allDay?'journée complète':time(p.startMinute)+' à '+time(p.endMinute)}`).join('\n');
  const partial=job.effective_periods&&JSON.stringify(job.effective_periods)!==JSON.stringify(job.periods);
  return {from,to:[to],...(!job.is_test&&normalizeEmail(job.recipient)?{reply_to:normalizeEmail(job.recipient)}:{}),
    subject:`${job.is_test?'[TEST] ':''}Congé approuvé — demande n° ${job.request_id}`,
    text:`${job.is_test?'ESSAI — aucun congé réel ni changement d’horaire.\n\n':''}Bonjour ${job.employee_name},\n\nVotre demande de congé a été approuvée.\n\n${partial?'PÉRIODES AJOUTÉES PAR CETTE APPROBATION':'DATES ET HEURES APPROUVÉES'}\n${periods}\n${partial?'\nLes périodes déjà approuvées restent rattachées à votre demande précédente.\n':''}\nDépartement : ${job.department_name}\nRéférence : ${job.request_id}\n\nPour toute question, communiquez avec votre responsable.\n\nIGA extra Famille Benoit`};
}

// Approvals are queued only at decision time. Historical approvals are never backfilled.
export async function installApprovalMail(pool,{autoStart=true,fetchImpl=fetch}={}){
  await installApprovalMailSchema(pool);
  let running=false;
  async function run(){
    if(running||!process.env.RESEND_API_KEY)return;
    running=true;
    try{
      await pool.query(`UPDATE schedule_leave_approval_mail m SET status='cancelled',error='Approbation modifiée ou annulée avant confirmation de l’envoi.'
        FROM schedule_leave_requests r WHERE r.id=m.request_id AND m.status IN ('pending','sending','error')
        AND (r.status<>'approved' OR r.version<>m.request_version OR r.archived_at IS NOT NULL)`);
      await pool.query(`UPDATE schedule_leave_approval_mail SET status='review',error='Envoi à vérifier dans Resend avant toute relance.'
        WHERE status IN ('pending','sending','error') AND first_attempt_at<clock_timestamp()-interval '20 hours'`);
      const jobs=(await pool.query(`SELECT id FROM schedule_leave_approval_mail WHERE available_at<=clock_timestamp() AND
        ((status IN ('pending','error') AND (last_attempt_at IS NULL OR last_attempt_at<clock_timestamp()-interval '1 minute'))
        OR (status='sending' AND last_attempt_at<clock_timestamp()-interval '2 minutes')) ORDER BY id LIMIT 10`)).rows;
      const settings=(await pool.query('SELECT test_recipient FROM schedule_leave_mail_settings WHERE id=1')).rows[0]||{};
      for(const job of jobs){
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          const row=(await client.query(`SELECT m.*,r.status AS request_status,r.version,r.archived_at,r.is_test,r.employee_name,r.email,r.periods,r.effective_periods,r.department_name,d.recipient
            FROM schedule_leave_approval_mail m JOIN schedule_leave_requests r ON r.id=m.request_id
            LEFT JOIN schedule_leave_departments d ON d.id=r.department_id WHERE m.id=$1 AND
            ((m.status IN ('pending','error') AND (m.last_attempt_at IS NULL OR m.last_attempt_at<clock_timestamp()-interval '1 minute'))
            OR (m.status='sending' AND m.last_attempt_at<clock_timestamp()-interval '2 minutes')) FOR UPDATE OF r,m SKIP LOCKED`,[job.id])).rows[0];
          if(!row){await client.query('ROLLBACK');continue;}
          if(row.request_status!=='approved'||row.version!==row.request_version||row.archived_at){
            await client.query("UPDATE schedule_leave_approval_mail SET status='cancelled' WHERE id=$1",[job.id]);await client.query('COMMIT');continue;
          }
          let payload=row.payload;
          if(!payload){
            try{payload=approvalPayload(row,{testRecipient:settings.test_recipient||process.env.LEAVE_TEST_NOTIFY_EMAIL,
              from:process.env.RESEND_FROM_EMAIL||process.env.RESEND_FROM||process.env.EMAIL_FROM||'Quarts Service <onboarding@resend.dev>'});}
            catch(error){await client.query("UPDATE schedule_leave_approval_mail SET status='review',error=$2 WHERE id=$1",[job.id,error.message]);await client.query('COMMIT');continue;}
          }
          // Commit the frozen payload and retry clock before attempting an external send.
          await client.query(`UPDATE schedule_leave_approval_mail SET status='sending',payload=$2::jsonb,attempts=attempts+1,
            first_attempt_at=COALESCE(first_attempt_at,clock_timestamp()),last_attempt_at=clock_timestamp() WHERE id=$1`,[job.id,JSON.stringify(payload)]);
          await client.query('COMMIT');
          await client.query('BEGIN');
          const current=(await client.query('SELECT status,version,archived_at FROM schedule_leave_requests WHERE id=$1 FOR UPDATE',[row.request_id])).rows[0];
          if(current?.status!=='approved'||current.version!==row.request_version||current.archived_at){
            await client.query("UPDATE schedule_leave_approval_mail SET status='cancelled' WHERE id=$1",[job.id]);await client.query('COMMIT');continue;
          }
          // The request lock prevents a concurrent undo from overtaking the send.
          try{
            const result=await fetchImpl('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),
              headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`quarts-leave-approval-${row.request_id}-v${row.request_version}`},body:JSON.stringify(payload)});
            const data=await result.json();
            if(!result.ok||!data.id)throw new Error(`Resend HTTP ${result.status}. Vérifiez la clé et l’expéditeur dans Render/Resend.`);
            await client.query("UPDATE schedule_leave_approval_mail SET status='sent',provider_id=$2,error='' WHERE id=$1",[job.id,data.id]);
          }catch(error){
            await client.query("UPDATE schedule_leave_approval_mail SET status='error',error=$2 WHERE id=$1",[job.id,error.message.startsWith('Resend HTTP')?error.message:'Envoi non confirmé. Nouvelle tentative prévue.']);
          }
          await client.query('COMMIT');
        }catch{await client.query('ROLLBACK').catch(()=>{});}
        finally{client.release();}
      }
    }finally{running=false;}
  }
  if(autoStart){const timer=setInterval(()=>run().catch(()=>{}),30000);timer.unref();run().catch(()=>{});}
  return {run,queue:queueApprovalMail};
}

import {normalizeEmail} from './employee-contacts.js';
const days=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const time=n=>`${Math.floor(n/60)} h ${String(n%60).padStart(2,'0')}`;
export function availabilityMailPayload(row,settings){
  const approval=row.kind==='approved',to=normalizeEmail(row.is_test?settings.test_recipient:approval?row.email:row.recipient);
  if(!to)throw new Error('Destinataire à configurer.');
  const copy=!row.is_test&&!approval?normalizeEmail(settings.copy_recipient):'';
  const reply=normalizeEmail(approval?row.recipient:row.email);
  const grid=days.map((day,d)=>`${day} : ${row.availability[d]?.length?row.availability[d].map(([a,b])=>`${time(a)} à ${time(b)}`).join(', '):'Indisponible'}`).join('\n');
  return {from:process.env.RESEND_FROM_EMAIL||process.env.RESEND_FROM||process.env.EMAIL_FROM||'Quarts Service <onboarding@resend.dev>',to:[to],
    ...(copy&&copy!==to?{cc:[copy]}:{}),...(!row.is_test&&reply?{reply_to:reply}:{}),
    subject:`${row.is_test?'[TEST] ':''}Disponibilités ${approval?'approuvées':'à approuver'} — ${row.employee_name}`,
    text:`${row.is_test?'TEST — aucun changement réel.\n\n':''}Bonjour${approval?' '+row.employee_name:''},\n\n${approval?'Votre nouvelle disponibilité permanente est approuvée.':'Une nouvelle demande de disponibilité permanente a été reçue. Consultez son état dans le suivi.'}\n\nEmployé : ${row.employee_name}\nDate effective : ${String(row.effective_date).slice(0,10)}\nHeures souhaitées par semaine : ${row.target_minutes/60} h\n\n${grid}\n\nCes disponibilités se répètent chaque semaine et doivent être maintenues au moins 4 semaines.${approval?'':'\n\nCommentaires : '+(row.comments||'Aucun')+'\n\nSuivi gestionnaire : https://quarts-service-iga.onrender.com/disponibilites-gestion'}\n\nRéférence : ${row.request_id}\nIGA extra Famille Benoit`};
}
export async function installAvailabilityMail(pool,{autoStart=true,fetchImpl=fetch}={}){
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_availability_mail (
    id BIGSERIAL PRIMARY KEY,request_id BIGINT NOT NULL REFERENCES schedule_availability_requests(id),kind TEXT NOT NULL,
    request_version INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',payload JSONB,attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp()+interval '15 seconds'),first_attempt_at TIMESTAMPTZ,last_attempt_at TIMESTAMPTZ,provider_id TEXT,error TEXT NOT NULL DEFAULT '',UNIQUE(request_id,kind,request_version));`);
  const queue=async(client,id,kind)=>client.query(`INSERT INTO schedule_availability_mail(request_id,kind,request_version) SELECT id,$2,version FROM schedule_availability_requests WHERE id=$1 ON CONFLICT DO NOTHING`,[id,kind]);
  let running=false;
  async function run(){
    if(running||!process.env.RESEND_API_KEY)return;running=true;
    try{
      await pool.query(`UPDATE schedule_availability_mail m SET status='cancelled',error='Décision modifiée avant l’envoi.' FROM schedule_availability_requests r
        WHERE m.request_id=r.id AND m.kind='approved' AND m.status IN ('pending','sending','error') AND (r.status<>'approved' OR r.version<>m.request_version)`);
      await pool.query(`UPDATE schedule_availability_mail SET status='review',error='À vérifier dans Resend avant toute relance.' WHERE status IN ('pending','sending','error') AND first_attempt_at<clock_timestamp()-interval '20 hours'`);
      const settings=(await pool.query('SELECT * FROM schedule_leave_mail_settings WHERE id=1')).rows[0]||{};
      settings.test_recipient||=process.env.LEAVE_TEST_NOTIFY_EMAIL;
      const jobs=(await pool.query(`SELECT id FROM schedule_availability_mail WHERE available_at<=clock_timestamp() AND ((status IN ('pending','error') AND (last_attempt_at IS NULL OR last_attempt_at<clock_timestamp()-interval '1 minute')) OR (status='sending' AND last_attempt_at<clock_timestamp()-interval '2 minutes')) ORDER BY id LIMIT 10`)).rows;
      for(const job of jobs){const client=await pool.connect();try{
        await client.query('BEGIN');
        const r=(await client.query(`SELECT m.*,r.status AS request_status,r.version,r.is_test,r.employee_name,r.email,r.effective_date::text,r.target_minutes,r.availability,r.comments,d.recipient,d.mail_enabled FROM schedule_availability_mail m JOIN schedule_availability_requests r ON r.id=m.request_id LEFT JOIN schedule_leave_departments d ON d.code='service' WHERE m.id=$1 AND ((m.status IN ('pending','error') AND (m.last_attempt_at IS NULL OR m.last_attempt_at<clock_timestamp()-interval '1 minute')) OR (m.status='sending' AND m.last_attempt_at<clock_timestamp()-interval '2 minutes')) FOR UPDATE OF r,m SKIP LOCKED`,[job.id])).rows[0];
        if(!r){await client.query('ROLLBACK');continue;}
        if(r.kind==='approved'&&(r.request_status!=='approved'||r.version!==r.request_version)){await client.query("UPDATE schedule_availability_mail SET status='cancelled' WHERE id=$1",[job.id]);await client.query('COMMIT');continue;}
        if(r.kind==='submitted'&&!r.is_test&&(!r.mail_enabled||!normalizeEmail(r.recipient))){await client.query('ROLLBACK');continue;}
        let payload=r.payload;
        if(!payload){try{payload=availabilityMailPayload(r,settings);}catch(error){await client.query("UPDATE schedule_availability_mail SET status='review',error=$2 WHERE id=$1",[job.id,error.message]);await client.query('COMMIT');continue;}}
        const frozen=(await client.query(`UPDATE schedule_availability_mail SET status='sending',payload=$2::jsonb,attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,clock_timestamp()),last_attempt_at=clock_timestamp() WHERE id=$1 RETURNING payload`,[job.id,JSON.stringify(payload)])).rows[0].payload;
        await client.query('COMMIT');await client.query('BEGIN');
        const current=(await client.query('SELECT status,version FROM schedule_availability_requests WHERE id=$1 FOR UPDATE',[r.request_id])).rows[0];
        if(r.kind==='approved'&&(current.status!=='approved'||current.version!==r.request_version)){await client.query("UPDATE schedule_availability_mail SET status='cancelled' WHERE id=$1",[job.id]);await client.query('COMMIT');continue;}
        try{
          const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`quarts-availability-${r.request_id}-${r.kind}-v${r.request_version}`},body:JSON.stringify(frozen)}),data=await response.json();
          if(!response.ok||!data.id)throw new Error('Resend HTTP '+response.status);
          await client.query("UPDATE schedule_availability_mail SET status='sent',provider_id=$2,error='' WHERE id=$1",[job.id,data.id]);
        }catch(error){await client.query("UPDATE schedule_availability_mail SET status='error',error=$2 WHERE id=$1",[job.id,error.message.startsWith('Resend HTTP')?error.message:'Envoi non confirmé. Nouvelle tentative prévue.']);}
        await client.query('COMMIT');
      }catch{await client.query('ROLLBACK').catch(()=>{});}finally{client.release();}}
    }finally{running=false;}
  }
  if(autoStart){const timer=setInterval(()=>run().catch(()=>{}),30000);timer.unref();run().catch(()=>{});}
  return {run,queue};
}

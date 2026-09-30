// Department recipients and copies are kept in the private database. Tests never use department recipients.
export async function installNotifications(app,pool,{requireManager,sameOrigin}) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_leave_mail_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), test_recipient TEXT NOT NULL DEFAULT ''
  );
  ALTER TABLE schedule_leave_mail_settings ADD COLUMN IF NOT EXISTS copy_recipient TEXT NOT NULL DEFAULT '';
  INSERT INTO schedule_leave_mail_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
  CREATE TABLE IF NOT EXISTS schedule_leave_mail (
    request_id BIGINT PRIMARY KEY REFERENCES schedule_leave_requests(id),
    status TEXT NOT NULL DEFAULT 'pending', payload JSONB, attempts INTEGER NOT NULL DEFAULT 0,
    first_attempt_at TIMESTAMPTZ, last_attempt_at TIMESTAMPTZ, provider_id TEXT, error TEXT NOT NULL DEFAULT ''
  );`);
  const configured=()=>Boolean(process.env.RESEND_API_KEY);
  const recipient=async()=> (await pool.query('SELECT test_recipient FROM schedule_leave_mail_settings WHERE id=1')).rows[0].test_recipient || process.env.LEAVE_TEST_NOTIFY_EMAIL || '';
  app.get('/api/leave/notifications',requireManager,async(_req,res)=>{
    res.set('Cache-Control','no-store').json({recipient:await recipient(),copyRecipient:(await pool.query('SELECT copy_recipient FROM schedule_leave_mail_settings WHERE id=1')).rows[0].copy_recipient,configured:configured(),testOnly:false});
  });
  app.put('/api/leave/notifications',requireManager,sameOrigin,async(req,res)=>{
    const email=typeof req.body?.recipient==='string'?req.body.recipient.trim():'';
    if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Adresse courriel invalide.'});
    const copy=req.body?.copyRecipient;
    if(copy!==undefined&&(typeof copy!=='string'||copy.length>254||(copy.trim()&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(copy.trim()))))return res.status(400).json({error:'Adresse de copie invalide.'});
    await pool.query('UPDATE schedule_leave_mail_settings SET test_recipient=$1,copy_recipient=COALESCE($2,copy_recipient) WHERE id=1',[email,copy===undefined?null:copy.trim()]);
    res.json({ok:true,configured:configured()});
    run().catch(()=>{});
  });
  async function queue(client,id) {
    await client.query(`INSERT INTO schedule_leave_mail (request_id) VALUES ($1) ON CONFLICT DO NOTHING`,[id]);
  }
  let running=false;
  async function run(){
    if(running||!configured())return;
    running=true;
    try {
      const testTo=await recipient();
      const copy=(await pool.query('SELECT copy_recipient FROM schedule_leave_mail_settings WHERE id=1')).rows[0].copy_recipient;
      // Stop uncertain retries before the provider's 24-hour idempotency window expires.
      await pool.query(`UPDATE schedule_leave_mail SET status='review',error='Envoi à vérifier dans Resend avant toute relance.'
        WHERE status IN ('pending','sending','error') AND first_attempt_at<clock_timestamp()-interval '20 hours'`);
      const jobs=(await pool.query(`SELECT m.request_id,r.submitted_at,r.status AS request_status,r.is_test,r.employee_name,r.email,r.reason,r.periods,r.department_name,d.recipient,d.mail_enabled FROM schedule_leave_mail m
        JOIN schedule_leave_requests r ON r.id=m.request_id LEFT JOIN schedule_leave_departments d ON d.id=r.department_id WHERE r.archived_at IS NULL AND (r.is_test=TRUE OR (d.mail_enabled=TRUE AND d.recipient<>'')) AND
        ((m.status IN ('pending','error') AND (m.last_attempt_at IS NULL OR m.last_attempt_at<clock_timestamp()-interval '1 minute'))
        OR (m.status='sending' AND m.last_attempt_at<clock_timestamp()-interval '2 minutes')) ORDER BY m.request_id LIMIT 10`)).rows;
      for(const job of jobs){
        const to=job.is_test?testTo:job.recipient;if(!to)continue;
        const time=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
        const periods=job.periods.map(p=>p.date+' — '+(p.allDay?'Journée complète':time(p.startMinute)+' à '+time(p.endMinute))).join('\n');
        const payload={from:process.env.RESEND_FROM_EMAIL||process.env.RESEND_FROM||process.env.EMAIL_FROM||'Quarts Service <onboarding@resend.dev>',to:[to],
          ...(!job.is_test&&copy&&copy.toLowerCase()!==to.toLowerCase()?{cc:[copy]}:{}),
          reply_to:job.email,
          subject:`${job.is_test?'[TEST] ':''}Demande de congé n° ${job.request_id} — ${job.department_name}`,
          text:`${job.is_test?'DEMANDE DE TEST — aucun effet sur les horaires.\n\n':''}Département : ${job.department_name}\nEmployé : ${job.employee_name}\nCourriel : ${job.email}\nRéférence : ${job.request_id}\nRemise : ${new Intl.DateTimeFormat('fr-CA',{dateStyle:'long',timeStyle:'short',timeZone:'America/Toronto'}).format(new Date(job.submitted_at))} (Québec)\n\nDATES ET HEURES\n${periods}\n\nMOTIF\n${job.reason}\n\n${job.request_status==='late'?'Demande hors délai — l’employé doit s’adresser à sa gérante.':'La demande doit être évaluée par le responsable.'}\n\nSuivi central (accès gestionnaire requis) : https://quarts-service-iga.onrender.com/conges-gestion\nLe nom et le département sont déclarés par l’employé.`};
        const claimed=(await pool.query(`UPDATE schedule_leave_mail SET status='sending',attempts=attempts+1,
          first_attempt_at=COALESCE(first_attempt_at,clock_timestamp()),last_attempt_at=clock_timestamp(),payload=COALESCE(payload,$2::jsonb)
          WHERE request_id=$1 AND (status IN ('pending','error') OR (status='sending' AND last_attempt_at<clock_timestamp()-interval '2 minutes')) RETURNING payload`,[job.request_id,JSON.stringify(payload)])).rows[0];
        if(!claimed)continue;
        try {
          const result=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`quarts-leave-${job.is_test?'test':'real'}-${job.request_id}`},body:JSON.stringify(claimed.payload)});
          const data=await result.json();
          if(!result.ok||!data.id)throw new Error(`Resend HTTP ${result.status}. Vérifiez la clé et l’expéditeur dans Render/Resend.`);
          await pool.query(`UPDATE schedule_leave_mail SET status='sent',provider_id=$2,error='' WHERE request_id=$1`,[job.request_id,data.id]);
        }catch(error){await pool.query(`UPDATE schedule_leave_mail SET status='error',error=$2 WHERE request_id=$1`,[job.request_id,error.name==='TimeoutError'?'Délai de réponse Resend dépassé. Nouvelle tentative prévue.':error.message.startsWith('Resend HTTP')?error.message:'Envoi non confirmé. Nouvelle tentative prévue.']);}
      }
    }finally{running=false;}
  }
  const timer=setInterval(()=>run().catch(()=>{}),60000);timer.unref();run().catch(()=>{});
  return {queue,run};
}

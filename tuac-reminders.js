export const tuacReminderSchemaSQL=`CREATE TABLE IF NOT EXISTS tuac_expiry_reminders(
 posting_id uuid NOT NULL REFERENCES tuac_postings(id),end_date date NOT NULL,
 status text NOT NULL DEFAULT 'pending',payload jsonb NOT NULL,
 started_at timestamptz,last_at timestamptz,sent_at timestamptz,
 PRIMARY KEY(posting_id,end_date));
ALTER TABLE tuac_expiry_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tuac_expiry_reminders FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON tuac_expiry_reminders FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON tuac_expiry_reminders FROM authenticated; END IF;
END $$;`;
export function tuacSender(env=process.env){const configured=env.RESEND_FROM_EMAIL||env.RESEND_FROM||env.EMAIL_FROM||'onboarding@resend.dev';return 'IGA Famille Benoit 300-425 <'+(configured.match(/<([^<>]+)>/)?.[1]||configured.trim())+'>';}
export async function sendTuacExpiryReminders(pool,{fetchImpl=fetch,env=process.env}={}){
 if(!pool||!env.RESEND_API_KEY)return;
 const due=(await pool.query(`SELECT p.id,p.reference,p.data FROM tuac_postings p
 WHERE (p.data->>'endDate')::date <= (clock_timestamp() AT TIME ZONE 'America/Toronto')::date
 AND NOT EXISTS(SELECT 1 FROM tuac_expiry_reminders r WHERE r.posting_id=p.id AND r.end_date=(p.data->>'endDate')::date)
 ORDER BY p.created_at LIMIT 30`)).rows;
 for(const p of due){const end=p.data.endDate,payload={from:tuacSender(env),to:['igabenoit@gmail.com'],subject:'Affichage arrivé à échéance — '+p.reference+' — '+p.data.job,text:`Bonjour,\n\nL’affichage ${p.reference} — ${p.data.job} est arrivé à échéance le ${end} à 00 h, après 7 jours d’affichage.\n\nTu peux compléter la liste des personnes qui ont postulé, puis sélectionner la personne qui obtient le poste dans Nomination de poste.\n\nOuvrir les affichages et nominations :\nhttps://quartservice.igabenoit.com/affichages-tuac\n\nLes documents avec les logos TUAC et IGA peuvent être imprimés et envoyés par courriel.\n\nIGA Famille Benoit 300-425`};
  await pool.query('INSERT INTO tuac_expiry_reminders(posting_id,end_date,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[p.id,end,JSON.stringify(payload)]);
 }
 await pool.query("UPDATE tuac_expiry_reminders SET status='review' WHERE status IN ('pending','sending') AND started_at<clock_timestamp()-interval '20 hours'");
 const jobs=(await pool.query(`SELECT r.posting_id,r.end_date::text AS end_date FROM tuac_expiry_reminders r JOIN tuac_postings p ON p.id=r.posting_id
 WHERE r.status IN ('pending','sending') AND r.end_date=(p.data->>'endDate')::date
 AND r.end_date <= (clock_timestamp() AT TIME ZONE 'America/Toronto')::date
 AND (r.last_at IS NULL OR r.last_at<clock_timestamp()-interval '2 minutes') LIMIT 20`)).rows;
 let failures=0;
 for(const job of jobs){
  const row=(await pool.query(`UPDATE tuac_expiry_reminders r SET status='sending',started_at=COALESCE(r.started_at,clock_timestamp()),last_at=clock_timestamp()
   FROM tuac_postings p WHERE r.posting_id=$1 AND r.end_date=$2 AND p.id=r.posting_id
   AND r.end_date=(p.data->>'endDate')::date AND r.end_date <= (clock_timestamp() AT TIME ZONE 'America/Toronto')::date
   AND r.status IN ('pending','sending') AND (r.last_at IS NULL OR r.last_at<clock_timestamp()-interval '2 minutes') RETURNING r.payload`,[job.posting_id,job.end_date])).rows[0];
  if(!row)continue;
  try{const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'tuac-expiry-'+job.posting_id+'-'+job.end_date},body:JSON.stringify(row.payload)});
   if(!response.ok)throw Error('Envoi non confirmé');
   await pool.query("UPDATE tuac_expiry_reminders SET status='sent',sent_at=clock_timestamp() WHERE posting_id=$1 AND end_date=$2",[job.posting_id,job.end_date]);
  }catch{failures++;}
 }
 if(failures)throw Error('Rappels TUAC non confirmés : '+failures+'. Reprise automatique avec le même identifiant.');
}

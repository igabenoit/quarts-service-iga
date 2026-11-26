import {disciplineSteps} from './public/discipline-model.js';
export const approvalSchemaSQL=`
ALTER TABLE employee_file_discipline ADD COLUMN IF NOT EXISTS department_id bigint;
CREATE TABLE IF NOT EXISTS employee_discipline_approvals (
 revision_id uuid PRIMARY KEY REFERENCES employee_file_discipline(id),
 employee_key text NOT NULL,level integer NOT NULL CHECK(level BETWEEN 1 AND 11),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
 decision_actor jsonb,decision_note text,decided_at timestamptz,
 mail_status text NOT NULL DEFAULT 'pending',mail_started_at timestamptz,mail_last_at timestamptz,mail_payload jsonb);
CREATE UNIQUE INDEX IF NOT EXISTS discipline_one_pending ON employee_discipline_approvals(employee_key) WHERE status='pending';
ALTER TABLE employee_discipline_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON employee_discipline_approvals FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON employee_discipline_approvals FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON employee_discipline_approvals FROM authenticated; END IF;
END $$;`;
export async function nextDisciplineLevel(db,key){
 const {rows:[r]}=await db.query(`SELECT COALESCE(MAX(a.level),0)::int AS level FROM employee_discipline_approvals a
 JOIN employee_file_discipline d ON d.id=a.revision_id WHERE a.employee_key=$1 AND a.status='approved'
 AND NOT EXISTS(SELECT 1 FROM employee_file_discipline n WHERE n.case_id=d.case_id AND n.version>d.version) AND d.status='filed'`,[key]);
 return r.level+1;
}
export function disciplineMailPayload(id,from){return {from,to:['igabenoit@gmail.com'],subject:'Nouvel avis disciplinaire — approbation requise',text:`Un nouvel avis disciplinaire est au dossier. Votre approbation de la gradation est requise.\n\nOuvrez votre accès direction :\nhttps://quartservice.igabenoit.com/dossiers-employes#mesures\n\nRéférence : ${id}\nLe palier ne change pas avant votre approbation.`};}
export async function sendDisciplineMail(pool,{fetchImpl=fetch,env=process.env}={}){
 if(!pool||!env.RESEND_API_KEY)return;
 await pool.query("UPDATE employee_discipline_approvals SET mail_status='review' WHERE mail_status IN ('pending','sending') AND mail_started_at<clock_timestamp()-interval '20 hours'");
 const jobs=(await pool.query("SELECT revision_id FROM employee_discipline_approvals WHERE mail_status IN ('pending','sending') AND (mail_last_at IS NULL OR mail_last_at<clock_timestamp()-interval '2 minutes') LIMIT 10")).rows;
 for(const job of jobs){
  const db=await pool.connect();let row;
  try{
   await db.query('BEGIN');
   row=(await db.query("SELECT * FROM employee_discipline_approvals WHERE revision_id=$1 AND mail_status IN ('pending','sending') AND (mail_last_at IS NULL OR mail_last_at<clock_timestamp()-interval '2 minutes') FOR UPDATE",[job.revision_id])).rows[0];
   if(row){row.mail_payload||=disciplineMailPayload(row.revision_id,env.RESEND_FROM_EMAIL||env.RESEND_FROM||env.EMAIL_FROM||'Quarts Service <onboarding@resend.dev>');
    await db.query("UPDATE employee_discipline_approvals SET mail_status='sending',mail_started_at=COALESCE(mail_started_at,clock_timestamp()),mail_last_at=clock_timestamp(),mail_payload=$2 WHERE revision_id=$1",[row.revision_id,JSON.stringify(row.mail_payload)]);}
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  if(!row)continue;
  const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':'discipline-'+row.revision_id},body:JSON.stringify(row.mail_payload,Object.keys(row.mail_payload).sort())});
  if(!response.ok)throw Error('Envoi disciplinaire à reprendre.');
  await pool.query("UPDATE employee_discipline_approvals SET mail_status='sent' WHERE revision_id=$1",[row.revision_id]);
 }
}
export {disciplineSteps};

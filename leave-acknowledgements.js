import crypto from 'node:crypto';

const kinds=['approved','refused','conditional'];
const digest=token=>crypto.createHash('sha256').update(token).digest('hex');
const fail=(message,status)=>{throw Object.assign(Error(message),{status});};

export async function installAcknowledgementSchema(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_leave_acknowledgements (
    id BIGSERIAL PRIMARY KEY,request_id BIGINT NOT NULL REFERENCES schedule_leave_requests(id),
    request_version INTEGER NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('approved','refused','conditional')),
    token_hash TEXT NOT NULL UNIQUE,snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),acknowledged_at TIMESTAMPTZ,
    UNIQUE(request_id,request_version,kind)
  );`);
}

// Created in the same transaction as the frozen outgoing message. Only its hash is stored here.
export async function createAcknowledgement(client,row,kind,snapshot,{baseUrl=process.env.PUBLIC_BASE_URL||process.env.RENDER_EXTERNAL_URL||'https://quarts-service-iga.onrender.com'}={}){
  if(!kinds.includes(kind))throw Error('Type de confirmation invalide.');
  const base=new URL(baseUrl);
  if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))throw Error('Adresse publique de confirmation invalide.');
  const token=crypto.randomBytes(32).toString('base64url');
  const content={employee_name:snapshot.employee_name,department_name:snapshot.department_name,department_key:snapshot.department_key,
    periods:kind==='approved'?(snapshot.effective_periods??snapshot.periods):snapshot.periods,
    decision_note:kind==='approved'?'':snapshot.decision_note};
  await client.query(`INSERT INTO schedule_leave_acknowledgements(request_id,request_version,kind,token_hash,snapshot)
    VALUES($1,$2,$3,$4,$5::jsonb)`,[row.request_id,row.request_version,kind,digest(token),JSON.stringify(content)]);
  // Fragments are not sent in HTTP URLs or Referer headers.
  return new URL('/conge-lecture#'+token,base).href;
}

export async function installLeaveAcknowledgements(app,pool,{sameOrigin}){
  await installAcknowledgementSchema(pool);
  const route=confirm=>async(req,res)=>{
    res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'});
    const token=req.body?.token;
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return res.status(404).json({error:'Ce lien de prise de connaissance est invalide.'});
    if(confirm&&req.body?.confirmed!==true)return res.status(400).json({error:'Confirmez explicitement votre prise de connaissance.'});
    const client=await pool.connect();
    try{
      if(confirm)await client.query('BEGIN');
      const row=(await client.query(`SELECT a.id,a.request_id,a.request_version,a.kind,a.snapshot,a.acknowledged_at,
        r.status,r.version,r.archived_at,r.is_test FROM schedule_leave_acknowledgements a
        JOIN schedule_leave_requests r ON r.id=a.request_id WHERE a.token_hash=$1${confirm?' FOR UPDATE OF r,a':''}`,[digest(token)])).rows[0];
      if(!row)fail('Ce lien de prise de connaissance est invalide.',404);
      if(row.archived_at)fail('Cette demande est archivée. Communiquez avec votre responsable.',410);
      if(row.status!==row.kind||row.version!==row.request_version)fail('Ce courriel correspond à une ancienne décision. Consultez le courriel le plus récent ou communiquez avec votre responsable.',409);
      let acknowledgedAt=row.acknowledged_at;
      if(confirm){
        acknowledgedAt=(await client.query(`UPDATE schedule_leave_acknowledgements
          SET acknowledged_at=COALESCE(acknowledged_at,clock_timestamp()) WHERE id=$1 RETURNING acknowledged_at`,[row.id])).rows[0].acknowledged_at;
        await client.query('COMMIT');
      }
      res.json({requestId:row.request_id,kind:row.kind,isTest:row.is_test,acknowledgedAt,...row.snapshot});
    }catch(error){
      if(confirm)await client.query('ROLLBACK').catch(()=>{});
      res.status(error.status||500).json({error:error.status?error.message:'Impossible de confirmer la prise de connaissance. Réessayez.'});
    }finally{client.release();}
  };
  // Opening or previewing a link never records a confirmation.
  app.post('/api/leave/acknowledgements/preview',sameOrigin,route(false));
  app.post('/api/leave/acknowledgements/confirm',sameOrigin,route(true));
}

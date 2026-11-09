import {createHmac,createHash} from 'node:crypto';
export function invitationToken(nonce){
 return createHmac('sha256',process.env.SESSION_SECRET).update('onboarding/'+nonce).digest('base64url');
}
export async function sendPending(pool,{send,site=process.env.PUBLIC_BASE_URL||process.env.RENDER_EXTERNAL_URL}={}){
 if(!site)return;
 const root=new URL(site).origin;
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const row=(await db.query(`SELECT * FROM onboarding_cases WHERE (completed_at IS NOT NULL AND NOT notified) OR (completed_at IS NULL AND token_hash IS NOT NULL AND reminder_at<=now() AND NOT reminded) ORDER BY COALESCE(completed_at,reminder_at) LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
  if(row){
   const complete=!!row.completed_at,token=invitationToken(row.nonce);
   if(!complete && createHash('sha256').update(token).digest('hex')!==row.token_hash)throw Error('Lien à renouveler');
   const payload={from:process.env.RESEND_FROM_EMAIL||process.env.RESEND_FROM||process.env.EMAIL_FROM,to:[complete?row.manager_email:row.employee_email],subject:complete?'Dossier d’accueil complété':'Rappel de votre accueil',text:complete?'Un dossier d’accueil est complet. Consultez Dossiers employés : '+root+'/dossiers-employes.html':'Votre dossier d’accueil attend votre signature. Reprenez votre dossier : '+root+'/accueil-employe.html#'+token};
   const id=createHash('sha256').update([row.employee_key,row.invited_at,complete?'final':'rappel'].join('|')).digest('hex');
   if(send)await send(payload,id);
   else{
    const r=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify(payload)});
    if(!r.ok)throw Error('Courriel en attente');
   }
   await db.query('UPDATE onboarding_cases SET '+(complete?'notified':'reminded')+'=true WHERE employee_key=$1',[row.employee_key]);
  }
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}

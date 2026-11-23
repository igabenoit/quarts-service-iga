import {createHmac,createHash} from 'node:crypto';
import {onboardingWelcome,sstWelcomeTitle,sstWelcomeInstructions} from '../public/onboarding-messages.js';
export function invitationToken(nonce){
 return createHmac('sha256',process.env.SESSION_SECRET).update('onboarding/'+nonce).digest('base64url');
}
const sender=()=>process.env.RESEND_FROM_EMAIL||process.env.RESEND_FROM||process.env.EMAIL_FROM;
function onboardingSender(value=sender()){
 if(!value)return value;
 const configured=value.trim(),address=configured.match(/<([^<>]+)>$/)?.[1]?.trim()||configured;
 return 'IGA Benoit <'+address+'>';
}
const sstNotice='IMPORTANT — '+sstWelcomeTitle+'\n'+sstWelcomeInstructions;
const siteUrl=()=>process.env.PUBLIC_BASE_URL||process.env.RENDER_EXTERNAL_URL;
export function invitationEmailReady(){
 try{return !!(process.env.RESEND_API_KEY&&sender()&&process.env.SESSION_SECRET&&new URL(siteUrl()).protocol==='https:');}catch{return false;}
}
export async function sendInvitation(row,titles,{send,site=siteUrl(),from=sender()}={}){
 const token=invitationToken(row.nonce);
 if(!row.token_hash||createHash('sha256').update(token).digest('hex')!==row.token_hash)throw Error('Lien à renouveler');
 const due=typeof row.due==='string'?row.due.slice(0,10):row.due.toISOString().slice(0,10);
 const payload={from:onboardingSender(from),to:[row.employee_email],subject:onboardingWelcome,
  text:'Bonjour,\n\n'+onboardingWelcome+'\nNous sommes heureux de vous accueillir dans notre équipe.\n\nVos documents d’embauche sont prêts à remplir et à signer :\n'+titles.map(title=>'• '+title).join('\n')+(titles.some(title=>/\bSST\b/i.test(title))?'\n\n'+sstNotice:'')+'\n\nMerci de compléter tous les documents demandés avant l’échéance : '+due+'\n\nOuvrir votre dossier : '+new URL(site).origin+'/accueil-employe.html#'+token+'\n\nVous pouvez enregistrer vos réponses et reprendre plus tard avec ce même lien. Ce lien est personnel : ne le transférez pas.\n\nIGA Extra Famille Benoit'};
 const id=createHash('sha256').update(JSON.stringify([row.employee_key,row.generation,payload])).digest('hex');
 if(send)await send(payload,id);
 else{
  if(!invitationEmailReady())throw Error('Envoi de courriel non configuré');
  const r=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify(payload)});
  if(!r.ok)throw Error('Courriel non accepté');
 }
 return {status:'sent',email:row.employee_email};
}
export async function sendPending(pool,{send,trial=null,site=process.env.PUBLIC_BASE_URL||process.env.RENDER_EXTERNAL_URL}={}){
 if(!site)return;
 const root=new URL(site).origin;
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const row=(await db.query(`SELECT * FROM onboarding_cases WHERE (completed_at IS NOT NULL AND NOT notified) OR (completed_at IS NULL AND token_hash IS NOT NULL AND reminder_at<=now() AND NOT reminded) ORDER BY COALESCE(completed_at,reminder_at) LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
  if(row){
   if(trial && (row.employee_key!==trial.key||row.employee_email!==trial.employeeEmail||row.manager_email!==trial.managerEmail))throw Error('Essai hors périmètre');
   const complete=!!row.completed_at,token=invitationToken(row.nonce);
   if(!complete && createHash('sha256').update(token).digest('hex')!==row.token_hash)throw Error('Lien à renouveler');
   const pendingSst=!complete&&(await db.query("SELECT 1 FROM onboarding_docs WHERE employee_key=$1 AND invited AND kind IN ('sst','sst_general') AND original_id IS NULL LIMIT 1",[row.employee_key])).rowCount>0;
   const payload={from:onboardingSender(),to:[complete?row.manager_email:row.employee_email],subject:complete?'Dossier d’accueil complété':'Rappel de votre accueil',text:complete?'Un dossier d’accueil est complet. Consultez Dossiers employés : '+root+'/dossiers-employes.html':'Votre dossier d’accueil est encore à compléter.'+(pendingSst?'\n\n'+sstNotice:'')+'\n\nReprenez votre dossier : '+root+'/accueil-employe.html#'+token};
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

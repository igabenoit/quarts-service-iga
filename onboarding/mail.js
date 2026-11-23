import {createHmac,createHash} from 'node:crypto';
import {onboardingWelcome,sstWelcomeTitle,sstWelcomeSubtitle,sstWelcomeInstructions} from '../public/onboarding-messages.js';
import {parseFollowUpEmails} from '../public/onboarding-follow-up.js';
export function invitationToken(nonce){
 return createHmac('sha256',process.env.SESSION_SECRET).update('onboarding/'+nonce).digest('base64url');
}
const sender=()=>process.env.RESEND_FROM_EMAIL||process.env.RESEND_FROM||process.env.EMAIL_FROM;
function onboardingSender(value=sender()){
 if(!value)return value;
 const configured=value.trim(),address=configured.match(/<([^<>]+)>$/)?.[1]?.trim()||configured;
 return 'IGA Benoit <'+address+'>';
}
const sstNotice=sstWelcomeTitle+'\n'+sstWelcomeSubtitle+'\n\n'+sstWelcomeInstructions;
function emailHtml(text){
 const escape=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 return '<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#222">'+text.split('\n\n').map(paragraph=>{
  const html=paragraph.split(/(https:\/\/\S+)/g).map(part=>part.startsWith('https://')?'<a href="'+escape(part)+'">'+escape(part)+'</a>':escape(part)).join('').replace(/\n/g,'<br>');
  return '<p>'+(paragraph.startsWith(sstWelcomeTitle)?'<strong>'+html+'</strong>':html)+'</p>';
 }).join('')+'</div>';
}
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
 payload.html=emailHtml(payload.text);
 const id=createHash('sha256').update(JSON.stringify([row.employee_key,row.generation,payload])).digest('hex');
 let receipt;
 if(send)receipt=await send(payload,id);
 else{
  if(!invitationEmailReady())throw Error('Envoi de courriel non configuré');
  const r=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify(payload)});
  if(!r.ok)throw Error('Courriel non accepté');
  receipt=await r.json();
  if(typeof receipt?.id!=='string'||!receipt.id)throw Error('Confirmation d’envoi indisponible');
 }
 return {status:'sent',email:row.employee_email,confirmedAt:new Date().toISOString(),...(typeof receipt?.id==='string'?{providerMessageId:receipt.id}:{})};
}
export async function sendPending(pool,{send,trial=null,directionEmail=process.env.ONBOARDING_DIRECTION_EMAIL,site=process.env.PUBLIC_BASE_URL||process.env.RENDER_EXTERNAL_URL}={}){
 if(!site)return;
 const root=new URL(site).origin;
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const row=(await db.query(`SELECT * FROM onboarding_cases c WHERE
   EXISTS(SELECT 1 FROM onboarding_docs d WHERE d.employee_key=c.employee_key AND d.original_id IS NULL AND d.draft#>>'{_workflow,employeeOriginalId}' IS NOT NULL AND d.draft#>>'{_workflow,notifiedAt}' IS NULL)
   OR (completed_at IS NOT NULL AND NOT notified)
   OR (completed_at IS NULL AND token_hash IS NOT NULL AND reminder_at<=now() AND NOT reminded AND EXISTS(SELECT 1 FROM onboarding_docs d WHERE d.employee_key=c.employee_key AND d.invited AND d.original_id IS NULL AND d.draft#>>'{_workflow,employeeOriginalId}' IS NULL))
   ORDER BY COALESCE(activity,completed_at,reminder_at) LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
  if(row){
   if(trial && (row.employee_key!==trial.key||row.employee_email!==trial.employeeEmail||row.manager_email!==trial.managerEmail))throw Error('Essai hors périmètre');
   const pending=(await db.query("SELECT kind,draft FROM onboarding_docs WHERE employee_key=$1 AND original_id IS NULL AND draft#>>'{_workflow,employeeOriginalId}' IS NOT NULL AND draft#>>'{_workflow,notifiedAt}' IS NULL ORDER BY kind FOR UPDATE",[row.employee_key])).rows;
   if(pending.length){
    for(const doc of pending){
     const w=doc.draft._workflow,to=parseFollowUpEmails(trial?trial.managerEmail:directionEmail||row.manager_email);
     const link=root+'/accueil-employe.html?sur-place#'+new URLSearchParams({key:row.employee_key,kind:doc.kind});
     const payload={from:onboardingSender(),to,subject:'Document à finaliser · '+w.title,text:'Bonjour,\n\n'+w.employeeName+' a rempli et signé sa partie du document suivant :\n'+w.title+'\n\nTa partie reste à compléter pour finaliser le document. Les renseignements et la signature de l’employé sont verrouillés.\n\nOuvrir le document à finaliser : '+link+'\n\nConnecte-toi avec ton accès autorisé. Aucun formulaire ni renseignement confidentiel n’est joint à ce courriel.\n\nIGA Benoit'};
     payload.html=emailHtml(payload.text);
     const id=createHash('sha256').update('onboarding-direction|'+w.employeeOriginalId+'|'+to).digest('hex');
     if(send)await send(payload,id);else{
      const r=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify(payload)});
      if(!r.ok)throw Error('Avis de finalisation en attente');
     }
     await db.query("UPDATE onboarding_docs SET draft=jsonb_set(draft,'{_workflow,notifiedAt}',to_jsonb(now()::text)) WHERE employee_key=$1 AND kind=$2",[row.employee_key,doc.kind]);
    }
    await db.query('COMMIT');return;
   }
   const complete=!!row.completed_at,token=invitationToken(row.nonce);
   if(!complete && createHash('sha256').update(token).digest('hex')!==row.token_hash)throw Error('Lien à renouveler');
   const pendingSst=!complete&&(await db.query("SELECT 1 FROM onboarding_docs WHERE employee_key=$1 AND invited AND kind IN ('sst','sst_general') AND original_id IS NULL AND draft#>>'{_workflow,employeeOriginalId}' IS NULL LIMIT 1",[row.employee_key])).rowCount>0;
   const payload={from:onboardingSender(),to:complete?parseFollowUpEmails(row.manager_email):[row.employee_email],subject:complete?'Dossier d’accueil complété':'Rappel de votre accueil',text:complete?'Un dossier d’accueil est complet. Consultez Dossiers employés : '+root+'/dossiers-employes.html':'Votre dossier d’accueil est encore à compléter.'+(pendingSst?'\n\n'+sstNotice:'')+'\n\nReprenez votre dossier : '+root+'/accueil-employe.html#'+token};
   payload.html=emailHtml(payload.text);
   const id=createHash('sha256').update([row.employee_key,row.invited_at,complete?'final|'+payload.to.join(','):'rappel'].join('|')).digest('hex');
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

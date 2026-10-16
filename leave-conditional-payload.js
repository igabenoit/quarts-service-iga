import {normalizeEmail} from './employee-contacts.js';
import {leaveMailFrame,leavePeriodPanel,acknowledgementText} from './leave-mail-layout.js';
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function conditionalPayload(job,{testRecipient='',from='Quarts Service <onboarding@resend.dev>'}={}){
  const s=job.snapshot,to=normalizeEmail(s.is_test?testRecipient:s.email),reply=s.is_test?'':normalizeEmail(s.recipient);
  if(!to)throw new Error(s.is_test?'Destinataire de test à configurer.':'Courriel de la demande invalide.');
  if(!String(s.decision_note||'').trim())throw new Error('Les conditions de l’accord sont manquantes.');
  const date=d=>new Intl.DateTimeFormat('fr-CA',{dateStyle:'full',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'));
  const time=m=>String(Math.floor(m/60)).padStart(2,'0')+' h '+String(m%60).padStart(2,'0');
  const periods=s.periods.map(p=>`${date(p.date)} — ${p.allDay?'journée complète':time(p.startMinute)+' à '+time(p.endMinute)}`);
  const subject=`${s.is_test?'[TEST] ':''}[SOUS CONDITIONS] Congé sous conditions — validation finale requise · n° ${job.request_id}`;
  const intro='Votre demande bénéficie d’un accord sous conditions. Votre congé n’est pas encore confirmé.';
  const next='Effectuez les démarches ci-dessous et informez votre responsable de leur avancement. La gestion doit valider que les conditions sont remplies avant de confirmer votre congé.';
  const warning='Votre horaire actuel reste en vigueur. Vous devez obtenir la confirmation finale de votre responsable avant de vous absenter.';
  const text=[s.is_test?'ESSAI — aucun congé réel ni changement d’horaire.':'',`Bonjour ${s.employee_name},`,intro,`CONDITIONS À REMPLIR\n${s.decision_note}`,`PÉRIODES DEMANDÉES\n${periods.join('\n')}`,`Département : ${s.department_name}\nRéférence : ${job.request_id}`,next,warning,'IGA extra Famille Benoit'].filter(Boolean).join('\n\n');
  const html=leaveMailFrame({identity:s,requestId:job.request_id,subject,
    preheader:'Votre congé n’est pas encore confirmé. Des conditions restent à remplir et à faire valider.',
    eyebrow:'VALIDATION FINALE REQUISE',title:'Congé sous conditions',summary:'Votre congé n’est pas encore confirmé.',
    content:`<tr><td style="padding:26px"><p style="margin:0 0 12px;font-size:17px;line-height:1.6;overflow-wrap:anywhere">Bonjour ${escape(s.employee_name)},</p><p style="margin:0;font-size:16px;line-height:1.65">Votre demande bénéficie d’un accord sous conditions. Vous devez remplir les conditions suivantes, puis obtenir la confirmation finale de votre responsable.</p></td></tr>
<tr><td style="padding:0 26px 26px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fff4d9;border-left:5px solid #b47a13"><tr><td style="padding:20px"><h2 style="margin:0 0 13px;font-size:14px;line-height:1.5;letter-spacing:.5px;color:#744700">CONDITIONS À REMPLIR</h2><p style="margin:0;font-size:18px;line-height:1.65;color:#352d21;overflow-wrap:anywhere">${escape(s.decision_note).replaceAll('\n','<br>')}</p></td></tr></table></td></tr>
<tr><td style="padding:0 26px 26px">${leavePeriodPanel(s,s.periods,'Périodes demandées — à confirmer')}</td></tr>
<tr><td style="padding:0 26px 22px"><h2 style="margin:0 0 10px;font-size:19px">La prochaine étape</h2><p style="margin:0;font-size:15px;line-height:1.65">${next}</p></td></tr>
<tr><td style="padding:0 26px 26px">${reply?`<p style="margin:0 0 18px"><a href="mailto:${escape(encodeURIComponent(reply))}?subject=${escape(encodeURIComponent('Suivi des conditions — demande de congé n° '+job.request_id))}" style="display:inline-block;padding:13px 18px;background:#22303a;color:#fff;text-decoration:none;font-size:14px;line-height:1.5;font-weight:bold;border-radius:4px">Informer mon responsable de mes démarches</a></p>`:''}<p style="margin:0;padding:16px;background:#fff4d9;font-size:15px;line-height:1.65;color:#744700"><strong>${warning}</strong></p></td></tr>`});
  return {from,to:[to],...(reply?{reply_to:reply}:{}),subject,text:text+acknowledgementText(s),html};
}

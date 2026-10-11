import {normalizeEmail} from './employee-contacts.js';
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function conditionalPayload(job,{testRecipient='',from='Quarts Service <onboarding@resend.dev>'}={}){
  const s=job.snapshot,to=normalizeEmail(s.is_test?testRecipient:s.email),reply=s.is_test?'':normalizeEmail(s.recipient);
  if(!to)throw new Error(s.is_test?'Destinataire de test à configurer.':'Courriel de la demande invalide.');
  if(!String(s.decision_note||'').trim())throw new Error('Les conditions de l’accord sont manquantes.');
  const date=d=>new Intl.DateTimeFormat('fr-CA',{dateStyle:'full',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'));
  const time=m=>String(Math.floor(m/60)).padStart(2,'0')+' h '+String(m%60).padStart(2,'0');
  const periods=s.periods.map(p=>`${date(p.date)} — ${p.allDay?'journée complète':time(p.startMinute)+' à '+time(p.endMinute)}`);
  const subject=`${s.is_test?'[TEST] ':''}[SOUS CONDITIONS] Demande de congé — validation finale requise · n° ${job.request_id}`;
  const intro='Votre demande bénéficie d’un accord sous conditions. Votre congé n’est pas encore confirmé.';
  const next='Effectuez les démarches ci-dessous et informez votre responsable de leur avancement. La gestion doit valider que les conditions sont remplies avant de confirmer votre congé.';
  const warning='Votre horaire actuel reste en vigueur. Vous devez obtenir la confirmation finale de votre responsable avant de vous absenter.';
  const text=[s.is_test?'ESSAI — aucun congé réel ni changement d’horaire.':'',`Bonjour ${s.employee_name},`,intro,`CONDITIONS À REMPLIR\n${s.decision_note}`,`PÉRIODES DEMANDÉES\n${periods.join('\n')}`,`Département : ${s.department_name}\nRéférence : ${job.request_id}`,next,warning,'IGA extra Famille Benoit'].filter(Boolean).join('\n\n');
  const html=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;padding:0;background:#f2f0ed;color:#292727;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">Accord sous conditions : votre congé attend la validation finale de la gestion.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #e5dfdb">
<tr><td style="padding:21px 24px;border-top:7px solid #a96a00"><p style="margin:0;color:#8f1420;font-size:14px;font-weight:bold;letter-spacing:1px">IGA EXTRA FAMILLE BENOIT</p><p style="margin:6px 0 0;color:#766f6b;font-size:12px">QUARTS SERVICE · DEMANDES DE CONGÉ</p></td></tr>
${s.is_test?'<tr><td style="padding:12px 24px;background:#fff0bf;font-weight:bold">ESSAI — aucun congé réel ni changement d’horaire.</td></tr>':''}
<tr><td style="padding:28px 24px;background:#805000;color:#fff"><p style="margin:0 0 13px;font-size:12px;letter-spacing:1.5px;font-weight:bold">VALIDATION FINALE REQUISE</p><h1 style="margin:0;font-size:34px;line-height:1.15;color:#fff">Accord sous conditions.</h1></td></tr>
<tr><td style="padding:26px 24px"><p style="margin:0 0 14px;font-size:16px;line-height:1.6">Bonjour ${escape(s.employee_name)},</p><p style="margin:0;font-size:16px;line-height:1.65">Votre demande bénéficie d’un accord sous conditions.<br><strong>Votre congé n’est pas encore confirmé.</strong></p></td></tr>
<tr><td style="padding:24px;background:#fff4d9;border-left:6px solid #b47a13"><h2 style="margin:0 0 14px;font-size:14px;letter-spacing:.6px;color:#744700">CONDITIONS À REMPLIR</h2><p style="margin:0;font-size:18px;line-height:1.65;overflow-wrap:anywhere">${escape(s.decision_note).replaceAll('\n','<br>')}</p></td></tr>
<tr><td style="padding:24px"><h2 style="margin:0 0 14px;font-size:12px;letter-spacing:1px;color:#76655d">PÉRIODES DEMANDÉES</h2><p style="margin:0;font-size:15px;line-height:1.8">${periods.map(escape).join('<br>')}</p><p style="margin:16px 0 0;padding-top:14px;border-top:1px solid #e7e0dc;font-size:13px;line-height:1.7;color:#6c625b">Département : ${escape(s.department_name)}<br>Référence : ${escape(job.request_id)}</p></td></tr>
<tr><td style="padding:24px;background:#f7f5f2"><h2 style="margin:0 0 12px;font-size:19px">La prochaine étape</h2><p style="margin:0;font-size:15px;line-height:1.65">${next}</p></td></tr>
<tr><td style="padding:24px">${reply?`<p style="margin:0 0 20px"><a href="mailto:${escape(encodeURIComponent(reply))}?subject=${escape(encodeURIComponent('Suivi des conditions — demande de congé n° '+job.request_id))}" style="display:inline-block;padding:13px 18px;background:#302b28;color:#fff;text-decoration:none;font-size:14px;font-weight:bold;border-radius:4px">Informer mon responsable de mes démarches</a></p>`:''}<p style="margin:0;font-size:15px;line-height:1.65;color:#744700"><strong>${warning}</strong></p></td></tr>
<tr><td style="padding:17px 24px;background:#302b28;color:#fff;font-size:12px;line-height:1.6">IGA extra Famille Benoit<br>Message automatique de suivi des demandes de congé.</td></tr>
</table></td></tr></table></body></html>`;
  return {from,to:[to],...(reply?{reply_to:reply}:{}),subject,text,html};
}

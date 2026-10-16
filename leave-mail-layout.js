import {DEPARTMENT_STYLES,escapeHTML as escape,nameKey} from './public/departments-core.js';

const styles=[{key:'service',name:'Service',color:'#245a9a',pale:'#eaf1ff'},...DEPARTMENT_STYLES];
export function leaveMailTheme(identity){
  const style=styles.find(d=>d.key===identity.department_key)
    ||styles.find(d=>nameKey(d.name)===nameKey(identity.department_name)||nameKey(d.key)===nameKey(identity.department_name))
    ||{color:'#344351',pale:'#e9edf1'};
  const rgb=style.color.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  const ink=1.05/(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722+.05)>=4.5?'#ffffff':'#17212b';
  return {...style,ink};
}

export const acknowledgementText=identity=>identity.acknowledgement_url?`\n\nJ’AI PRIS CONNAISSANCE\n${identity.acknowledgement_url}\nOuvrez ce lien, puis confirmez votre prise de connaissance sur la page. Cette confirmation ne modifie pas la décision.`:'';

// Content is trusted markup assembled by the mail templates; all employee fields are escaped there.
export function leaveMailFrame({identity,requestId,subject,preheader,eyebrow,title,summary,content}){
  const {color,ink}=leaveMailTheme(identity);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f4f7;color:#22303a;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escape(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #dce3e9;border-radius:12px;overflow:hidden">
<tr><td style="padding:23px 26px"><p style="margin:0;font-size:13px;line-height:1.5;font-weight:bold;letter-spacing:1px">IGA EXTRA FAMILLE BENOIT</p><p style="margin:7px 0 0;font-size:14px;line-height:1.5;overflow-wrap:anywhere">Département · <strong>${escape(identity.department_name)}</strong></p></td></tr>
${identity.is_test?'<tr><td style="padding:12px 26px;background:#fff0bf;color:#513d00;font-size:14px;font-weight:bold">ESSAI — aucun congé réel ni changement d’horaire.</td></tr>':''}
<tr><td bgcolor="${color}" style="padding:30px 26px;background:${color};color:${ink}"><p style="margin:0 0 12px;font-size:12px;line-height:1.5;letter-spacing:1.4px;font-weight:bold;color:${ink}">${escape(eyebrow)}</p><h1 style="margin:0;font-size:38px;line-height:1.15;font-weight:bold;color:${ink}">${escape(title)}</h1><p style="margin:13px 0 0;font-size:16px;line-height:1.6;color:${ink}">${escape(summary)}</p></td></tr>
${content}
${identity.acknowledgement_url?`<tr><td style="padding:0 26px 26px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f6f8fa;border:1px solid #dce3e9;border-radius:7px"><tr><td style="padding:20px"><p style="margin:0 0 15px;font-size:16px;line-height:1.6;font-weight:bold">Confirmez à votre responsable que vous avez pris connaissance de ce courriel.</p><a href="${escape(identity.acknowledgement_url)}" style="display:inline-block;padding:14px 20px;background:#22303a;color:#fff;text-decoration:none;font-size:16px;line-height:1.5;font-weight:bold;border-radius:5px">J’ai pris connaissance</a><p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:#52616d">Sur la page suivante, confirmez votre prise de connaissance. Cette confirmation ne modifie pas la décision et ne valide pas les conditions du congé.</p></td></tr></table></td></tr>`:''}
<tr><td style="padding:18px 26px;background:#f6f8fa;border-top:1px solid #e0e6eb"><p style="margin:0;font-size:12px;line-height:1.7;color:#52616d">Demande n° ${escape(requestId)} · ${escape(identity.department_name)}<br>IGA extra Famille Benoit<br>Message automatique de suivi des demandes de congé.</p></td></tr>
</table></td></tr></table></body></html>`;
}

export function leavePeriodPanel(identity,periods,heading){
  const {color,pale}=leaveMailTheme(identity);
  const date=d=>new Intl.DateTimeFormat('fr-CA',{dateStyle:'full',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'));
  const time=m=>String(Math.floor(m/60)).padStart(2,'0')+' h '+String(m%60).padStart(2,'0');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${pale}" style="background:${pale};border-left:5px solid ${color}">
<tr><td style="padding:19px 20px 5px"><h2 style="margin:0;font-size:13px;line-height:1.5;letter-spacing:.5px;color:#22303a">${escape(heading.toLocaleUpperCase('fr-CA'))}</h2></td></tr>
${periods.map(p=>`<tr><td style="padding:14px 20px 18px"><p style="margin:0 0 5px;font-size:19px;line-height:1.4;font-weight:bold;color:#22303a">${escape(date(p.date))}</p><p style="margin:0;font-size:16px;line-height:1.5;color:#344351">${p.allDay?'Journée complète':escape(time(p.startMinute)+' à '+time(p.endMinute))}</p></td></tr>`).join('')}
</table>`;
}

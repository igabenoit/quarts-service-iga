import {escapeHTML as escape} from './departments-core.js';
const labels={approved:'Congé confirmé',refused:'Congé refusé',conditional:'Congé sous conditions'};
const stamp=d=>new Intl.DateTimeFormat('fr-CA',{dateStyle:'long',timeStyle:'short',timeZone:'America/Toronto'}).format(new Date(d));
export function acknowledgementStatus(request){
  const items=request.acknowledgements||[];
  const current=items.find(a=>a.kind===request.status&&Number(a.version)===Number(request.version));
  const previous=items.filter(a=>a!==current&&a.acknowledgedAt);
  if(!current&&!previous.length&&!labels[request.status])return '';
  const status=current?.acknowledgedAt?`<p><strong>Prise de connaissance confirmée</strong><br>Le ${escape(stamp(current.acknowledgedAt))} (Québec)<br><small>Courriel : ${labels[current.kind]}</small></p>`:labels[request.status]?`<p><strong>${current?'En attente de prise de connaissance':'Aucune prise de connaissance enregistrée pour cette décision'}</strong><br><small>${current?'La confirmation sera enregistrée lorsque l’employé validera la page de son courriel.':'Le suivi est disponible pour les nouveaux courriels comportant le bouton « J’ai pris connaissance ».'}</small></p>`:'';
  const history=previous.length?`<details><summary>Prises de connaissance précédentes (${previous.length})</summary><ul>${previous.map(a=>`<li>${labels[a.kind]||escape(a.kind)} · version ${escape(a.version)} : ${escape(stamp(a.acknowledgedAt))} (Québec)</li>`).join('')}</ul><small>Ces confirmations concernent des décisions précédentes.</small></details>`:'';
  return `<section class="leave-acknowledgement ${current?.acknowledgedAt?'seen':'waiting'}" aria-label="Prise de connaissance du courriel">${status}${history}</section>`;
}

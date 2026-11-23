const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Intl.DateTimeFormat('fr-CA',{dateStyle:'medium',timeZone:'America/Toronto'}).format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T12:00:00Z':value)):'';

export function onboardingForm(c){
 const documents=c.documents||[],defaults=c.defaultDocuments||[],kinds=[...new Set([...defaults,...documents.map(d=>d.kind)])];
 const due=c.due||new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+7*86400000));
 return '<form data-invitation><fieldset><legend><strong>Documents à transmettre</strong></legend><p class="muted">Les '+defaults.length+' formulaires actuels sont sélectionnés. Les signatures et les réponses déjà enregistrées sont conservées.</p>'+kinds.map(kind=>{
  const doc=documents.find(d=>d.kind===kind),done=doc?.done||doc?.original_id,assigned=doc?.invited;
  return '<label class="check"><input type="checkbox" name="doc" value="'+esc(kind)+'" checked'+(done||assigned?' disabled':'')+'><span>'+esc(c.catalog[kind])+(done?' <span class="badge ok">Signé</span>':assigned?' <span class="badge warn">À compléter</span>':c.invited_at?' <span class="badge warn">À ajouter à l’envoi</span>':'')+'</span></label>';
 }).join('')+'</fieldset><div class="form-grid"><label>Courriel de l’employé<input required type="email" name="email" autocomplete="off" value="'+esc(c.employeeEmail||c.employee_email||'')+'"></label><label>Courriel du gestionnaire pour le suivi<input required type="email" name="managerEmail" autocomplete="off" value="'+esc(c.managerEmail||c.manager_email||'')+'"></label><label>Échéance<input required type="date" name="due" value="'+esc(due)+'"></label><label>Rappel après (jours)<input required type="number" name="days" value="3" min="1" max="365"></label></div>'+(c.emailReady?'':'<p class="muted">L’envoi par courriel est indisponible. Vous pouvez créer le lien et le transmettre vous-même.</p>')+'<div class="actions">'+(c.emailReady?'<button type="submit" name="delivery" value="email">Envoyer les documents par courriel</button>':'')+'<button type="submit" name="delivery" value="link" class="secondary">'+(c.invited_at?'Enregistrer et afficher le lien':'Créer le lien à transmettre')+'</button></div></form>';
}

export async function renderOnboardingPanel(panel,key,{view,signedPdfUrl}){
 clearTimeout(panel.refreshTimer);
 const url='/api/employee-files/onboarding',params='?'+new URLSearchParams({key,view});
 async function request(operation,body){
  const r=await fetch(url+(operation?'/'+operation:'')+params,{method:operation?'POST':'GET',cache:'no-store',headers:{'Content-Type':'application/json','X-Employee-Files':'1'},...(operation?{body:JSON.stringify(body||{})}:{})});
  const result=await r.json();if(!r.ok)throw Error(result.error||'Opération impossible.');return result;
 }
 const c=await request();
 if(!panel.isConnected)return;
 panel.className='panel onboarding-panel';
 panel.innerHTML='<div class="row spread"><div><p class="eyebrow">EMBAUCHE</p><h3>Documents d’embauche</h3></div>'+(c.invited_at?'<span class="badge '+(c.completed_at?'ok':'warn')+'">'+(c.completed_at?'Dossier complété':'En cours')+'</span>':'')+'</div><p>Un seul lien personnel pour remplir et signer les formulaires. Les PDF signés sont conservés au dossier.</p><p data-feedback role="status" aria-live="polite"></p>';
 const feedback=()=>panel.querySelector('[data-feedback]');
 async function change(operation,body){
  for(const b of panel.querySelectorAll('button'))b.disabled=true;
  feedback().textContent=(operation==='invite'&&body?.delivery==='email')||operation==='send'?'Envoi en cours…':'Enregistrement…';
  try{
   const result=await request(operation,body);
   await renderOnboardingPanel(panel,key,{view,signedPdfUrl});
   if(!panel.isConnected)return;
   if(result.delivery){
    feedback().textContent=result.delivery.status==='sent'?'Courriel transmis au service d’envoi pour '+result.delivery.email+'.':result.delivery.status==='failed'?'Le courriel n’a pas pu être confirmé. Les documents sont prêts : réessayez l’envoi ou copiez le lien.':'Courriel indisponible. Copiez le lien pour le transmettre à l’employé.';
   }
   if(result.path){
    const block=document.createElement('div');block.className='onboarding-link';
    block.innerHTML='<label>Lien personnel de l’employé<input readonly aria-label="Lien personnel de l’employé"></label><button class="secondary" type="button">Copier le lien</button>';
    const input=block.querySelector('input');input.value=new URL(result.path,location.origin).href;
    block.querySelector('button').onclick=async()=>{try{await navigator.clipboard.writeText(input.value);feedback().textContent='Lien copié.';}catch{input.select();feedback().textContent='Le lien est sélectionné. Utilisez Ctrl+C pour le copier.';}};
    panel.append(block);
    if(!result.delivery)feedback().textContent='Documents prêts. Transmettez ce lien personnel à l’employé.';
   }
  }catch(error){
   feedback().textContent=error.message;
   for(const b of panel.querySelectorAll('button'))b.disabled=false;
  }
 }
 if(!c.eligible){
  const p=document.createElement('p');p.textContent=c.canStart?'Ce dossier n’a pas encore de parcours d’embauche. Vous pouvez le préparer ici.':'Vérifiez le matricule et le statut actif de cette fiche avant de préparer les documents.';panel.append(p);
  if(c.canStart){const b=document.createElement('button');b.textContent='Préparer les documents d’embauche';b.onclick=()=>change('start');panel.append(b);}
  return;
 }
 const items=c.documents.filter(d=>d.invited||d.done||d.original_id),done=items.filter(d=>d.done||d.original_id).length;
 const additions=(c.defaultDocuments||[]).filter(kind=>!items.some(d=>d.kind===kind));
 if(c.invited_at){
  const status=document.createElement('div');status.className='onboarding-status';
  status.innerHTML='<p><strong>'+done+' / '+items.length+' documents signés</strong> · Échéance : '+esc(date(c.due))+'</p><progress max="'+Math.max(1,items.length)+'" value="'+done+'" aria-label="Documents signés"></progress>'+items.map(d=>'<div class="row spread"><span>'+esc(c.catalog[d.kind])+'</span>'+(d.original_id?'<a href="'+esc(signedPdfUrl(d.original_id))+'" target="_blank" rel="noopener">'+(d.kind==='ethique'?'Voir / imprimer les signatures':'PDF signé')+'</a>':d.done?'<span class="badge ok">Signé · accès réservé</span>':'<span class="badge warn">À compléter</span>')+'</div>').join('');panel.append(status);
  if(additions.length){
   const available=document.createElement('div');available.className='onboarding-additions';
   available.innerHTML=additions.map(kind=>'<div class="row spread"><strong>'+esc(c.catalog[kind])+'</strong><span class="badge warn">À ajouter à l’envoi</span></div>').join('')+'<p>Ces documents sont sélectionnés ci-dessous. Enregistrez pour les ajouter au lien personnel existant, ou choisissez l’envoi par courriel.</p>';status.append(available);
  }
  if(c.lastDelivery?.status==='sent')feedback().textContent='Courriel transmis au service d’envoi le '+date(c.lastDelivery.created_at)+' pour '+c.lastDelivery.email+'.';
  if(['failed','unavailable'].includes(c.lastDelivery?.status))feedback().textContent='Dernier envoi non confirmé. Réessayez ou transmettez le lien personnel.';
  if(!c.completed_at){
   const actions=document.createElement('div');actions.className='actions';
   actions.innerHTML=(c.active?(c.emailReady?'<button data-op="send">Envoyer ou réessayer le courriel</button>':'')+'<button class="secondary" data-op="revoke">Révoquer le lien</button>':'<p>Lien révoqué</p>')+'<button class="secondary" data-op="renew">Créer un nouveau lien</button>';panel.append(actions);
   for(const button of actions.querySelectorAll('[data-op]'))button.onclick=()=>change(button.dataset.op);
  }
 }
 const personal=c.documents.find(d=>d.kind==='renseignements');
 if(!personal?.done&&!personal?.original_id){
  const preparation=document.createElement('p'),link=document.createElement('a');
  link.className='button secondary';link.textContent='Compléter la section employeur';
  link.href='/accueil-employe.html?sur-place#'+new URLSearchParams({key,kind:'renseignements'});
  preparation.append(link,document.createTextNode(' Département, poste, date d’entrée, salaire et échelle. À préparer avant la signature de l’employé.'));panel.append(preparation);
 }
 const retirement=c.documents.find(d=>d.kind==='retraite');
 if(!retirement?.done&&!retirement?.original_id){
  const preparation=document.createElement('p'),link=document.createElement('a');link.className='button secondary';link.textContent='Régime de retraite · Compléter la section direction';
  link.href='/accueil-employe.html?sur-place#'+new URLSearchParams({key,kind:'retraite'});
  preparation.append(link,document.createTextNode(' Employeur actuel, section locale, adhésion syndicale et date d’embauche.'));panel.append(preparation);
 }
 const formHost=document.createElement(c.invited_at?'details':'div');
 if(c.invited_at&&additions.length)formHost.open=true;
 formHost.innerHTML=(c.invited_at?'<summary>Ajouter des documents ou modifier l’envoi</summary>':'')+onboardingForm(c);panel.append(formHost);
 const form=formHost.querySelector('form');
 if(c.trialPolicy){
  form.elements.email.readOnly=true;form.elements.managerEmail.readOnly=true;
  const policy=document.createElement('details');policy.innerHTML='<summary>Politique de l’essai</summary><pre>'+esc(c.trialPolicy)+'</pre>';
  const consent=document.createElement('label');consent.className='check';consent.innerHTML='<input type="checkbox" required name="approvedPolicy" value="'+esc(c.policyId)+'"> J’approuve cette politique pour la fiche fictive et ces deux destinataires.';
  form.querySelector('.actions').before(policy,consent);
 }
 form.onsubmit=event=>{
  event.preventDefault();const data=new FormData(form),documents=[...form.querySelectorAll('[name="doc"]:checked')].map(input=>input.value);
  if(!documents.length){feedback().textContent='Sélectionnez au moins un document.';return;}
  change('invite',{...Object.fromEntries(data),documents,days:Number(data.get('days')),delivery:event.submitter?.value||'link'});
 };
 // Never discard an edited invitation or the personal link during a refresh.
 let dirty=false;form.oninput=()=>{dirty=true;};
 if(c.invited_at&&!c.completed_at)panel.refreshTimer=setTimeout(()=>{if(panel.isConnected&&!dirty&&!panel.querySelector('.onboarding-link'))renderOnboardingPanel(panel,key,{view,signedPdfUrl}).catch(()=>{});},30000);
}

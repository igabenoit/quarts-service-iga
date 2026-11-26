import {disciplineSteps} from './discipline-model.js';
export async function renderDiscipline({api,apiUrl,state,esc,fmt,modal,action,saved,notice,depositDocument,employeeKey=''}){
 const host=document.querySelector('#content');
 let employees=state.employees;const person=key=>employees.find(e=>e.key===key);
 const path='discipline',today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let filters={employeeKey,status:''};
 const data=await api(path);
 const pill=level=>{const s=disciplineSteps[level-1];return `<span class="discipline-badge ${s?.tone||'clear'}">${esc(s?.label||'Aucun palier approuvé')}</span>`;};
 const reviewLabel={pending:'À approuver',approved:'Approuvé',rejected:'Refusé',cancelled:'Annulé'};
 employees=employees.filter(e=>data.employeeKeys.includes(e.key));
 const field=(label,name,value='',type='text',required=false,max=180)=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} maxlength="${max}"></label>`;
 const area=(label,name,value='',required=false,max=12000)=>`<label>${label}<textarea name="${name}" rows="5" maxlength="${max}" ${required?'required':''}>${esc(value)}</textarea></label>`;
 const options=(values,selected)=>Object.entries(values).map(([id,label])=>`<option value="${esc(id)}" ${id===selected?'selected':''}>${esc(label)}</option>`).join('');
 function edit(previous){
  const people=employees.filter(e=>e.active&&!e.issue);
  modal(previous?'Corriger la mesure':'Nouvelle mesure disciplinaire',`<form id="disciplineEdit"><div class="form-grid">
   ${previous?'<p><strong>'+esc(person(previous.employee_key)?.name)+'</strong> · Version '+previous.version+'</p>':'<label>Employé<select name="employeeKey" required><option value="">Choisir un employé</option>'+people.map(e=>'<option value="'+esc(e.key)+'" '+(e.key===filters.employeeKey?'selected':'')+'>'+esc(e.name)+'</option>').join('')+'</select></label>'}
   ${field('Date de la mesure','occurredOn',previous?.occurred_on||today(),'date',true)}
   <input type="hidden" name="measureType" value="${esc(previous?.measure_type||'verbal')}"><p>Le prochain palier est proposé automatiquement à la soumission, puis validé par la direction.</p>
   ${!previous?'<label>Département<select name="departmentId" id="disciplineDepartment" required></select></label>':''}
   ${field('Objet','title',previous?.title||'','text',true)}
   </div>${area('Faits observés','facts',previous?.facts)}${area('Attentes et suivi convenus','expectations',previous?.expectations,false,6000)}
   ${field('Date de suivi (facultative)','followUpOn',previous?.follow_up_on||'','date')}
   <label>État<select name="status">${options(previous?.status==='filed'?{filed:'Soumettre à nouveau'}:{draft:'Brouillon',filed:'Soumettre à la direction'},previous?.status||'draft')}</select></label>
   ${previous?area('Motif de la correction','reason','',previous.status==='filed',2000):''}
   <p class="muted">Vous pourrez joindre les PDF après l’enregistrement. À la soumission, un courriel demande l’approbation à igabenoit@gmail.com. Aucun changement de palier avant cette décision.</p>
   <button>Enregistrer ${previous?'la nouvelle version':'la mesure'}</button></form>`);
  const formNode=document.querySelector('#disciplineEdit');
  if(!previous){const updateDeps=()=>{const e=person(formNode.elements.employeeKey.value);formNode.elements.departmentId.innerHTML=(e?.departments||[]).filter(id=>state.departments.some(d=>d.id===id)).map(id=>'<option value="'+id+'">'+esc(state.departments.find(d=>d.id===id).name)+'</option>').join('');};formNode.elements.employeeKey.onchange=updateDeps;updateDeps();}
  document.querySelector('#disciplineEdit').onsubmit=action(async event=>{
   const form=event.target,button=form.querySelector('button');button.disabled=true;
   try{
    const body=Object.fromEntries(new FormData(form));if(previous)body.version=previous.version;
    const result=await api(previous?path+'/'+previous.case_id+'/revisions':path,body);
    saved();await detail(result.id);notice('Mesure enregistrée.');
   }finally{button.disabled=false;}
  });
 }
 async function list(){
  const current=await api(path),rows=current.measures.filter(r=>(!filters.employeeKey||r.employee_key===filters.employeeKey)&&(!filters.status||(filters.status==='pending'?r.approval?.status==='pending':r.status===filters.status)));
  const visiblePeople=employees.filter(e=>(!filters.employeeKey||e.key===filters.employeeKey)&&(filters.status!=='pending'||rows.some(r=>r.employee_key===e.key)));
  host.innerHTML=`<div class="row spread"><div><p class="eyebrow">SUIVI DES DOSSIERS EMPLOYÉS</p><h2>Mesures disciplinaires</h2></div><button id="newDiscipline">Rédiger une mesure / ajouter un PDF</button></div>
   <section class="discipline-hero"><p>Un repère rapide par employé. Le palier évolue uniquement après approbation de la direction.</p><div class="discipline-legend" aria-label="Légende de la gradation"><span class="discipline-badge verbal">Vert · 3 avis verbaux</span><span class="discipline-badge written">Jaune · 2 avis écrits</span><span class="discipline-badge suspension">Rouge · suspensions</span><span class="discipline-badge final">Violet · avis final / ultimatum</span><span class="discipline-badge termination">Bordeaux · congédiement</span></div><details><summary>Les 11 paliers dans l’ordre</summary><ol class="discipline-scale">${disciplineSteps.map(s=>'<li class="'+s.tone+'">'+esc(s.label)+'</li>').join('')}</ol></details></section>
   <div class="discipline-stats"><button id="allDiscipline">${employees.length}<small>Employés accessibles</small></button><button id="pendingDiscipline">${current.measures.filter(r=>r.approval?.status==='pending').length}<small>À approuver</small></button><button id="historicDiscipline">${current.measures.filter(r=>r.status==='filed'&&!r.approval).length}<small>Avis historiques non gradués</small></button></div>
   <div class="filters"><label>Employé<select id="disciplinePerson"><option value="">Tous les employés autorisés</option>${employees.map(e=>'<option value="'+esc(e.key)+'" '+(e.key===filters.employeeKey?'selected':'')+'>'+esc(e.name)+'</option>').join('')}</select></label>
   <label>État<select id="disciplineStatus"><option value="">Tous les états</option>${options({...data.statuses,pending:'À approuver'},filters.status)}</select></label></div>
   <div class="discipline-cards">${visiblePeople.map(e=>{const notices=current.measures.filter(r=>r.employee_key===e.key),level=Math.max(0,...notices.filter(r=>r.status==='filed'&&r.approval?.status==='approved').map(r=>r.approval.level)),pending=notices.find(r=>r.approval?.status==='pending');return `<article class="discipline-card"><h3>${esc(e.name)}</h3>${pill(level)}<ol class="discipline-track" aria-label="Palier approuvé ${level} sur 11">${disciplineSteps.map(s=>`<li class="${s.level<=level?s.tone:'future'}" ${s.level===level?'aria-current="step"':''} title="${esc(s.label)}">${s.level}<span class="sr-only"> ${esc(s.label)}</span></li>`).join('')}</ol>${pending?'<p class="discipline-pending">À approuver : '+esc(disciplineSteps[pending.approval.level-1].label)+'</p>':'<p>'+(!level&&notices.some(r=>r.status==='filed'&&!r.approval)?'Historique à examiner avant le prochain avis.':'Palier approuvé dans les avis accessibles.')+'</p>'}<button class="secondary" data-person="${esc(e.key)}">Voir les avis</button>${pending?'<button data-measure="'+esc(pending.id)+'">'+(current.canApprove?'Examiner et décider':'Voir l’avis en attente')+'</button>':''}</article>`;}).join('')}</div><h3>Avis et pièces au dossier</h3>
   <div class="cards">${rows.map(r=>`<article class="card"><p class="eyebrow">${esc(r.approval?reviewLabel[r.approval.status]:data.statuses[r.status])} · ${esc(fmt(r.occurred_on))}</p>${r.approval?pill(r.approval.level):r.status==='filed'?'<span class="badge">Historique · non gradué</span>':''}<h3>${esc(r.title)}</h3><p>${esc(person(r.employee_key)?.name)}<br>${esc(data.types[r.measure_type])}</p>${r.follow_up_on?'<p>Suivi : '+esc(fmt(r.follow_up_on))+'</p>':''}<button data-measure="${esc(r.id)}" class="secondary">Ouvrir la mesure</button></article>`).join('')||'<section class="panel"><h3>Aucune mesure dans cette sélection</h3><p>Utilisez le bouton ci-dessus pour rédiger une mesure ou classer un avis PDF.</p></section>'}</div>`;
  host.querySelector('#allDiscipline').onclick=action(async()=>{filters={employeeKey:'',status:''};await list();});
  host.querySelector('#pendingDiscipline').onclick=action(async()=>{filters.status='pending';await list();});
  host.querySelector('#historicDiscipline').onclick=action(async()=>{filters.status='filed';await list();});
  host.querySelectorAll('[data-person]').forEach(b=>b.onclick=action(async()=>{filters.employeeKey=b.dataset.person;await list();}));
  host.querySelector('#newDiscipline').onclick=()=>edit();
  host.querySelector('#disciplinePerson').onchange=action(async e=>{filters.employeeKey=e.target.value;await list();});
  host.querySelector('#disciplineStatus').onchange=action(async e=>{filters.status=e.target.value;await list();});
  host.querySelectorAll('[data-measure]').forEach(button=>button.onclick=action(()=>detail(button.dataset.measure)));
 }
 async function detail(id){
  const d=await api(path+'/'+id),r=d.measure;
  const textSection=(title,value)=>`<section class="panel"><h3>${title}</h3><p style="white-space:pre-wrap">${esc(value||'Non précisé')}</p></section>`;
  host.innerHTML=`<div class="row spread"><div><button id="disciplineBack" class="secondary">← Mesures disciplinaires</button><h2>${esc(r.title)}</h2><p>${esc(d.employee.name)} · ${esc(data.types[r.measure_type])} · ${esc(fmt(r.occurred_on))}</p><p><strong>${esc(data.statuses[r.status])}</strong> · Version ${r.version}</p></div><div class="actions"><a class="button secondary" href="${apiUrl(path+'/'+id+'/pdf')}">Télécharger le PDF</a>${r.status!=='withdrawn'?'<button id="editDiscipline">'+(r.status==='draft'?'Modifier le brouillon':'Corriger la mesure')+'</button><button id="withdrawDiscipline" class="secondary">Retirer la mesure</button>':''}</div></div>
   ${textSection('Faits observés',r.facts)}${textSection('Attentes et suivi',r.expectations)}<p>Suivi prévu : ${r.follow_up_on?esc(fmt(r.follow_up_on)):'Non précisé'}</p>
   <section class="panel"><h3>Pièces PDF</h3>${d.attachments.map(file=>`<p><a href="${apiUrl(path+'/'+id+'/attachments/'+file.id)}">${esc(file.name)}</a> · ${Math.ceil(file.size/1024)} Ko · ${esc(fmt(file.created_at))}</p>`).join('')||'<p>Aucune pièce jointe.</p>'}
   ${r.status!=='withdrawn'?'<form id="disciplineUpload"><label>Joindre un avis ou une pièce PDF (12 Mo maximum)<input type="file" name="pdf" accept="application/pdf,.pdf" required></label><button>Joindre le PDF</button><p role="status" id="disciplineUploadStatus"></p></form>':''}</section>
   <section class="panel"><h3>Historique conservé</h3>${d.history.map(v=>`<details><summary>Version ${v.version} · ${esc(data.statuses[v.status])} · ${esc(fmt(v.created_at))} · ${esc(v.actor.name)}</summary><p>Objet : ${esc(v.title)}<br>Date : ${esc(v.occurred_on)}<br>Type : ${esc(data.types[v.measure_type])}<br>Suivi : ${esc(v.follow_up_on||'Non précisé')}</p><p style="white-space:pre-wrap">${esc(v.facts)}</p><p style="white-space:pre-wrap">${esc(v.expectations)}</p><p>Motif : ${esc(v.reason||'Création / brouillon')}</p></details>`).join('')}</section>`;
  host.querySelector('#disciplineBack').onclick=action(list);
  if(!d.approval&&r.status==='filed'&&data.canApprove){const baseline=document.createElement('section');baseline.className='panel';baseline.innerHTML='<h3>Classer l’avis historique</h3><p>Validez le palier déjà atteint avant de soumettre de nouveaux événements. L’original reste conservé.</p><form id="disciplineBaseline"><label>Palier existant<select name="level" required><option value="">Choisir le palier</option>'+disciplineSteps.map(s=>'<option value="'+s.level+'">'+esc(s.label)+'</option>').join('')+'</select></label>'+area('Justification du classement','note','',true,2000)+'<button>Approuver ce palier historique</button></form>';host.querySelector('.row').after(baseline);host.querySelector('#disciplineBaseline').onsubmit=action(async ev=>{const b=ev.target.querySelector('button');b.disabled=true;try{await api(path+'/'+id+'/baseline',{version:r.version,...Object.fromEntries(new FormData(ev.target))});await detail(id);}finally{b.disabled=false;}});}
  if(d.approval){const panel=document.createElement('section');panel.className='panel';panel.innerHTML=`${pill(d.approval.level)}<h3>${esc(reviewLabel[d.approval.status])}</h3><p>Courriel : ${esc({pending:'en attente d’envoi',sending:'envoi en cours / nouvelle tentative',sent:'accepté par le service d’envoi',review:'envoi à vérifier'}[d.approval.mail_status]||d.approval.mail_status)}</p>${d.approval.decision_actor?'<p>Décision : '+esc(d.approval.decision_actor.name)+' · '+esc(fmt(d.approval.decided_at))+'</p><p>'+esc(d.approval.decision_note)+'</p>':''}${d.approval.status==='pending'&&data.canApprove?'<form id="disciplineDecision">'+area('Note de décision (obligatoire pour refuser)','note','',false,2000)+'<button name="decision" value="approved">Approuver ce palier</button> <button name="decision" value="rejected" class="secondary">Refuser</button></form>':''}`;host.querySelector('.row').after(panel);
   if(['pending','approved'].includes(d.approval.status)){host.querySelector('#editDiscipline')?.remove();if(!data.canApprove)host.querySelector('#withdrawDiscipline')?.remove();}
   host.querySelector('#disciplineDecision')?.addEventListener('submit',action(async ev=>{const buttons=[...ev.target.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await api(path+'/'+id+'/decision',{version:r.version,status:ev.submitter.value,note:ev.target.elements.note.value});await detail(id);notice('Décision enregistrée.');}finally{buttons.forEach(b=>b.disabled=false);}}));
  }
  host.querySelector('#editDiscipline')?.addEventListener('click',()=>edit(r));
  host.querySelector('#withdrawDiscipline')?.addEventListener('click',()=>{
   modal('Retirer la mesure',`<form id="disciplineWithdraw"><p>La mesure portera la mention « Retirée ». Les versions et les pièces resteront conservées.</p>${area('Motif du retrait','reason','',true,2000)}<button>Confirmer le retrait</button></form>`);
   document.querySelector('#disciplineWithdraw').onsubmit=action(async e=>{const b=e.target.querySelector('button');b.disabled=true;try{await api(path+'/'+id+'/revisions',{version:r.version,status:'withdrawn',reason:new FormData(e.target).get('reason')});saved();await detail(id);}finally{b.disabled=false;}});
  });
  host.querySelector('#disciplineUpload')?.addEventListener('submit',action(async e=>{
   const button=e.target.querySelector('button');button.disabled=true;
   try{host.querySelector('#disciplineUploadStatus').textContent='Transfert en cours…';await depositDocument(e.target.elements.pdf.files[0],apiUrl(path+'/'+id+'/attachments',{version:r.version}),'X-Employee-Files');await detail(id);notice('PDF joint au dossier.');}finally{button.disabled=false;}
  }));
 }
 await list();
}

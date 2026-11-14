export async function renderDiscipline({api,apiUrl,state,esc,fmt,modal,action,saved,notice,depositDocument,employeeKey=''}){
 const host=document.querySelector('#content');
 let employees=state.employees;const person=key=>employees.find(e=>e.key===key);
 const path='discipline',today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let filters={employeeKey,status:''};
 const data=await api(path);
 employees=employees.filter(e=>data.employeeKeys.includes(e.key));
 const field=(label,name,value='',type='text',required=false,max=180)=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} maxlength="${max}"></label>`;
 const area=(label,name,value='',required=false,max=12000)=>`<label>${label}<textarea name="${name}" rows="5" maxlength="${max}" ${required?'required':''}>${esc(value)}</textarea></label>`;
 const options=(values,selected)=>Object.entries(values).map(([id,label])=>`<option value="${esc(id)}" ${id===selected?'selected':''}>${esc(label)}</option>`).join('');
 function edit(previous){
  const people=employees.filter(e=>e.active&&!e.issue);
  modal(previous?'Corriger la mesure':'Nouvelle mesure disciplinaire',`<form id="disciplineEdit"><div class="form-grid">
   ${previous?'<p><strong>'+esc(person(previous.employee_key)?.name)+'</strong> · Version '+previous.version+'</p>':'<label>Employé<select name="employeeKey" required><option value="">Choisir un employé</option>'+people.map(e=>'<option value="'+esc(e.key)+'" '+(e.key===filters.employeeKey?'selected':'')+'>'+esc(e.name)+'</option>').join('')+'</select></label>'}
   ${field('Date de la mesure','occurredOn',previous?.occurred_on||today(),'date',true)}
   <label>Type de mesure<select name="measureType">${options(data.types,previous?.measure_type||'written')}</select></label>
   ${field('Objet','title',previous?.title||'','text',true)}
   </div>${area('Faits observés','facts',previous?.facts)}${area('Attentes et suivi convenus','expectations',previous?.expectations,false,6000)}
   ${field('Date de suivi (facultative)','followUpOn',previous?.follow_up_on||'','date')}
   <label>État<select name="status">${options(previous?.status==='filed'?{filed:'Au dossier'}:{draft:'Brouillon',filed:'Au dossier'},previous?.status||'draft')}</select></label>
   ${previous?area('Motif de la correction','reason','',previous.status==='filed',2000):''}
   <p class="muted">Vous pourrez joindre les PDF après l’enregistrement. Le classement n’envoie aucun avis à l’employé.</p>
   <button>Enregistrer ${previous?'la nouvelle version':'la mesure'}</button></form>`);
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
  const current=await api(path),rows=current.measures.filter(r=>(!filters.employeeKey||r.employee_key===filters.employeeKey)&&(!filters.status||r.status===filters.status));
  host.innerHTML=`<div class="row spread"><div><p class="eyebrow">SUIVI DES DOSSIERS EMPLOYÉS</p><h2>Mesures disciplinaires</h2></div><button id="newDiscipline">Rédiger une mesure / ajouter un PDF</button></div>
   <p>Rédigez les faits, consignez le suivi et conservez les avis PDF dans le dossier de l’employé. Les mesures restent accessibles à la direction et aux gérants autorisés pour ce département.</p>
   <div class="filters"><label>Employé<select id="disciplinePerson"><option value="">Tous les employés autorisés</option>${employees.map(e=>'<option value="'+esc(e.key)+'" '+(e.key===filters.employeeKey?'selected':'')+'>'+esc(e.name)+'</option>').join('')}</select></label>
   <label>État<select id="disciplineStatus"><option value="">Tous les états</option>${options(data.statuses,filters.status)}</select></label></div>
   <div class="cards">${rows.map(r=>`<article class="card"><p class="eyebrow">${esc(data.statuses[r.status])} · ${esc(fmt(r.occurred_on))}</p><h3>${esc(r.title)}</h3><p>${esc(person(r.employee_key)?.name)}<br>${esc(data.types[r.measure_type])}</p>${r.follow_up_on?'<p>Suivi : '+esc(fmt(r.follow_up_on))+'</p>':''}<button data-measure="${esc(r.id)}" class="secondary">Ouvrir la mesure</button></article>`).join('')||'<section class="panel"><h3>Aucune mesure dans cette sélection</h3><p>Utilisez le bouton ci-dessus pour rédiger une mesure ou classer un avis PDF.</p></section>'}</div>`;
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

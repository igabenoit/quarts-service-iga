import {emailPaper} from './sst-email-paper.js';
import {emptyTrainingForm,FORM_SIGNERS} from './training-form-schema.js';
import {trainingTasks,topics} from './equipment-training-sheet.js';
for(const href of ['/incident-report.css','/training-form.css']){if(!document.querySelector('link[href="'+href+'"]')){const l=document.createElement('link');l.rel='stylesheet';l.href=href;document.head.append(l);}}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let dialog,ctx,model,prior,dirty=false,busy=false,requestId='',editing=true;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
export function canLeaveForm(){return !dirty||confirm('Quitter ce formulaire sans enregistrer les modifications ?');}
export function clearForm(){dialog?.close();dirty=false;}
function message(text,error=false){const el=dialog.querySelector('[data-tf-message]');el.textContent=text;el.setAttribute('role',error?'alert':'status');if(error)el.scrollIntoView({block:'center'});}
const field=(key,label,value,edit,type='text',multi=false)=>`<label class="ir-field"><span>${esc(label)}</span>${edit?(multi?`<textarea data-tf="${key}" maxlength="6000" rows="4">${esc(value)}</textarea>`:`<input data-tf="${key}" type="${type}" value="${esc(value)}" maxlength="${['reference','note','immediate'].includes(key)?1000:120}">`):`<div class="ir-value">${esc(value)||'—'}</div>`}</label>`;
function svg(strokes){return `<svg class="ir-signature-image" viewBox="0 0 1000 260" role="img" aria-label="Signature manuscrite">${strokes.map(s=>s.length===1?`<circle cx="${s[0][0]}" cy="${s[0][1]*.26}" r="3"/>`:`<polyline points="${s.map(([x,y])=>x+','+y*.26).join(' ')}" fill="none" stroke="#17302c" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;}
function formStateLabel(data){
 return data.status==='completed'?'Formation consignée et signée':data.date>today()?'Formation planifiée':'Brouillon à compléter';
}
function updateDateDisplay(){
 const planned=model.date>today();
 const draft=dialog.querySelector('[data-tf-save="draft"]');
 const finalize=dialog.querySelector('[data-tf-save="completed"]');
 const state=dialog.querySelector('[data-tf-state]');
 if(draft)draft.textContent=planned?'Enregistrer la formation planifiée':'Enregistrer le brouillon';
 if(finalize)finalize.hidden=planned;
 if(state)state.textContent=formStateLabel(model);
}
export function trainingFormPaper(data,{equipment,employeeName,task,department,procedures=[],guides=[]},edit=false){
 const f=(key,label,type='text',multi=false)=>field(key,label,data[key],edit,type,multi);
 const p=procedures.find(x=>x.id===data.procedureId);
 const guide=guides.find(g=>g.id===data.guideRevision);
 const choices=[['explained','Explications données'],['demonstrated','Démonstration faite par le formateur'],['practiced','Mise en pratique par l’employé'],['questions','Questions et compréhension vérifiées']];
 const results={unobserved:'Non observé',ok:'Maîtrisé / observé satisfaisant',review:'À revoir'};
 return `<div class="ir-document tf-document"><section class="ir-page"><h2 class="ir-document-title">Fiche de formation à un équipement</h2><p>IGA Extra Famille Benoit · <span data-tf-state>${formStateLabel(data)}</span></p>
 <h3 class="ir-band">1. Identification</h3><div class="ir-two ir-bordered">${field('equipment','Appareil',equipment.title,false)}${field('model','Fabricant et modèle',equipment.fields?.model,false)}${field('serial','Numéro de série',equipment.fields?.serial,false)}${field('department','Département / emplacement',department+' · '+(equipment.fields?.location||''),false)}
 ${edit?`<label class="ir-field"><span>Employé</span><select data-tf-person ${prior?'disabled':''}><option value="">Choisir un employé</option>${ctx.employees.map(e=>`<option value="${esc(e.key)}" ${e.key===model.employeeKey?'selected':''}>${esc(e.name)}</option>`).join('')}</select></label>`:field('employee','Employé',employeeName,false)}${field('task','Tâche couverte par cette fiche',task,false)}${f('date',data.status==='completed'?'Date de formation':'Date de formation (prévue ou réalisée)','date')}${f('trainer','Nom du formateur')}</div>
 <h3 class="ir-band">2. Formation donnée</h3><div class="ir-bordered"><div class="ir-cell">${choices.map(([k,label])=>`<label class="ir-check">${edit?`<input type="checkbox" data-tf="${k}" ${data[k]?'checked':''}>`:data[k]?'☑':'☐'} ${label}</label>`).join('')}</div>${f('reference','Document ou méthode réellement utilisé')}${f('version','Version / révision (si connue)')}${f('content','Contenu enseigné, explications et démonstration','text',true)}<div class="ir-cell"><p>Repères pour préparer le contenu (à adapter à la procédure de cet appareil) :</p>${data.guideRevision&&guide?`<p><a href="/sst#file=${esc(guide.data.documentId)}" target="_blank" rel="noopener">${esc(guide.data.title)}</a></p>`:''}<ul>${((guide&&guide.data.criteria.filter(c=>c.task===task).map(c=>c.text+' ('+c.reference+')'))||topics[task]||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></div>
 <h3 class="ir-band">3. Observation pratique</h3><div class="ir-bordered"><div class="ir-cell"><p>La formation et les signatures ne valident pas automatiquement la pratique. Les points non observés restent indiqués comme tels.</p></div>${edit?`<label class="ir-field"><span>Fiche de référence ou procédure pour les critères pratiques</span><select data-tf="procedureId"><option value="">Aucune — observation pratique non évaluée</option>${procedures.map(x=>`<option value="${x.id}" ${data.procedureId===x.id?'selected':''}>${esc(x.data.title)} · ${esc(x.data.version)}</option>`).join('')}</select></label>`:field('procedure','Procédure des critères pratiques',p?p.data.title+' · '+p.data.version:'Aucune — observation pratique non évaluée',false)}<div class="ir-two">${f('observationDate','Date réelle d’observation','date')}${f('supervisor','Nom du superviseur')}</div>
 ${data.points.length?data.points.map((x,i)=>`<div class="ir-cell"><strong>${esc(x.text)}</strong><p>${esc(x.reference)}</p>${edit?`<label class="ir-field"><span>Résultat — point ${i+1}</span><select data-tf-point="${i}">${Object.entries(results).map(([k,v])=>`<option value="${k}" ${x.result===k?'selected':''}>${v}</option>`).join('')}</select></label>${field('pointnote:'+i,'Note sur ce point',x.note,true,'text',true)}`:`<p>${esc(results[x.result])}</p><p>${esc(x.note)}</p>`}</div>`).join(''):'<p class="ir-cell">Aucun critère approuvé sélectionné. Vous pouvez consigner la formation réellement donnée; l’évaluation pratique reste « À vérifier ».</p>'}${f('note','Observations complémentaires / limites','text',true)}</div></section>
 <section class="ir-page"><h3 class="ir-band">4. Mesures et suivi</h3><div class="ir-bordered">${f('immediate','Mesure immédiate / formation complémentaire','text',true)}<div class="ir-two">${f('owner','Responsable du suivi')}${f('dueDate','Échéance du suivi','date')}</div></div>
 <h3 class="ir-band">5. Confirmations et signatures</h3><div class="ir-bordered">${FORM_SIGNERS.map(([key,label])=>`<section class="ir-signer"><div class="ir-cell"><strong>${label}</strong><p>${key==='employee'?'Je confirme avoir reçu la formation décrite et avoir eu la possibilité de poser mes questions. Ma signature ne signifie pas que je maîtrise une tâche non observée.':'Je confirme avoir donné la formation décrite. Les observations pratiques consignées correspondent à ce qui a réellement été observé par le superviseur identifié.'}</p></div><div class="ir-signature-meta"><div class="tf-name-${key}">${field(key+'Name','Nom',key==='employee'?employeeName:data.trainer,false)}</div>${f(key+'Date','Date de signature','date')}</div><div class="ir-signature" data-tf-signature="${key}">${edit?`<canvas width="800" height="208" aria-label="Signature manuscrite — ${label}"></canvas><div class="ir-pad-actions"><small>Signer au doigt, au stylet ou à la souris.</small><button type="button" class="ir-clear" data-tf-clear="${key}">Effacer la signature ${label.toLowerCase()}</button></div>`:data.signatures[key]?.length?svg(data.signatures[key]):'<div class="ir-signature-empty">Signature : ______________________________</div>'}</div></section>`).join('')}</div><p class="ir-note">Signatures manuscrites recueillies sur ce formulaire. Le compte qui enregistre la fiche est conservé séparément dans la chronologie.</p></section></div>`;
}
function paper(edit){return trainingFormPaper(model,{...ctx,employeeName:ctx.employees.find(e=>e.key===model.employeeKey)?.name||'',task:ctx.task},edit);}
export function openTrainingForm(options){
 if(!canLeaveForm())return;
 ctx=options;prior=options.prior||null;model={...emptyTrainingForm(),...(prior?structuredClone(prior.data):{}),employeeKey:prior?.data.employeeKeys[0]||options.employeeKey||''};if(!prior&&options.guide)applyGuide();dirty=false;editing=prior?.data.status!=='completed';requestId=crypto.randomUUID();
 if(!document.querySelector('link[href="/incident-report.css"]')){const l=document.createElement('link');l.rel='stylesheet';l.href='/incident-report.css';document.head.append(l);}
 if(!document.querySelector('link[href="/training-form.css"]')){const l=document.createElement('link');l.rel='stylesheet';l.href='/training-form.css';document.head.append(l);}
 if(!dialog){dialog=document.createElement('dialog');dialog.className='ir-dialog';dialog.setAttribute('aria-label','Formulaire de formation à un équipement');document.body.append(dialog);dialog.addEventListener('cancel',e=>{e.preventDefault();if(!busy&&canLeaveForm())clearForm();});}
 render();dialog.showModal();
}
function applyGuide(){
 const guide=ctx.guide;
 model.reference=guide.data.title;model.version=guide.data.version;
 model.guideRevision=guide.id;model.procedureId=guide.id;
 model.points=guide.data.criteria.filter(c=>c.task===ctx.task).map(c=>({...c,result:'unobserved',note:''}));
}
function render(){
 dialog.innerHTML=`<div class="ir-toolbar"><strong>Formation à un équipement</strong>${editing?'<button type="button" class="button primary" data-tf-save="draft">Enregistrer le brouillon</button><button type="button" class="button primary" data-tf-save="completed">Finaliser et conserver les signatures</button>':'<button type="button" class="button secondary" data-tf-correct>Corriger cette fiche</button>'}<button type="button" class="button primary" data-tf-email>Envoyer par courriel</button><button type="button" class="button secondary" data-tf-print>Imprimer / PDF</button>${prior&&ctx.onDelete?'<button type="button" class="quiet" data-tf-delete>Supprimer</button>':''}${prior?'<button type="button" class="button secondary" data-tf-new>Nouvelle formation</button>':''}<button type="button" class="quiet" data-tf-close>Fermer</button></div><p data-tf-message role="status">${prior?'Fiche enregistrée. Une correction conserve la version précédente.':'Nouveau formulaire — remplir, puis faire signer.'}</p>${prior&&editing?'<label class="ir-correction">Motif de la correction<input data-tf="correctionReason" maxlength="1000" value="'+esc(model.correctionReason||'')+'"></label>':''}${editing&&ctx.guide&&ctx.guide.id!==model.guideRevision?'<button type="button" class="button secondary" data-tf-guide>Utiliser la fiche de référence actuelle</button>':''}${paper(editing)}`;
 if(editing)updateDateDisplay();
 dialog.oninput=e=>{const el=e.target,key=el.dataset.tf;
  if(!key&&!el.hasAttribute('data-tf-person')&&!el.hasAttribute('data-tf-point'))return;
  if(key==='correctionReason'){model.correctionReason=el.value;dirty=true;return;}
  const value=el.type==='checkbox'?el.checked:el.value;
  const old=el.hasAttribute('data-tf-person')?model.employeeKey:el.hasAttribute('data-tf-point')?model.points[Number(el.dataset.tfPoint)].result:key.startsWith('pointnote:')?model.points[Number(key.split(':')[1])].note:model[key];
  if(old===value)return;
  // Dates are completed along with signatures while the form is still a draft.
  // Native date pickers can emit an empty intermediate value: never erase ink here.
  if(el.type==='date'&&prior?.data.status!=='completed'){
   model[key]=value;model.status='draft';dirty=true;
   if(key==='date')updateDateDisplay();
   message(key==='date'&&value>today()?'Formation prévue le '+value+'. Vous pouvez maintenant l’enregistrer.':'Date modifiée — vos signatures sont conservées.');return;
  }
  const had=Object.values(model.signatures).some(x=>x.length);
  if(had&&!confirm('Modifier le contenu signé exige de refaire les signatures. Continuer ?')){if(el.type==='checkbox')el.checked=old;else el.value=old;return;}
  model.signatures={employee:[],trainer:[]};model.status='draft';dirty=true;
  if(el.hasAttribute('data-tf-person')){model.employeeKey=el.value;render();}
  else if(el.hasAttribute('data-tf-point'))model.points[Number(el.dataset.tfPoint)].result=el.value;
  else if(key.startsWith('pointnote:'))model.points[Number(key.split(':')[1])].note=el.value;
  else model[key]=el.type==='checkbox'?el.checked:el.value;
  if(key==='procedureId'){const p=ctx.procedures.find(x=>x.id===model.procedureId);model.points=(p?.data.criteria||[]).filter(x=>x.task===ctx.task).map(x=>({...x,result:'unobserved',note:''}));render();}
  if(key==='trainer'){const el=dialog.querySelector('.tf-name-trainer .ir-value');if(el)el.textContent=model.trainer||'—';}
  if(key==='date')updateDateDisplay();
  redraw();message(had?'Le contenu a changé : faites signer à nouveau cette version.':'Modifications à enregistrer.');
 };
 dialog.onclick=async e=>{const b=e.target.closest('button');if(!b||busy)return;const d=b.dataset;
  if('tfDelete'in d){busy=true;try{await ctx.onDelete(prior.id);}catch(err){message(err.message,true);}finally{busy=false;}return;}
  if('tfGuide'in d){
   if(Object.values(model.signatures).some(s=>s.length)&&!confirm('Changer la fiche de référence effacera les signatures de cette version. Continuer ?'))return;
   applyGuide();model.signatures={employee:[],trainer:[]};model.employeeDate='';model.trainerDate='';model.status='draft';dirty=true;render();return;
  }
  if('tfCorrect'in d){editing=true;render();return;}
  if('tfNew'in d){if(canLeaveForm()){const options={...ctx,prior:null,employeeKey:model.employeeKey};clearForm();openTrainingForm(options);}return;}
  if('tfClose'in d){if(canLeaveForm())clearForm();}
  if(d.tfClear){model.signatures[d.tfClear]=[];dirty=true;redraw();}
  if('tfPrint'in d||'tfEmail'in d){document.getElementById('sstPrint').innerHTML=(dirty||!prior?'<p class="ir-print-warning">Brouillon / modifications non enregistrées</p>':'')+paper(false);if('tfEmail'in d)emailPaper('Formation à un équipement');else window.print();}
  if(d.tfSave)await save(d.tfSave);
 };
 setupPads();
}
function draw(canvas,strokes){const c=canvas.getContext('2d');c.clearRect(0,0,800,208);c.lineWidth=2.8;c.strokeStyle=c.fillStyle='#17302c';c.lineCap=c.lineJoin='round';for(const stroke of strokes){c.beginPath();stroke.forEach(([x,y],i)=>i?c.lineTo(x*.8,y*.208):c.moveTo(x*.8,y*.208));if(stroke.length===1){c.arc(stroke[0][0]*.8,stroke[0][1]*.208,1.4,0,Math.PI*2);c.fill();}else c.stroke();}}
function redraw(){for(const canvas of dialog.querySelectorAll('canvas'))draw(canvas,model.signatures[canvas.closest('[data-tf-signature]').dataset.tfSignature]);}
function setupPads(){for(const canvas of dialog.querySelectorAll('canvas')){const key=canvas.closest('[data-tf-signature]').dataset.tfSignature;let pointer=null,stroke;
 const add=e=>{if(model.signatures[key].reduce((n,s)=>n+s.length,0)>=600)return;const r=canvas.getBoundingClientRect(),p=[Math.round(Math.max(0,Math.min(1000,(e.clientX-r.left)/r.width*1000))),Math.round(Math.max(0,Math.min(1000,(e.clientY-r.top)/r.height*1000)))];const last=stroke.at(-1);if(!last||Math.abs(last[0]-p[0])+Math.abs(last[1]-p[1])>3)stroke.push(p);draw(canvas,model.signatures[key]);};
 canvas.onpointerdown=e=>{if(busy||pointer!==null||e.button!==0)return;e.preventDefault();
  // Set both visible signature dates before the first stroke, without invalidating the other signer.
  for(const [signer] of FORM_SIGNERS)if(!model[signer+'Date']){model[signer+'Date']=today();dialog.querySelector('[data-tf="'+signer+'Date"]').value=model[signer+'Date'];}
if(model.signatures[key].length>=60||model.signatures[key].reduce((n,s)=>n+s.length,0)>=600){message('Effacez cette signature pour la reprendre.');return;}pointer=e.pointerId;canvas.setPointerCapture(pointer);stroke=[];model.signatures[key].push(stroke);add(e);dirty=true;message('Signature saisie — enregistrez le formulaire.');};
 canvas.onpointermove=e=>{if(pointer===e.pointerId)add(e);};const end=e=>{if(pointer===e.pointerId){pointer=null;stroke=null;}};canvas.onpointerup=end;canvas.onpointercancel=end;
 }redraw();}
async function save(status){
 if(!model.employeeKey){message('Choisissez l’employé concerné.',true);return;}
 if(status==='completed'){
  if(model.date>today()){message('Pour conserver cette fiche, cliquez sur « Enregistrer la formation planifiée ».',true);return;}
  const required=[['date','la date réelle de formation'],['trainer','le nom du formateur'],['reference','le document ou la méthode utilisé'],['content','le contenu enseigné']];
  const missing=required.filter(([key])=>!model[key]?.trim()).map(([,label])=>label);
  for(const [key,label] of FORM_SIGNERS)if(!model.signatures[key].length)missing.push('la signature : '+label);
  if(missing.length){message('Pour finaliser, complétez '+missing.join(', ')+'. Vos signatures sont conservées.',true);return;}
 }
 if(prior?.data.status===status&&!dirty){message(status==='completed'?'Ce formulaire est déjà finalisé.':'Ce brouillon est déjà enregistré.');return;}
 if(prior?.data.status==='draft'&&status==='completed'&&!model.correctionReason?.trim())model.correctionReason='Finalisation du brouillon';
 if(prior&&!model.correctionReason?.trim()){message('Indiquez le motif de la correction.',true);return;}
 busy=true;dialog.querySelectorAll('button,input,select,textarea').forEach(x=>x.disabled=true);
 try{const data={...model,status,employeeKeys:[model.employeeKey],tasks:[ctx.task],enteredBy:ctx.actorName};delete data.employeeKey;delete data.correctionReason;
 const entry=await ctx.save({id:requestId,kind:'training_form',equipmentId:ctx.equipment.id,data,...(prior?{supersedes:prior.id,correctionReason:model.correctionReason}:{})});prior=entry.entry;model={...model,...structuredClone(prior.data),correctionReason:''};requestId=crypto.randomUUID();dirty=false;editing=status!=='completed';render();message(status==='completed'?'Formulaire finalisé — les deux signatures sont conservées.':model.date>today()?'Formation planifiée pour le '+model.date+'.':'Brouillon enregistré.');try{await ctx.onSaved(prior);}catch{message('Formulaire enregistré. Le tableau n’a pas pu être actualisé; rechargez-le après avoir fermé la fiche.');}
 }catch(e){message(e.message+' Le formulaire et les signatures restent disponibles; corrigez les champs indiqués puis réessayez.',true);}finally{busy=false;dialog.querySelectorAll('button,input,select,textarea').forEach(x=>x.disabled=false);const p=dialog.querySelector('[data-tf-person]');if(p&&prior)p.disabled=true;}
}

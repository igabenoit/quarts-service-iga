import {emptyTrainingForm,FORM_SIGNERS} from './training-form-schema.js';
import {trainingTasks,topics} from './equipment-training-sheet.js';
for(const href of ['/incident-report.css','/training-form.css']){if(!document.querySelector('link[href="'+href+'"]')){const l=document.createElement('link');l.rel='stylesheet';l.href=href;document.head.append(l);}}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let dialog,ctx,model,prior,dirty=false,busy=false,requestId='';
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
export function canLeaveForm(){return !dirty||confirm('Quitter ce formulaire sans enregistrer les modifications ?');}
export function clearForm(){dialog?.close();dirty=false;}
function message(text){dialog.querySelector('[data-tf-message]').textContent=text;}
const field=(key,label,value,edit,type='text',multi=false)=>`<label class="ir-field"><span>${esc(label)}</span>${edit?(multi?`<textarea data-tf="${key}" maxlength="6000" rows="4">${esc(value)}</textarea>`:`<input data-tf="${key}" type="${type}" value="${esc(value)}" maxlength="${['reference','note','immediate'].includes(key)?1000:120}">`):`<div class="ir-value">${esc(value)||'—'}</div>`}</label>`;
function svg(strokes){return `<svg class="ir-signature-image" viewBox="0 0 1000 260" role="img" aria-label="Signature manuscrite">${strokes.map(s=>s.length===1?`<circle cx="${s[0][0]}" cy="${s[0][1]*.26}" r="3"/>`:`<polyline points="${s.map(([x,y])=>x+','+y*.26).join(' ')}" fill="none" stroke="#17302c" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;}
export function trainingFormPaper(data,{equipment,employeeName,task,department,procedures=[]},edit=false){
 const f=(key,label,type='text',multi=false)=>field(key,label,data[key],edit,type,multi);
 const p=procedures.find(x=>x.id===data.procedureId);
 const choices=[['explained','Explications données'],['demonstrated','Démonstration faite par le formateur'],['practiced','Mise en pratique par l’employé'],['questions','Questions et compréhension vérifiées']];
 const results={unobserved:'Non observé',ok:'Maîtrisé / observé satisfaisant',review:'À revoir'};
 return `<div class="ir-document tf-document"><section class="ir-page"><h2 class="ir-document-title">Fiche de formation à un équipement</h2><p>IGA Extra Famille Benoit · ${data.status==='completed'?'Formation consignée et signée':'Brouillon à compléter'}</p>
 <h3 class="ir-band">1. Identification</h3><div class="ir-two ir-bordered">${field('equipment','Appareil',equipment.title,false)}${field('model','Fabricant et modèle',equipment.fields?.model,false)}${field('serial','Numéro de série',equipment.fields?.serial,false)}${field('department','Département / emplacement',department+' · '+(equipment.fields?.location||''),false)}
 ${edit?`<label class="ir-field"><span>Employé</span><select data-tf-person ${prior?'disabled':''}><option value="">Choisir un employé</option>${ctx.employees.map(e=>`<option value="${esc(e.key)}" ${e.key===model.employeeKey?'selected':''}>${esc(e.name)}</option>`).join('')}</select></label>`:field('employee','Employé',employeeName,false)}${field('task','Tâche couverte par cette fiche',task,false)}${f('date','Date réelle de formation','date')}${f('trainer','Nom du formateur')}</div>
 <h3 class="ir-band">2. Formation donnée</h3><div class="ir-bordered"><div class="ir-cell">${choices.map(([k,label])=>`<label class="ir-check">${edit?`<input type="checkbox" data-tf="${k}" ${data[k]?'checked':''}>`:data[k]?'☑':'☐'} ${label}</label>`).join('')}</div>${f('reference','Document ou méthode réellement utilisé')}${f('version','Version / révision (si connue)')}${f('content','Contenu enseigné, explications et démonstration','text',true)}<div class="ir-cell"><p>Repères pour préparer le contenu (à adapter à la procédure de cet appareil) :</p><ul>${(topics[task]||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></div>
 <h3 class="ir-band">3. Observation pratique</h3><div class="ir-bordered"><div class="ir-cell"><p>La formation et les signatures ne valident pas automatiquement la pratique. Les points non observés restent indiqués comme tels.</p></div>${edit?`<label class="ir-field"><span>Procédure approuvée pour les critères pratiques</span><select data-tf="procedureId"><option value="">Aucune — observation pratique non évaluée</option>${procedures.map(x=>`<option value="${x.id}" ${data.procedureId===x.id?'selected':''}>${esc(x.data.title)} · ${esc(x.data.version)}</option>`).join('')}</select></label>`:field('procedure','Procédure des critères pratiques',p?p.data.title+' · '+p.data.version:'Aucune — observation pratique non évaluée',false)}<div class="ir-two">${f('observationDate','Date réelle d’observation','date')}${f('supervisor','Nom du superviseur')}</div>
 ${data.points.length?data.points.map((x,i)=>`<div class="ir-cell"><strong>${esc(x.text)}</strong><p>${esc(x.reference)}</p>${edit?`<label class="ir-field"><span>Résultat — point ${i+1}</span><select data-tf-point="${i}">${Object.entries(results).map(([k,v])=>`<option value="${k}" ${x.result===k?'selected':''}>${v}</option>`).join('')}</select></label>${field('pointnote:'+i,'Note sur ce point',x.note,true,'text',true)}`:`<p>${esc(results[x.result])}</p><p>${esc(x.note)}</p>`}</div>`).join(''):'<p class="ir-cell">Aucun critère approuvé sélectionné. Vous pouvez consigner la formation réellement donnée; l’évaluation pratique reste « À vérifier ».</p>'}${f('note','Observations complémentaires / limites','text',true)}</div></section>
 <section class="ir-page"><h3 class="ir-band">4. Mesures et suivi</h3><div class="ir-bordered">${f('immediate','Mesure immédiate / formation complémentaire','text',true)}<div class="ir-two">${f('owner','Responsable du suivi')}${f('dueDate','Échéance du suivi','date')}</div></div>
 <h3 class="ir-band">5. Confirmations et signatures</h3><div class="ir-bordered">${FORM_SIGNERS.map(([key,label])=>`<section class="ir-signer"><div class="ir-cell"><strong>${label}</strong><p>${key==='employee'?'Je confirme avoir reçu la formation décrite et avoir eu la possibilité de poser mes questions. Ma signature ne signifie pas que je maîtrise une tâche non observée.':'Je confirme avoir donné la formation décrite. Les observations pratiques consignées correspondent à ce qui a réellement été observé par le superviseur identifié.'}</p></div><div class="ir-signature-meta"><div class="tf-name-${key}">${field(key+'Name','Nom',key==='employee'?employeeName:data.trainer,false)}</div>${f(key+'Date','Date de signature','date')}</div><div class="ir-signature" data-tf-signature="${key}">${edit?`<canvas width="800" height="208" aria-label="Signature manuscrite — ${label}"></canvas><div class="ir-pad-actions"><small>Signer au doigt, au stylet ou à la souris.</small><button type="button" class="ir-clear" data-tf-clear="${key}">Effacer la signature ${label.toLowerCase()}</button></div>`:data.signatures[key]?.length?svg(data.signatures[key]):'<div class="ir-signature-empty">Signature : ______________________________</div>'}</div></section>`).join('')}</div><p class="ir-note">Signatures manuscrites recueillies sur ce formulaire. Le compte qui enregistre la fiche est conservé séparément dans la chronologie.</p></section></div>`;
}
function paper(edit){return trainingFormPaper(model,{...ctx,employeeName:ctx.employees.find(e=>e.key===model.employeeKey)?.name||'',task:ctx.task},edit);}
export function openTrainingForm(options){
 if(!canLeaveForm())return;
 ctx=options;prior=options.prior||null;model={...emptyTrainingForm(),...(prior?structuredClone(prior.data):{}),employeeKey:prior?.data.employeeKeys[0]||options.employeeKey||''};dirty=false;requestId=crypto.randomUUID();
 if(!document.querySelector('link[href="/incident-report.css"]')){const l=document.createElement('link');l.rel='stylesheet';l.href='/incident-report.css';document.head.append(l);}
 if(!document.querySelector('link[href="/training-form.css"]')){const l=document.createElement('link');l.rel='stylesheet';l.href='/training-form.css';document.head.append(l);}
 if(!dialog){dialog=document.createElement('dialog');dialog.className='ir-dialog';dialog.setAttribute('aria-label','Formulaire de formation à un équipement');document.body.append(dialog);dialog.addEventListener('cancel',e=>{e.preventDefault();if(!busy&&canLeaveForm())clearForm();});}
 render();dialog.showModal();
}
function render(){
 dialog.innerHTML=`<div class="ir-toolbar"><strong>Formation à un équipement</strong><button type="button" class="button primary" data-tf-save="draft">Enregistrer le brouillon</button><button type="button" class="button primary" data-tf-save="completed">Finaliser et conserver les signatures</button><button type="button" class="button secondary" data-tf-print>Imprimer / PDF</button>${prior?'<button type="button" class="button secondary" data-tf-new>Nouvelle formation</button>':''}<button type="button" class="quiet" data-tf-close>Fermer</button></div><p data-tf-message role="status">${prior?'Fiche enregistrée. Une correction conserve la version précédente.':'Nouveau formulaire — remplir, puis faire signer.'}</p>${prior?'<label class="ir-correction">Motif de la correction<input data-tf="correctionReason" maxlength="1000" value="'+esc(model.correctionReason||'')+'"></label>':''}${paper(true)}`;
 dialog.oninput=e=>{const el=e.target,key=el.dataset.tf;
  if(!key&&!el.hasAttribute('data-tf-person')&&!el.hasAttribute('data-tf-point'))return;
  if(key==='correctionReason'){model.correctionReason=el.value;dirty=true;return;}
  const had=Object.values(model.signatures).some(x=>x.length);model.signatures={employee:[],trainer:[]};dirty=true;
  if(el.hasAttribute('data-tf-person')){model.employeeKey=el.value;render();}
  else if(el.hasAttribute('data-tf-point'))model.points[Number(el.dataset.tfPoint)].result=el.value;
  else if(key.startsWith('pointnote:'))model.points[Number(key.split(':')[1])].note=el.value;
  else model[key]=el.type==='checkbox'?el.checked:el.value;
  if(key==='procedureId'){const p=ctx.procedures.find(x=>x.id===model.procedureId);model.points=(p?.data.criteria||[]).filter(x=>x.task===ctx.task).map(x=>({...x,result:'unobserved',note:''}));render();}
  if(key==='trainer'){const el=dialog.querySelector('.tf-name-trainer .ir-value');if(el)el.textContent=model.trainer||'—';}
  redraw();message(had?'Le contenu a changé : faites signer à nouveau cette version.':'Modifications à enregistrer.');
 };
 dialog.onclick=async e=>{const b=e.target.closest('button');if(!b||busy)return;const d=b.dataset;
  if('tfNew'in d){if(canLeaveForm()){const options={...ctx,prior:null,employeeKey:model.employeeKey};clearForm();openTrainingForm(options);}return;}
  if('tfClose'in d){if(canLeaveForm())clearForm();}
  if(d.tfClear){model.signatures[d.tfClear]=[];dirty=true;redraw();}
  if('tfPrint'in d){document.getElementById('sstPrint').innerHTML=(dirty||!prior?'<p class="ir-print-warning">Brouillon / modifications non enregistrées</p>':'')+paper(false);window.print();}
  if(d.tfSave)await save(d.tfSave);
 };
 setupPads();
}
function draw(canvas,strokes){const c=canvas.getContext('2d');c.clearRect(0,0,800,208);c.lineWidth=2.8;c.strokeStyle=c.fillStyle='#17302c';c.lineCap=c.lineJoin='round';for(const stroke of strokes){c.beginPath();stroke.forEach(([x,y],i)=>i?c.lineTo(x*.8,y*.208):c.moveTo(x*.8,y*.208));if(stroke.length===1){c.arc(stroke[0][0]*.8,stroke[0][1]*.208,1.4,0,Math.PI*2);c.fill();}else c.stroke();}}
function redraw(){for(const canvas of dialog.querySelectorAll('canvas'))draw(canvas,model.signatures[canvas.closest('[data-tf-signature]').dataset.tfSignature]);}
function setupPads(){for(const canvas of dialog.querySelectorAll('canvas')){const key=canvas.closest('[data-tf-signature]').dataset.tfSignature;let pointer=null,stroke;
 const add=e=>{if(model.signatures[key].reduce((n,s)=>n+s.length,0)>=600)return;const r=canvas.getBoundingClientRect(),p=[Math.round(Math.max(0,Math.min(1000,(e.clientX-r.left)/r.width*1000))),Math.round(Math.max(0,Math.min(1000,(e.clientY-r.top)/r.height*1000)))];const last=stroke.at(-1);if(!last||Math.abs(last[0]-p[0])+Math.abs(last[1]-p[1])>3)stroke.push(p);draw(canvas,model.signatures[key]);};
 canvas.onpointerdown=e=>{if(busy||pointer!==null||e.button!==0)return;if(model.signatures[key].length>=60||model.signatures[key].reduce((n,s)=>n+s.length,0)>=600){message('Effacez cette signature pour la reprendre.');return;}pointer=e.pointerId;canvas.setPointerCapture(pointer);stroke=[];model.signatures[key].push(stroke);add(e);dirty=true;message('Signature saisie — enregistrez le formulaire.');};
 canvas.onpointermove=e=>{if(pointer===e.pointerId)add(e);};const end=e=>{if(pointer===e.pointerId){pointer=null;stroke=null;}};canvas.onpointerup=end;canvas.onpointercancel=end;
 }redraw();}
async function save(status){
 if(!model.employeeKey){message('Choisissez l’employé concerné.');return;}
 if(prior?.data.status==='draft'&&status==='completed'&&!model.correctionReason?.trim())model.correctionReason='Finalisation du brouillon';
 if(prior&&!model.correctionReason?.trim()){message('Indiquez le motif de la correction.');return;}
 busy=true;dialog.querySelectorAll('button,input,select,textarea').forEach(x=>x.disabled=true);
 try{const data={...model,status,employeeKeys:[model.employeeKey],tasks:[ctx.task],enteredBy:ctx.actorName};delete data.employeeKey;delete data.correctionReason;
 const entry=await ctx.save({id:requestId,kind:'training_form',equipmentId:ctx.equipment.id,data,...(prior?{supersedes:prior.id,correctionReason:model.correctionReason}:{})});prior=entry.entry;model={...model,...structuredClone(prior.data),correctionReason:''};requestId=crypto.randomUUID();dirty=false;await ctx.onSaved(prior);render();message(status==='completed'?'Formulaire signé enregistré.':'Brouillon enregistré.');
 }catch(e){message(e.message);}finally{busy=false;dialog.querySelectorAll('button,input,select,textarea').forEach(x=>x.disabled=false);const p=dialog.querySelector('[data-tf-person]');if(p&&prior)p.disabled=true;}
}

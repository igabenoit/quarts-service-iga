import {DAY_NAMES,DEPARTMENT_STYLES,escapeHTML as e,nameKey,monday,today,dateLabel,addDays,timeLabel,hoursLabel,tenure,blankCell,normalizeCell,parseShiftTimes,quickTimeLabel,totalMinutes,trainingMinutes,isTimedCell,cellMinutes,cellLabel,cellTone,sheetHTML,availabilityCode,PRINT_ROW_CAPACITY} from './departments-core.js';
const $=s=>document.querySelector(s);let meta,current,selectedDepartment,dirty=false,editingCell,editingPerson,activePhoto,view='schedule',loadSequence=0,copiedShift=null,lastPaste=null,weekCopySource=null,weekCopyTarget=null,weekCopySequence=0,weekCopyBusy=false;
const message=v=>$('#appMessage').textContent=v;
async function api(path,options={}){const response=await fetch(path,{cache:'no-store',...options,headers:{'Content-Type':'application/json',...options.headers}});const data=await response.json();if(!response.ok)throw Error(response.status===401?'Connectez-vous avec votre code gestionnaire depuis « Retour au Service », puis revenez ici.':data.error||'Opération indisponible.');return data;}
const post=(path,body)=>api(path,{method:'POST',body:JSON.stringify(body)});
const route=()=>`/api/departments/${selectedDepartment}/weeks/${$('#weekPicker').value}`;
function markDirty(){dirty=true;$('#draftStatus').textContent='Modifications à enregistrer.';$('#verified').checked=false;$('#warningsReviewed').checked=false;}
function mayLeave(){return !dirty||confirm('Des modifications ne sont pas enregistrées. Quitter cette feuille sans les enregistrer?');}
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
function formatCell(c){return isTimedCell(c)?`${c.kind==='training'?'Formation · ':''}${timeLabel(c.start)}–${timeLabel(c.end)}`:cellLabel(c)||'+';}
function renderNavigation(){
  $('#departmentNav').innerHTML=meta.departments.filter(d=>d.key!=='service').map(d=>`<button class="theme-${e(d.key)}" data-department="${d.id}" aria-current="${d.id===selectedDepartment}">${e(d.name)}</button>`).join('');
  $('#departmentNav').querySelectorAll('button').forEach(b=>b.onclick=async()=>{if(!mayLeave())return;selectedDepartment=Number(b.dataset.department);dirty=false;activePhoto=null;$('#photoReview').hidden=true;try{await loadWeek();}catch(err){message(err.message);}});
}
async function loadMeta(){meta=await api('/api/departments/meta');if(!selectedDepartment)selectedDepartment=meta.departments.find(d=>d.key==='boulangerie')?.id||meta.departments.find(d=>d.key!=='service')?.id;renderNavigation();}
async function loadWeek(){
  const sequence=++loadSequence;$('#managerContent').inert=true;message('Chargement…');try{const loaded=await api(route());if(sequence!==loadSequence)return;current=loaded;dirty=false;lastPaste=null;document.body.className='theme-'+current.department.key;
  $('#weekLabel').textContent=`${dateLabel(current.weekStart)} au ${dateLabel(addDays(current.weekStart,6))}`;$('#scheduleTitle').textContent=current.department.name;
  $('#sheetManager').value=current.draft.manager;$('#sheetNotes').value=current.draft.notes;
  $('#verified').checked=false;$('#warningsReviewed').checked=false;$('#publishStatus').textContent=current.publishedAt?'Une version est publiée':'Non publié';$('#unpublishWeek').hidden=!current.publishedAt;
  $('#draftStatus').textContent='Brouillon à jour.';renderNavigation();renderSchedule();renderPeople();renderPrint();renderWarnings();if(view==='photos')await loadPhotos();message('');}finally{if(sequence===loadSequence)$('#managerContent').inert=false;}
}
function renderWarnings(){const warnings=current.warnings||[];$('#warnings').hidden=!warnings.length;$('#warningAcknowledgement').hidden=!warnings.length;$('#warnings').innerHTML='<strong>À vérifier avant publication</strong><ul>'+warnings.map(w=>`<li>${e(w)}</li>`).join('')+'</ul>';}
function renderSchedule(){
  renderCopyBar();
  if(!current.draft.rows.length){$('#scheduleGrid').innerHTML='<div class="notice">Aucun employé dans cette feuille. Commencez dans l’onglet « Employés ». Le gabarit papier vierge est déjà disponible dans « Feuille imprimable ».</div>';return;}
  $('#scheduleGrid').innerHTML=`<table class="editor-table ${copiedShift?'copy-mode':''}"><thead><tr><th>Employé / ancienneté</th>${DAY_NAMES.map((d,i)=>`<th>${d}<br>${addDays(current.weekStart,i).slice(8)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${current.draft.rows.map(row=>{const p=current.people.find(p=>p.id===row.personId);if(!p)return `<tr><td colspan="9">Employé retiré du département. <button data-remove="${row.personId}">Retirer sa ligne du brouillon</button></td></tr>`;return `<tr><th>${e(p.name)}${p.jobTitle?`<span class="person-job-title">${e(p.jobTitle)}</span>`:''}<span class="person-meta">${p.group==='regular'?'Régulier':'Temps partiel'} · ${e(tenure(p.seniorityDate,current.weekStart))}</span><button class="remove-person" data-remove="${p.id}">Retirer de cette feuille</button></th>${row.cells.map((c,d)=>`<td><button class="day-button ${cellTone(c)} ${c.kind==='review'?'needs-review':''}" data-cell="${p.id}:${d}" aria-label="${e(p.name)}, ${DAY_NAMES[d]}, ${e(formatCell(c))}">${isTimedCell(c)?`<strong>${timeLabel(c.start)}</strong><strong>${timeLabel(c.end)}</strong>${c.kind==='training'?'<small>Formation</small>':''}`:e(formatCell(c))}</button><div class="day-detail"><span>${isTimedCell(c)?hoursLabel(cellMinutes(c)):''}</span><span>${e(availabilityCode(p.availability[d]))}</span></div></td>`).join('')}<td class="editor-total"><strong>${hoursLabel(totalMinutes(row))} h</strong><small>Régulier</small>${trainingMinutes(row)>0?`<span class="training-hours">Formation<br><b>${hoursLabel(trainingMinutes(row))} h</b></span>`:''}</td></tr>`;}).join('')}</tbody></table><div class="department-hours"><strong>Département · Régulier : ${hoursLabel(current.draft.rows.reduce((n,r)=>n+totalMinutes(r),0))} h</strong>${current.draft.rows.some(r=>trainingMinutes(r)>0)?`<span>Formation : ${hoursLabel(current.draft.rows.reduce((n,r)=>n+trainingMinutes(r),0))} h</span>`:''}</div>`;
  $('#scheduleGrid').querySelectorAll('[data-cell]').forEach(b=>b.onclick=()=>{const [personId,day]=b.dataset.cell.split(':').map(Number);if(copiedShift)pasteShift(personId,day);else openCell(personId,day);});
  $('#scheduleGrid').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{if(!confirm('Retirer cette personne de ce brouillon? Sa fiche et les horaires déjà publiés sont conservés.'))return;current.draft.rows=current.draft.rows.filter(r=>r.personId!==Number(b.dataset.remove));markDirty();renderSchedule();});
}
function openCell(personId,day){
  const person=current.people.find(p=>p.id===personId),cell=current.draft.rows.find(r=>r.personId===personId).cells[day];editingCell={personId,day};
  $('#cellTitle').textContent=`${person.name} · ${DAY_NAMES[day]}`;$('#cellAvailability').textContent='Disponibilité : '+(availabilityCode(person.availability[day])||'Non renseignée');
  $('#cellOriginal').hidden=cell.kind!=='review';$('#cellOriginal').textContent='Lecture à vérifier sur la photo : '+cell.note;
  $('#cellKind').value=['blank','review','training'].includes(cell.kind)?'shift':cell.kind;$('#cellTraining').checked=cell.kind==='training';$('#cellStart').value=cell.start===null?'':quickTimeLabel(cell.start);$('#cellEnd').value=cell.end===null?'':quickTimeLabel(cell.end);
  $('#cellBreak').value=cell.breakMinutes;$('#cellNote').value=cell.kind==='review'?'':cell.note;$('#cellError').textContent='';updateCellKind();$('#cellDialog').showModal();if($('#cellKind').value==='shift'){$('#cellStart').focus();$('#cellStart').select();}
}
function updateCellKind(){const shift=$('#cellKind').value==='shift';$('#shiftFields').hidden=!shift;$('#quickTimeInfo').hidden=!shift;$('#cellStart').required=shift;$('#cellEnd').required=shift;$('#copyShift').disabled=false;previewShift();}
$('#cellKind').onchange=updateCellKind;
$('#cellForm').onsubmit=event=>{event.preventDefault();try{saveCellForm();}catch(err){$('#cellError').textContent=err.message;}};
function cellFromForm(){
  const kind=$('#cellKind').value==='shift'&&$('#cellTraining').checked?'training':$('#cellKind').value,times=isTimedCell({kind})?parseShiftTimes($('#cellStart').value,$('#cellEnd').value):{};
  return normalizeCell({kind,...times,breakMinutes:Number($('#cellBreak').value),note:$('#cellNote').value});
}
function previewShift(){
  const el=$('#resolvedShift');el.textContent='';el.dataset.invalid='false';
  if($('#cellKind').value!=='shift'||!$('#cellStart').value||!$('#cellEnd').value)return;
  try{const c=cellFromForm();el.textContent=`Quart compris : ${timeLabel(c.start)} → ${timeLabel(c.end)} · ${hoursLabel(c.end-c.start-c.breakMinutes)} h ${c.kind==='training'?'de formation · exclues du total régulier':'régulières'}`;}
  catch(err){el.textContent=err.message;el.dataset.invalid='true';}
}
for(const id of ['cellStart','cellEnd','cellBreak','cellTraining'])$('#'+id).addEventListener('input',previewShift);
for(const id of ['cellStart','cellEnd'])$('#'+id).addEventListener('blur',()=>{try{const t=parseShiftTimes($('#cellStart').value,$('#cellEnd').value);$('#cellStart').value=quickTimeLabel(t.start);$('#cellEnd').value=quickTimeLabel(t.end);}catch{}previewShift();});
function saveCellForm(){
  const c=cellFromForm();current.draft.rows.find(r=>r.personId===editingCell.personId).cells[editingCell.day]=c;
  lastPaste=null;markDirty();renderSchedule();renderPrint();$('#cellDialog').close();return c;
}
function renderCopyBar(){
  $('#copyBar').hidden=!copiedShift&&!lastPaste;$('#stopCopy').hidden=!copiedShift;$('#undoPaste').hidden=!lastPaste;
  $('#copyDescription').textContent=copiedShift?`Contenu à coller : ${copiedShift.cell.kind==='blank'?'Case vide':formatCell(copiedShift.cell)}`:'Contenu collé dans le brouillon';
  $('#copyHelp').textContent=copiedShift?'Cliquez sur les journées où reproduire ce contenu. Échap pour terminer.':'Vous pouvez annuler le dernier collage avant d’enregistrer le brouillon.';
}
function stopCopy(){copiedShift=null;renderSchedule();}
$('#stopCopy').onclick=stopCopy;
$('#copyShift').onclick=()=>{try{const cell=cellFromForm();saveCellForm();copiedShift={cell:{...cell}};renderSchedule();message('Case copiée. Cliquez sur une ou plusieurs journées pour la coller, puis enregistrez le brouillon.');}catch(err){$('#cellError').textContent=err.message;}};
function pasteShift(personId,day){
  const row=current.draft.rows.find(r=>r.personId===personId),person=current.people.find(p=>p.id===personId);if(!row||!person||!copiedShift)return;
  const before=row.cells[day],after={...copiedShift.cell};
  if(JSON.stringify(before)===JSON.stringify(after)){message('Cette journée contient déjà ce contenu.');return;}
  if(before.kind!=='blank'&&!confirm(`${person.name} · ${DAY_NAMES[day]} : remplacer « ${formatCell(before)} » par ${formatCell(after)}?`))return;
  row.cells[day]=after;lastPaste={personId,day,before:{...before},after:{...after}};
  markDirty();renderSchedule();renderPrint();message(`Contenu collé pour ${person.name}, ${DAY_NAMES[day].toLowerCase()}. Enregistrez le brouillon pour conserver vos changements.`);
}
$('#undoPaste').onclick=()=>{
  if(!lastPaste)return;const row=current.draft.rows.find(r=>r.personId===lastPaste.personId);
  if(row&&JSON.stringify(row.cells[lastPaste.day])===JSON.stringify(lastPaste.after)){row.cells[lastPaste.day]={...lastPaste.before};markDirty();message('Dernier collage annulé.');}
  lastPaste=null;renderSchedule();renderPrint();
};
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&copiedShift&&!document.querySelector('dialog[open]'))stopCopy();
});


async function saveDraft(){const result=await api(route(),{method:'PUT',body:JSON.stringify({revision:current.revision,draft:current.draft})});current.revision=result.revision;dirty=false;await loadWeek();return result;}
$('#saveDraft').onclick=async()=>{try{await saveDraft();message('Brouillon enregistré.');}catch(err){message(err.message);}};
$('#copyWeek').onclick=async()=>{
  const button=$('#copyWeek');button.disabled=true;
  try{
    if(dirty||!current.revision)await saveDraft();
    weekCopySource={departmentId:selectedDepartment,weekStart:current.weekStart,revision:current.revision};
    $('#copyWeekSource').textContent=`${current.department.name} · du ${dateLabel(current.weekStart)} au ${dateLabel(addDays(current.weekStart,6))}`;
    const counts={shift:0,training:0,off:0,vacation:0,requested:0,sick:0,note:0,review:0};for(const row of current.draft.rows)for(const cell of row.cells)if(cell.kind in counts)counts[cell.kind]++;
    $('#copyWeekSummary').innerHTML=[`${current.draft.rows.length} employés`,`${counts.shift} quarts réguliers`,`${counts.training} quarts de formation`,`${counts.off} congés (CH)`,`${counts.vacation} jours de vacances`,`${counts.requested} congés demandés`,`${counts.sick} jours de maladie`,`${counts.note} autres mentions`,...(counts.review?[`${counts.review} cases à vérifier`]:[])].map(text=>`<span>${e(text)}</span>`).join('');
    $('#copyWeekTarget').value=addDays(current.weekStart,7);$('#copyWeekError').textContent='';$('#copyWeekDialog').showModal();await previewWeekCopy();
  }catch(err){message(err.message);}finally{button.disabled=false;}
};
async function previewWeekCopy(){
  const sequence=++weekCopySequence;weekCopyTarget=null;$('#confirmCopyWeek').disabled=true;$('#copyWeekReplace').checked=false;$('#copyWeekReplaceLabel').hidden=true;$('#copyWeekError').textContent='';
  const value=$('#copyWeekTarget').value;if(!value){$('#copyWeekDestination').textContent='Choisissez une semaine de destination.';return;}
  const target=monday(value);$('#copyWeekTarget').value=target;
  if(target===weekCopySource.weekStart){$('#copyWeekDestination').textContent='Choisissez une semaine différente de la source.';return;}
  $('#copyWeekDestination').textContent='Vérification de la semaine…';
  try{
    const data=await api(`/api/departments/${weekCopySource.departmentId}/weeks/${target}`);if(sequence!==weekCopySequence)return;
    weekCopyTarget={weekStart:target,revision:data.revision};
    $('#copyWeekDestination').textContent=`Du ${dateLabel(target)} au ${dateLabel(addDays(target,6))}. `+(data.revision?'Un brouillon existe déjà : il sera remplacé par cette copie.':'Une nouvelle semaine sera créée en brouillon.')+(data.publishedAt?' L’horaire actuellement publié sera conservé.':'');
    $('#copyWeekReplaceLabel').hidden=!data.revision;$('#confirmCopyWeek').disabled=!!data.revision;
  }catch(err){if(sequence===weekCopySequence)$('#copyWeekDestination').textContent=err.message;}
}
$('#copyWeekTarget').onchange=previewWeekCopy;
$('#copyWeekReplace').onchange=()=>{$('#confirmCopyWeek').disabled=!weekCopyTarget||(weekCopyTarget.revision>0&&!$('#copyWeekReplace').checked);};
$('#copyWeekDialog').addEventListener('cancel',event=>{if(weekCopyBusy)event.preventDefault();});
$('#copyWeekDialog').addEventListener('close',()=>{weekCopySequence++;weekCopyTarget=null;});
$('#copyWeekForm').onsubmit=async event=>{
  event.preventDefault();if(weekCopyBusy||!weekCopySource||!weekCopyTarget)return;
  const source={...weekCopySource},target={...weekCopyTarget};
  if(monday($('#copyWeekTarget').value)!==target.weekStart)return;
  weekCopyBusy=true;$('#copyWeekFields').disabled=true;$('#confirmCopyWeek').disabled=true;$('#closeCopyWeek').disabled=true;$('#copyWeekError').textContent='';
  try{
    await post(`/api/departments/${source.departmentId}/weeks/${target.weekStart}/copy`,{sourceWeek:source.weekStart,sourceRevision:source.revision,revision:target.revision,replaceConfirmed:$('#copyWeekReplace').checked});
    $('#copyWeekDialog').close();selectedDepartment=source.departmentId;$('#weekPicker').value=target.weekStart;copiedShift=null;activePhoto=null;$('#photoReview').hidden=true;
    await loadWeek();message('Semaine copiée et enregistrée en brouillon. Ajustez les journées qui changent, puis publiez l’horaire.');
  }catch(err){$('#copyWeekError').textContent=err.message;message(err.message);}
  finally{weekCopyBusy=false;$('#copyWeekFields').disabled=false;$('#closeCopyWeek').disabled=false;$('#confirmCopyWeek').disabled=!weekCopyTarget||(weekCopyTarget.revision>0&&!$('#copyWeekReplace').checked);}
};

$('#sheetManager').oninput=()=>{current.draft.manager=$('#sheetManager').value;markDirty();};$('#sheetNotes').oninput=()=>{current.draft.notes=$('#sheetNotes').value;markDirty();};
$('#syncRoster').onclick=async()=>{try{await loadMeta();const fresh=await api(route());current.people=fresh.people;for(const p of current.people.filter(p=>p.active))if(!current.draft.rows.some(r=>r.personId===p.id))current.draft.rows.push({personId:p.id,cells:Array.from({length:7},blankCell)});markDirty();renderSchedule();message('Les employés actifs ont été ajoutés au brouillon. Les heures déjà saisies sont conservées.');}catch(err){message(err.message);}};
$('#publishWeek').onclick=async()=>{
  const verified=$('#verified').checked,reviewed=$('#warningsReviewed').checked;if(!verified){message('Cochez la vérification des noms, de la semaine, des heures et des pauses.');return;}
  const button=$('#publishWeek');button.disabled=true;try{if(dirty){await saveDraft();$('#verified').checked=verified;$('#warningsReviewed').checked=reviewed;}await post(route()+'/publish',{revision:current.revision,verified,warningsReviewed:reviewed});await loadWeek();message('Horaire publié. Il est maintenant disponible dans le portail employés.');}catch(err){message(err.message);const fresh=await api(route()).catch(()=>null);if(fresh){current.warnings=fresh.warnings;renderWarnings();}}finally{button.disabled=false;}
};
$('#unpublishWeek').onclick=async()=>{if(!confirm('Retirer cet horaire du portail employés? Le brouillon restera disponible.'))return;try{await post(route()+'/unpublish',{revision:current.revision});await loadWeek();message('Horaire retiré de l’affichage en ligne.');}catch(err){message(err.message);}};
$('#loadHistory').onclick=async()=>{try{const data=await api(route()+'/history');$('#historyList').innerHTML=data.history.map(h=>`<p>Version ${h.revision} · ${e(new Date(h.created_at).toLocaleString('fr-CA'))} <button class="quiet" data-restore="${h.id}">Rétablir ce brouillon</button></p>`).join('')||'<p>Aucune version précédente.</p>';$('#historyList').querySelectorAll('button').forEach(b=>b.onclick=async()=>{if(!mayLeave())return;try{await post(route()+'/restore',{revision:current.revision,historyId:Number(b.dataset.restore)});await loadWeek();message('Version rétablie en brouillon. L’horaire publié reste inchangé.');}catch(err){message(err.message);}});}catch(err){message(err.message);}};
function renderPeople(){
  const query=nameKey($('#personSearch').value),people=meta.people.filter(p=>query?nameKey(p.name+' '+(p.jobTitle||'')+' '+p.email).includes(query):p.departments.includes(selectedDepartment));
  $('#peopleList').innerHTML=people.map(p=>`<article class="person-card"><h3>${e(p.name)}</h3>${p.jobTitle?`<p class="person-job-title">${e(p.jobTitle)}</p>`:''}<p>${p.active?'Actif':'Inactif'} · ${p.group==='regular'?'Régulier':'Temps partiel'}</p><p>Ancienneté : <strong>${e(tenure(p.seniorityDate))}</strong><br>${e(dateLabel(p.seniorityDate))}</p><p>Anniversaire : ${p.birthday?e(dateLabel(p.birthday)):'À compléter'}</p><p>${e(p.email||'Courriel à compléter')}</p><p>${e(p.departments.map(id=>meta.departments.find(d=>d.id===id)?.name).filter(Boolean).join(' · '))}</p><button data-person="${p.id}" class="button quiet">Ouvrir la fiche</button></article>`).join('')||'<p class="notice">Aucune fiche pour ce département. Ajoutez les employés progressivement; les renseignements inconnus peuvent rester vides.</p>';
  $('#peopleList').querySelectorAll('[data-person]').forEach(b=>b.onclick=()=>openPerson(meta.people.find(p=>p.id===Number(b.dataset.person))));
}
function openPerson(person){
  editingPerson=person||null;$('#personForm').reset();$('#personError').textContent='';$('#personTitle').textContent=person?'Modifier la fiche':'Ajouter un employé';
  $('#personName').value=person?.name||'';$('#personJobTitle').value=person?.jobTitle||'';$('#personSeniority').value=person?.seniorityDate||'';$('#personBirthday').value=person?.birthday||'';$('#personEmail').value=person?.email||'';$('#personGroup').value=person?.group||'regular';$('#personSource').value=person?.sourceNote||'';$('#personVerified').checked=!!person?.verifiedAt;$('#personActive').checked=person?.active??true;
  const linked=!!person?.serviceEmployeeId;$('#serviceSource').hidden=!linked;$('#personName').readOnly=linked;$('#personSeniority').readOnly=linked;$('#personActive').disabled=linked;$('#availabilityEditor').disabled=linked;
  $('#personDepartments').innerHTML=meta.departments.map(d=>`<label class="check"><input type="checkbox" value="${d.id}" ${person?.departments.includes(d.id)||!person&&d.id===selectedDepartment?'checked':''} ${d.key==='service'?'disabled':''}> ${e(d.name)}</label>`).join('');
  $('#personAvailability').innerHTML=DAY_NAMES.map((d,i)=>`<label>${d}<input data-day="${i}" maxlength="40" value="${e(availabilityCode(person?.availability[i]))}" placeholder="Non renseigné"></label>`).join('');$('#personDialog').showModal();
}
$('#newPerson').onclick=()=>openPerson();$('#personSearch').oninput=renderPeople;
$('#personForm').onsubmit=async event=>{event.preventDefault();const b={name:$('#personName').value,jobTitle:$('#personJobTitle').value,seniorityDate:$('#personSeniority').value,birthday:$('#personBirthday').value,email:$('#personEmail').value,group:$('#personGroup').value,sourceNote:$('#personSource').value,seniorityVerified:$('#personVerified').checked,active:$('#personActive').checked,distinctPerson:$('#distinctPerson').checked,departments:[...$('#personDepartments').querySelectorAll('input:checked')].map(i=>Number(i.value)),availability:Object.fromEntries([...$('#personAvailability').querySelectorAll('input')].map(i=>[i.dataset.day,i.value])),version:editingPerson?.version};try{await api('/api/departments/people'+(editingPerson?'/'+editingPerson.id:''),{method:editingPerson?'PUT':'POST',body:JSON.stringify(b)});$('#personDialog').close();await loadMeta();current.people=(await api(route())).people;renderPeople();renderSchedule();renderPrint();message(editingPerson?'Fiche enregistrée.'+(current.publishedAt?' Publiez à nouveau l’horaire pour actualiser les renseignements affichés aux employés.':''):'Fiche enregistrée. Dans l’horaire, utilisez « Actualiser la liste d’employés » pour l’ajouter à la feuille.');}catch(err){$('#personError').textContent=err.message;}};
function renderPrint(){if(!current)return;const html=sheetHTML({department:current.department,weekStart:current.weekStart,people:current.people,draft:current.draft,blank:$('#printKind').value==='blank'});$('#printPreview').innerHTML=html;$('#printRoot').innerHTML=html;const count=$('#printPreview').querySelectorAll('.sheet-person').length;$('#printNotice').hidden=count<=PRINT_ROW_CAPACITY;$('#printNotice').textContent=count>PRINT_ROW_CAPACITY?`Cette feuille compte ${count} employés. Le gabarit standard est limité à ${PRINT_ROW_CAPACITY} lignes. Aucun nom n’a été masqué; l’impression est bloquée pour conserver une seule page légale.`:'';$('#printSheet').disabled=count>PRINT_ROW_CAPACITY;}
$('#printKind').onchange=renderPrint;$('#printSheet').onclick=()=>{renderPrint();const sheet=$('#printPreview .department-sheet');const safeBottom=sheet.getBoundingClientRect().bottom-parseFloat(getComputedStyle(sheet).paddingBottom);const overflowingText=[...sheet.querySelectorAll('.sheet-work,.sheet-person-label')].some(el=>el.scrollHeight>el.clientHeight+2);if(sheet.querySelectorAll('.sheet-person').length>PRINT_ROW_CAPACITY||overflowingText||sheet.scrollHeight>sheet.clientHeight+2||sheet.querySelector('.sheet-notes').getBoundingClientRect().bottom>safeBottom+2){message('Un texte dépasse la hauteur fixe d’une case ou la page légale. Revoyez les titres, précisions ou notes avant d’imprimer.');return;}window.print();};
async function loadPhotos(){const result=await api(`/api/departments/photos?departmentId=${selectedDepartment}&weekStart=${current.weekStart}`);$('#photoList').innerHTML=result.photos.map(p=>`<button class="quiet" data-photo="${p.id}">${e(p.name)}${p.analyzed?' · transcription disponible':''}</button>`).join('')||'<p>Aucune photo pour cette semaine.</p>';$('#photoList').querySelectorAll('button').forEach(b=>b.onclick=()=>openPhoto(Number(b.dataset.photo)));$('#visionStatus').textContent=meta.visionConfigured?'La lecture automatique utilise OpenAI. En choisissant « Proposer une transcription », vous lui transmettez cette photo et les noms de l’équipe pour préparer un brouillon à vérifier.':'Le dépôt et la comparaison des photos sont disponibles. La transcription automatique attend la configuration de la connexion IA sur le serveur.';$('#analyzePhoto').disabled=!meta.visionConfigured;}
$('#photoInput').onchange=async event=>{const file=event.target.files[0];if(!file)return;if(file.size>8*1024*1024){$('#photoStatus').textContent='Photo trop lourde : choisissez une image de moins de 8 Mo.';return;}try{$('#photoStatus').textContent='Enregistrement de la photo…';const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});const result=await post('/api/departments/photos',{departmentId:selectedDepartment,weekStart:current.weekStart,name:file.name,dataUrl});await loadPhotos();await openPhoto(result.id);$('#photoStatus').textContent='Photo enregistrée. Vérifiez qu’elle montre toute la feuille, y compris les noms et les dates.';}catch(err){$('#photoStatus').textContent=err.message;}finally{event.target.value='';}};
async function openPhoto(id){try{activePhoto=await api('/api/departments/photos/'+id);$('#photoReview').hidden=false;$('#photoImage').src=activePhoto.dataUrl;$('#largePhoto').src=activePhoto.dataUrl;renderCandidate();}catch(err){$('#photoStatus').textContent=err.message;}}
$('#openPhoto').onclick=()=>$('#photoDialog').showModal();
$('#analyzePhoto').onclick=async()=>{const b=$('#analyzePhoto');b.disabled=true;$('#photoStatus').textContent='Lecture de la photo en cours…';try{const result=await post(`/api/departments/photos/${activePhoto.id}/analyze`,{});activePhoto.candidate=result.candidate;renderCandidate();$('#photoStatus').textContent='Proposition prête. Vérifiez la semaine, les noms et les cases incertaines avant de publier.';}catch(err){$('#photoStatus').textContent=err.message;}finally{b.disabled=!meta.visionConfigured;}};
function renderCandidate(){
  const candidate=activePhoto.candidate;if(!candidate){$('#candidate').innerHTML='<div class="notice">La photo est prête à comparer. Utilisez « Proposer une transcription » lorsque la connexion IA est disponible, ou inscrivez les heures dans l’onglet Horaire.</div>';return;}
  $('#candidate').innerHTML=`<h3>Lecture proposée</h3><p>Département lu : ${e(candidate.departmentText||'Non lisible')}<br>Semaine lue : ${e(candidate.weekText||'Non lisible')}</p>${candidate.warnings.length?'<ul class="notice">'+candidate.warnings.map(w=>`<li>${e(w)}</li>`).join('')+'</ul>':''}${candidate.rows.map((r,i)=>{const matches=current.people.filter(p=>nameKey(p.name)===nameKey(r.name));return `<article class="candidate-row"><strong>${e(r.name||'Nom illisible')}</strong><label>Relier à la fiche<select data-map="${i}"><option value="">Choisir l’employé après vérification</option>${current.people.map(p=>`<option value="${p.id}" ${matches.length===1&&p.id===matches[0].id?'selected':''}>${e(p.name)}</option>`).join('')}</select></label><p>${r.days.map((c,d)=>`${DAY_NAMES[d].slice(0,3)} : ${e(formatCell(c))}`).join('<br>')}</p><p>Total manuscrit : ${e(r.writtenTotal||'Non lisible')} · Régulier : ${hoursLabel(totalMinutes({cells:r.days}))} h${trainingMinutes({cells:r.days})>0?` · Formation : ${hoursLabel(trainingMinutes({cells:r.days}))} h`:''}</p></article>`;}).join('')}<label class="check"><input id="photoWeekConfirmed" type="checkbox"> La photo correspond au département et à la semaine sélectionnés.</label><label class="check"><input id="photoReplaceConfirmed" type="checkbox"> Remplacer les journées de ces employés dans le brouillon par cette proposition.</label><button id="applyCandidate">Reporter dans le brouillon</button><p class="muted">Les cases « À vérifier » devront être corrigées. La publication exigera ensuite votre validation de toute la feuille.</p>`;
  $('#applyCandidate').onclick=async()=>{try{if(dirty)await saveDraft();const mapping=[...$('#candidate').querySelectorAll('[data-map]')].map(s=>Number(s.value));await post(`/api/departments/photos/${activePhoto.id}/apply`,{revision:current.revision,mapping,weekConfirmed:$('#photoWeekConfirmed').checked,replaceConfirmed:$('#photoReplaceConfirmed').checked});await loadWeek();await switchView('schedule');message('Transcription reportée en brouillon. Corrigez les cases « À vérifier », puis validez toute la feuille avant publication.');}catch(err){$('#photoStatus').textContent=err.message;}};
}
async function switchView(next){view=next;document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!=='view-'+next);document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===next)));if(next==='print')renderPrint();if(next==='people'){await loadMeta();renderPeople();}if(next==='photos')await loadPhotos();}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view).catch(err=>message(err.message)));
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());
$('#weekPicker').value=monday(today());$('#weekPicker').onchange=async()=>{if(!mayLeave()){$('#weekPicker').value=current.weekStart;return;}if(!$('#weekPicker').value)return;$('#weekPicker').value=monday($('#weekPicker').value);dirty=false;$('#photoReview').hidden=true;try{await loadWeek();}catch(err){message(err.message);}};
$('#refreshWeek').onclick=async()=>{if(!mayLeave())return;try{await loadMeta();await loadWeek();}catch(err){message(err.message);}};
try{await loadMeta();await loadWeek();$('#managerContent').hidden=false;}catch(err){message(err.message);}

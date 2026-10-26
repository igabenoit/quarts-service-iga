import {watchAccess} from './access-session.js';
const accessGuard=watchAccess(location.pathname==='/disponibilites-test'?'manager':'employee');
const $=s=>document.querySelector(s),days=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=m=>`${Math.floor(m/60)} h ${String(m%60).padStart(2,'0')}`;
const dateText=d=>d?new Intl.DateTimeFormat('fr-CA',{dateStyle:'long',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z')):'…';
const test=location.pathname==='/disponibilites-test',base='/api/leave/availability';
const keyName='availability-submit-key:'+test;let key=sessionStorage.getItem(keyName)||crypto.randomUUID();sessionStorage.setItem(keyName,key);
let info=null,sending=false,attempted=false;
const touched=new Set();
const department=()=>info?.departments.find(d=>String(d.id)===$('#department').value);
const person=()=>department()?.isService?info?.employees.find(e=>String(e.id)===$('#employee').value):null;
const timeOptions=(isStart=false)=>'<option value="">Choisir</option>'+Array.from({length:57},(_,i)=>450+i*15).map(n=>`<option value="${n}"${isStart&&n>1110?' disabled':''}>${time(n)}</option>`).join('');
$('#weekdays').innerHTML=days.slice(0,5).map((day,d)=>`<section class="weekday-card"><h3>${day}</h3><label for="day-${d}">Ma disponibilité le ${day.toLowerCase()}</label><select id="day-${d}" data-day="${d}" required><option value="">Faire un choix</option><option value="none">Indisponible</option><option value="evening">Soir · 17 h à 21 h 30</option><option value="all">Journée · 7 h 30 à 21 h 30</option><option value="custom">Autres heures</option></select><div id="hours-${d}" class="day-hours" hidden><label>Début le ${day.toLowerCase()}<select id="start-${d}">${timeOptions(true)}</select></label><label>Fin le ${day.toLowerCase()}<select id="end-${d}">${timeOptions()}</select></label></div><small>Chaque plage : 3 h minimum.</small></section>`).join('');
function grid(){const result={5:[[450,1290]],6:[[450,1290]]};for(let d=0;d<5;d++){
  const kind=$('#day-'+d).value;result[d]=kind==='none'?[]:kind==='evening'?[[1020,1290]]:kind==='all'?[[450,1290]]:kind==='custom'&&$('#start-'+d).value&&$('#end-'+d).value?[[Number($('#start-'+d).value),Number($('#end-'+d).value)]]:null;
}return result;}
function feedback(id,text,{error=false,show=true}={}){
  const field=$('#'+id),noteId='feedback-'+id;let note=$('#'+noteId);
  if(!note){note=document.createElement('small');note.id=noteId;if(id==='acknowledged')field.closest('label').after(note);else field.after(note);}
  const described=new Set((field.getAttribute('aria-describedby')||'').split(' ').filter(Boolean));described.add(noteId);field.setAttribute('aria-describedby',[...described].join(' '));
  note.className='field-feedback'+(error?' field-error':'');note.textContent=text;note.hidden=!show||!text;
  field.setAttribute('aria-invalid',String(error&&show));
}
function focusField(id){const field=$('#'+id);field.scrollIntoView({block:'center',behavior:'smooth'});field.focus({preventScroll:true});}
function validate(){
  const a=grid(),p=person(),dept=department(),employeeName=dept?.isService?p?.name||'':$('#employeeName').value.trim(),errors=[],hints={};
  const issue=(message,...fields)=>errors.push({message,fields});
  if(!dept)issue('Choisis ton département.','department');
  if(dept?.isService&&!p)issue('Choisis ton nom complet.','employee');
  if(dept&&!dept.isService&&(employeeName.length<2||employeeName.length>100))issue('Inscris ton prénom et ton nom (de 2 à 100 caractères).','employeeName');
  if(p?.pending)issue('Une demande est déjà en attente. Contacte la gestion pour la corriger.','employee');
  const minimum=p?.minEffectiveDate||info?.today;
  hints.effectiveDate=minimum?'Première date possible : '+dateText(minimum)+'. Les disponibilités précédentes doivent être maintenues au moins 4 semaines.':'';
  if(!$('#effectiveDate').value)issue('Indique la date effective.','effectiveDate');else if($('#effectiveDate').value<minimum)issue('Choisis le '+dateText(minimum)+' ou une date plus tardive.','effectiveDate');
  const target=Number($('#targetHours').value)*60,max=2400;
  hints.targetHours='Entre 10 et 40 h, par quarts d’heure (ex. : 17,25 h), même si ta fiche actuelle indique un maximum inférieur. Ce souhait sera vérifié par la gestion; ce ne sont pas des heures garanties.';
  if(target>max)issue(`Tu as inscrit ${$('#targetHours').value} h; le maximum pour une demande est de 40 h. Diminue les heures souhaitées à 40 h ou moins.`,'targetHours');
  else if(!$('#targetHours').value||!Number.isInteger(target)||target%15||target<600)issue(`Inscris entre 10 et ${max/60} h, par quarts d’heure (ex. : 17,25 h).`,'targetHours');
  if(!$('#email').value.trim()||!$('#email').validity.valid)issue('Indique un courriel valide pour recevoir la confirmation.','email');
  for(let d=0;d<5;d++){
    if(!a[d]){const custom=$('#day-'+d).value==='custom',missing=custom?['start-','end-'].filter(prefix=>!$('#'+prefix+d).value).map(prefix=>prefix+d):['day-'+d];issue('Complète '+(custom?'les heures du ':'le ')+days[d].toLowerCase()+'.',...missing);}
    else if(a[d].some(([start,end])=>end-start<180))issue(`Le ${days[d].toLowerCase()}, la plage doit durer au moins 3 h consécutives. Choisis une fin au moins 3 h après le début.`,'end-'+d);
  }
  const evenings=Object.keys(a).map(Number).filter(d=>d<5&&a[d]?.some(([start,end])=>start<=1020&&end>=1290)),hasLateEvening=evenings.some(d=>d===3||d===4);
  for(let d=0;d<5;d++){
    const window=a[d]?.[0],kind=$('#day-'+d).value;
    if(evenings.includes(d))hints['day-'+d]='✓ Ce jour compte comme un soir disponible de 17 h à 21 h 30.';
    if(kind!=='custom'||!window||window[1]<=1020||window[1]-window[0]<180)continue;
    const needed=evenings.length<2||((d===3||d===4)&&!hasLateEvening);
    if(window[0]>1020){const message=`${days[d]} : un début à ${time(window[0])} ne compte pas comme un soir complet. Pour compter, commence à 17 h ou plus tôt.`;if(needed)issue(message,'start-'+d);else hints['start-'+d]=message;}
    if(window[1]<1290){const message=`${days[d]} : une fin à ${time(window[1])} ne compte pas comme un soir complet. Pour compter, la disponibilité doit aller jusqu’à 21 h 30.`;if(needed)issue(message,'end-'+d);else hints['end-'+d]=message;}
  }
  if(evenings.length<2)issue(`Il manque ${2-evenings.length} soir(s) complet(s) : de 17 h ou plus tôt jusqu’à 21 h 30. Choisis « Soir » ou ajuste tes heures.`,'ruleProgress');
  if(!hasLateEvening)issue('Rends disponible le jeudi OU le vendredi de 17 h ou plus tôt jusqu’à 21 h 30. Un seul des deux suffit.','day-3','day-4');
  if($('#comments').value.trim().length>500)issue('Limite les commentaires à 500 caractères.','comments');
  if(!$('#acknowledged').checked)issue('Coche « J’ai lu et compris les exigences ».','acknowledged');
  $('#ruleProgress').innerHTML=`<p class="rule-good">✓ Samedi et dimanche : journées complètes</p><p class="${evenings.length>=2?'rule-good':'rule-needed'}">${evenings.length>=2?'✓':'À compléter :'} ${evenings.length} soir(s) complet(s) sur 2 minimum${evenings.length?' — '+evenings.map(d=>days[d]).join(', '):''}</p><p class="${hasLateEvening?'rule-good':'rule-needed'}">${hasLateEvening?'✓':'À compléter :'} Jeudi ou vendredi soir disponible</p>`;
  for(const field of document.querySelectorAll('#availabilityForm input,#availabilityForm select,#availabilityForm textarea,#ruleProgress')){
    if(!field.id)continue;
    const related=errors.filter(e=>e.fields.includes(field.id)),day=field.id.match(/^(?:day|start|end)-(\d)$/)?.[1],seen=attempted||touched.has(field.id)||(day!==undefined&&['day-','start-','end-'].some(prefix=>touched.has(prefix+day)));
    feedback(field.id,related.length?related.map(e=>e.message).join(' '):hints[field.id]||'',{error:related.length>0,show:related.length?seen:true});
  }
  $('#summary').innerHTML=`<p><strong>${employeeName?escape(employeeName):'Ton nom reste à compléter'}</strong>${dept?' · '+escape(dept.name):''}</p><p>À compter du ${dateText($('#effectiveDate').value)} · ${escape($('#targetHours').value)||'…'} h souhaitées par semaine</p><ul>${days.map((day,d)=>`<li><strong>${day}</strong> : ${!a[d]?'à compléter':a[d].length?a[d].map(([a,b])=>time(a)+' à '+time(b)).join(', '):'indisponible'}</li>`).join('')}</ul>`;
  $('#validation').innerHTML=errors.length?'<strong>À corriger avant l’envoi — touche un point pour voir le champ :</strong><ul>'+errors.map(e=>`<li><a href="#${e.fields[0]}">${escape(e.message)}</a></li>`).join('')+'</ul>':'<p class="rule-good">Tout est complet et conforme.</p>';
  $('#send').disabled=sending||!info;return {errors,a,p,target,dept,employeeName};
}
function updateDepartment(){
  const d=department(),service=!!d?.isService,manual=!!d&&!service;
  $('#employeeSelectField').hidden=!service;$('#employee').disabled=!service;$('#employee').required=service;
  $('#employeeNameField').hidden=!manual;$('#employeeName').disabled=!manual;$('#employeeName').required=manual;
  $('#departmentInfo').textContent=d?'Ta demande sera envoyée au responsable du département '+d.name+', selon les mêmes réglages que les congés.':'';
  updateEmployee();
}
$('#department').onchange=updateDepartment;
function updateEmployee(){const p=person();$('#effectiveDate').min=p?.minEffectiveDate||info.today;$('#targetHours').max=40;$('#employeeInfo').textContent=p?(p.pending?'Une demande est déjà en attente. Contacte la gestion avant d’en soumettre une autre.':`Première date possible : ${dateText(p.minEffectiveDate)}. Tu peux demander de 10 à 40 h par semaine.`):department()&&!department().isService?'Inscris ton nom complet comme sur ton horaire. Le délai de 4 semaines sera vérifié à l’envoi; ton responsable vérifie la demande.':'';validate();}
$('#employee').onchange=updateEmployee;
function updateEnds(d){const start=$('#start-'+d),end=$('#end-'+d),minimum=(Number(start.value)||450)+180;for(const option of end.options)if(option.value)option.disabled=Number(option.value)<minimum;if(end.value&&Number(end.value)<minimum)end.value='';}
for(let d=0;d<5;d++){
  $('#day-'+d).onchange=()=>{const custom=$('#day-'+d).value==='custom';$('#hours-'+d).hidden=!custom;$('#start-'+d).required=$('#end-'+d).required=custom;updateEnds(d);validate();};
  $('#start-'+d).onchange=()=>{updateEnds(d);validate();};
}
function edited(event){if(event.target.id)touched.add(event.target.id);$('#submissionError').hidden=true;validate();}
$('#availabilityForm').addEventListener('input',edited);$('#availabilityForm').addEventListener('change',edited);
$('#validation').onclick=event=>{const link=event.target.closest('a');if(!link)return;event.preventDefault();const id=link.hash.slice(1);touched.add(id);validate();focusField(id);};
function message(text){$('#message').textContent=text;$('#message').focus();}
async function load(){try{
  const res=await fetch(base+(test?'/test-form':'/form'),{cache:'no-store'}),data=await res.json();
  if(res.status===401&&!test){$('#accessForm').hidden=false;$('#availabilityForm').hidden=true;message('Entre le même code que pour les demandes de congé.');return;}
  if(!res.ok)throw new Error(data.error||'Chargement impossible.');info=data;
  $('#employee').innerHTML='<option value="">Choisir mon nom</option>'+info.employees.map(e=>`<option value="${e.id}">${escape(e.name)}</option>`).join('');
  $('#department').innerHTML='<option value="">Choisir mon département</option>'+info.departments.map(d=>`<option value="${d.id}">${escape(d.name)}</option>`).join('');
  $('#accessForm').hidden=true;accessGuard.activate();$('#availabilityForm').hidden=false;$('#testBanner').hidden=!test;$('#message').textContent='';updateDepartment();
}catch(error){message(error.message);}}
$('#accessForm').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const res=await fetch('/api/employee-portal/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('#staffCode').value})}),data=await res.json();if(!res.ok)throw new Error(data.error);$('#staffCode').value='';await load();}catch(error){message(error.message);}finally{button.disabled=false;}};
$('#availabilityForm').onsubmit=async event=>{
  event.preventDefault();attempted=true;const {errors,a,p,target,dept,employeeName}=validate();if(sending)return;if(errors.length){focusField(errors[0].fields[0]);return;}sending=true;$('#submissionError').hidden=true;validate();message('Enregistrement…');
  try{
    const body={submissionKey:key,departmentId:dept.id,employeeId:p?.id??null,employeeName,email:$('#email').value,effectiveDate:$('#effectiveDate').value,targetMinutes:target,availability:a,comments:$('#comments').value,acknowledged:$('#acknowledged').checked};
    const res=await fetch(base+(test?'/test-submit':'/submit'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await res.json();if(!res.ok)throw new Error(data.error||'Enregistrement impossible.');
    sessionStorage.removeItem(keyName);$('#availabilityForm').hidden=true;$('#receipt').hidden=false;$('#receipt').innerHTML='<h2>'+ (test?'Test enregistré':'Demande enregistrée')+'</h2><p>Référence '+escape(data.id)+' · '+escape(data.message)+'</p>'+$('#summary').innerHTML;message('La demande a été reçue.');
  }catch(error){$('#message').textContent='';const notice=$('#submissionError');notice.textContent=error.message;notice.hidden=false;notice.focus();}finally{sending=false;validate();}
};load();

const $=s=>document.querySelector(s),days=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=m=>`${Math.floor(m/60)} h ${String(m%60).padStart(2,'0')}`;
const dateText=d=>d?new Intl.DateTimeFormat('fr-CA',{dateStyle:'long',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z')):'…';
const test=location.pathname==='/disponibilites-test',base='/api/leave/availability';
const keyName='availability-submit-key:'+test;let key=sessionStorage.getItem(keyName)||crypto.randomUUID();sessionStorage.setItem(keyName,key);
let info=null,sending=false;
const department=()=>info?.departments.find(d=>String(d.id)===$('#department').value);
const person=()=>department()?.isService?info?.employees.find(e=>String(e.id)===$('#employee').value):null;
const timeOptions=(isStart=false)=>'<option value="">Choisir</option>'+Array.from({length:57},(_,i)=>450+i*15).map(n=>`<option value="${n}"${isStart&&n>1110?' disabled':''}>${time(n)}</option>`).join('');
$('#weekdays').innerHTML=days.slice(0,5).map((day,d)=>`<section class="weekday-card"><h3>${day}</h3><label for="day-${d}">Ma disponibilité le ${day.toLowerCase()}</label><select id="day-${d}" data-day="${d}" required><option value="">Faire un choix</option><option value="none">Indisponible</option><option value="evening">Soir · 17 h à 21 h 30</option><option value="all">Journée · 7 h 30 à 21 h 30</option><option value="custom">Autres heures</option></select><div id="hours-${d}" class="day-hours" hidden><label>Début le ${day.toLowerCase()}<select id="start-${d}">${timeOptions(true)}</select></label><label>Fin le ${day.toLowerCase()}<select id="end-${d}">${timeOptions()}</select></label></div><small>Chaque plage : 3 h minimum.</small></section>`).join('');
function grid(){const result={5:[[450,1290]],6:[[450,1290]]};for(let d=0;d<5;d++){
  const kind=$('#day-'+d).value;result[d]=kind==='none'?[]:kind==='evening'?[[1020,1290]]:kind==='all'?[[450,1290]]:kind==='custom'&&$('#start-'+d).value&&$('#end-'+d).value?[[Number($('#start-'+d).value),Number($('#end-'+d).value)]]:null;
}return result;}
function validate(){
  const a=grid(),p=person(),dept=department(),employeeName=dept?.isService?p?.name||'':$('#employeeName').value.trim(),errors=[];
  if(!dept)errors.push('Choisis ton département.');
  if(dept?.isService&&!p)errors.push('Choisis ton nom complet.');
  if(dept&&!dept.isService&&(employeeName.length<2||employeeName.length>100))errors.push('Inscris ton prénom et ton nom.');
  if(p?.pending)errors.push('Une demande est déjà en attente. Contacte la gestion pour la corriger.');
  if(!$('#effectiveDate').value)errors.push('Indique la date effective.');else if($('#effectiveDate').value<(p?.minEffectiveDate||info?.today))errors.push('La première date possible est le '+dateText(p?.minEffectiveDate||info.today)+'.');
  const target=Number($('#targetHours').value)*60,max=Math.min(p?.maxHours??40,40)*60;
  if(max<600)errors.push('Le maximum autorisé dans ta fiche est inférieur à 10 h. Contacte la gestion pour vérifier ta fiche.');
  else if(!$('#targetHours').value||!Number.isInteger(target)||target%15||target<600||target>max)errors.push(`Indique les heures souhaitées entre 10 et ${max/60} h (par quarts d’heure).`);
  if(!$('#email').value.trim()||!$('#email').validity.valid)errors.push('Indique un courriel valide.');
  for(let d=0;d<5;d++){if(!a[d])errors.push('Complète le '+days[d].toLowerCase()+'.');else if(a[d].some(([a,b])=>b-a<180))errors.push('Prévois au moins 3 h consécutives le '+days[d].toLowerCase()+'.');}
  const evenings=Object.keys(a).map(Number).filter(d=>d<5&&a[d]?.some(([a,b])=>a<=1020&&b>=1290));
  if(evenings.length<2)errors.push('Il faut au moins deux soirs de 17 h à 21 h 30.');
  if(!evenings.some(d=>d===3||d===4))errors.push('Le jeudi ou le vendredi soir doit être disponible.');
  if(!$('#acknowledged').checked)errors.push('Coche « J’ai lu et compris les exigences ».');
  $('#ruleProgress').innerHTML=`<p class="rule-good">✓ Samedi et dimanche : journées complètes</p><p class="${evenings.length>=2?'rule-good':'rule-needed'}">${evenings.length>=2?'✓':'À compléter :'} ${evenings.length} soir(s) choisi(s) sur 2 minimum</p><p class="${evenings.some(d=>d===3||d===4)?'rule-good':'rule-needed'}">${evenings.some(d=>d===3||d===4)?'✓':'À compléter :'} Jeudi ou vendredi soir disponible</p>`;
  $('#summary').innerHTML=`<p><strong>${employeeName?escape(employeeName):'Ton nom reste à compléter'}</strong>${dept?' · '+escape(dept.name):''}</p><p>À compter du ${dateText($('#effectiveDate').value)} · ${escape($('#targetHours').value)||'…'} h souhaitées par semaine</p><ul>${days.map((day,d)=>`<li><strong>${day}</strong> : ${!a[d]?'à compléter':a[d].length?a[d].map(([a,b])=>time(a)+' à '+time(b)).join(', '):'indisponible'}</li>`).join('')}</ul>`;
  $('#validation').innerHTML=errors.length?'<strong>Avant d’envoyer :</strong><ul>'+errors.map(e=>'<li>'+escape(e)+'</li>').join('')+'</ul>':'<p class="rule-good">Tout est complet et conforme.</p>';
  $('#send').disabled=sending||errors.length>0;return {errors,a,p,target,dept,employeeName};
}
function updateDepartment(){
  const d=department(),service=!!d?.isService,manual=!!d&&!service;
  $('#employeeSelectField').hidden=!service;$('#employee').disabled=!service;$('#employee').required=service;
  $('#employeeNameField').hidden=!manual;$('#employeeName').disabled=!manual;$('#employeeName').required=manual;
  $('#departmentInfo').textContent=d?'Ta demande sera envoyée au responsable du département '+d.name+', selon les mêmes réglages que les congés.':'';
  updateEmployee();
}
$('#department').onchange=updateDepartment;
function updateEmployee(){const p=person();$('#effectiveDate').min=p?.minEffectiveDate||info.today;$('#targetHours').max=Math.min(p?.maxHours??40,40);$('#employeeInfo').textContent=p?(p.pending?'Une demande est déjà en attente. Contacte la gestion avant d’en soumettre une autre.':`Première date possible : ${dateText(p.minEffectiveDate)}. Maximum autorisé dans ta fiche : ${p.maxHours} h souhaitées.`):department()&&!department().isService?'Inscris ton nom complet comme sur ton horaire. Le délai de 4 semaines sera vérifié à l’envoi; ton responsable vérifie la demande.':'';validate();}
$('#employee').onchange=updateEmployee;
function updateEnds(d){const start=$('#start-'+d),end=$('#end-'+d),minimum=(Number(start.value)||450)+180;for(const option of end.options)if(option.value)option.disabled=Number(option.value)<minimum;if(end.value&&Number(end.value)<minimum)end.value='';}
for(let d=0;d<5;d++){
  $('#day-'+d).onchange=()=>{const custom=$('#day-'+d).value==='custom';$('#hours-'+d).hidden=!custom;$('#start-'+d).required=$('#end-'+d).required=custom;updateEnds(d);validate();};
  $('#start-'+d).onchange=()=>{updateEnds(d);validate();};
}
$('#availabilityForm').addEventListener('input',validate);$('#availabilityForm').addEventListener('change',validate);
function message(text){$('#message').textContent=text;$('#message').focus();}
async function load(){try{
  const res=await fetch(base+(test?'/test-form':'/form'),{cache:'no-store'}),data=await res.json();
  if(res.status===401&&!test){$('#accessForm').hidden=false;$('#availabilityForm').hidden=true;message('Entre le même code que pour les demandes de congé.');return;}
  if(!res.ok)throw new Error(data.error||'Chargement impossible.');info=data;
  $('#employee').innerHTML='<option value="">Choisir mon nom</option>'+info.employees.map(e=>`<option value="${e.id}">${escape(e.name)}</option>`).join('');
  $('#department').innerHTML='<option value="">Choisir mon département</option>'+info.departments.map(d=>`<option value="${d.id}">${escape(d.name)}</option>`).join('');
  $('#accessForm').hidden=true;$('#availabilityForm').hidden=false;$('#testBanner').hidden=!test;$('#message').textContent='';updateDepartment();
}catch(error){message(error.message);}}
$('#accessForm').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const res=await fetch('/api/leave/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('#staffCode').value})}),data=await res.json();if(!res.ok)throw new Error(data.error);$('#staffCode').value='';await load();}catch(error){message(error.message);}finally{button.disabled=false;}};
$('#availabilityForm').onsubmit=async event=>{
  event.preventDefault();const {errors,a,p,target,dept,employeeName}=validate();if(errors.length||sending)return;sending=true;validate();message('Enregistrement…');
  try{
    const body={submissionKey:key,departmentId:dept.id,employeeId:p?.id??null,employeeName,email:$('#email').value,effectiveDate:$('#effectiveDate').value,targetMinutes:target,availability:a,comments:$('#comments').value,acknowledged:$('#acknowledged').checked};
    const res=await fetch(base+(test?'/test-submit':'/submit'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await res.json();if(!res.ok)throw new Error(data.error||'Enregistrement impossible.');
    sessionStorage.removeItem(keyName);$('#availabilityForm').hidden=true;$('#receipt').hidden=false;$('#receipt').innerHTML='<h2>'+ (test?'Test enregistré':'Demande enregistrée')+'</h2><p>Référence '+escape(data.id)+' · '+escape(data.message)+'</p>'+$('#summary').innerHTML;message('La demande a été reçue.');
  }catch(error){message(error.message);}finally{sending=false;validate();}
};load();

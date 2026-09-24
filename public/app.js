const dayNames=["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const shortDays=["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
const roleNames={cashier:"Caissière",supervisor:"Superviseur",support:"Aide autre département",packer:"Emballeur",orders:"Commandes téléphoniques"};
const scheduleGroups=[{title:"Superviseurs",roles:["supervisor"]},{title:"Caissières",roles:["cashier","support"]},{title:"Emballeurs",roles:["packer"]},{title:"Commandes téléphoniques",roles:["orders"]}];
const state={weekStart:null,week:null,shifts:[],employees:[],assignments:[],timeOff:[],dayExceptions:[],saving:null};
const $=selector=>document.querySelector(selector);
const fmtDate=new Intl.DateTimeFormat("fr-CA",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"});

function mondayOf(value=new Date()){
  const date=new Date(value);date.setUTCHours(12,0,0,0);const day=date.getUTCDay();date.setUTCDate(date.getUTCDate()-(day===0?6:day-1));return date.toISOString().slice(0,10);
}
function addDays(iso,days){const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function minutes(time){const [h,m]=time.split(":").map(Number);return h*60+m;}
function timeText(total){const h=Math.floor(total/60),m=total%60;return `${h} h${m?String(m).padStart(2,"0"):""}`;}
function durationText(value){const h=value/60;return `${h.toLocaleString("fr-CA",{maximumFractionDigits:2})} h`;}
function seniorityText(value){if(!value||value==="9999-12-31")return "À préciser";const [year,month,day]=value.slice(0,10).split("-");return `${day}/${month}/${year}`;}
function formatWeek(start){return `${fmtDate.format(new Date(`${start}T12:00:00Z`))} au ${fmtDate.format(new Date(`${addDays(start,6)}T12:00:00Z`))}`;}
function escapeHtml(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");}
async function api(url,options={}){const response=await fetch(url,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||"Une erreur est survenue.");return body;}
function toast(text){const node=$("#toast");node.textContent=text;node.classList.add("show");setTimeout(()=>node.classList.remove("show"),2200);}
function showError(error){console.error(error);toast(error.message||"Une erreur est survenue.");}

function renderDayChoices(selected=[0]){$("#dayChoices").innerHTML=shortDays.map((day,index)=>`<label class="day-choice"><input type="checkbox" value="${index}" ${selected.includes(index)?"checked":""}><span>${day}</span></label>`).join("");}
function totals(area){return state.shifts.filter(s=>s.area===area).reduce((sum,s)=>sum+s.paidMinutes,0);}
function dayTotal(area,day){return state.shifts.filter(s=>s.area===area&&s.dayIndex===day).reduce((sum,s)=>sum+s.paidMinutes,0);}
function varianceText(actual,budget){const diff=actual-budget;return `${diff>0?"+":""}${durationText(diff)} ${diff===0?"exactement":diff>0?"au-dessus":"sous le budget"}`;}
function renderSummary(){const front=totals("front"),packer=totals("packer"),frontBudget=state.week.cashierBudgetMinutes,packerBudget=state.week.packerBudgetMinutes;$("#frontBudget").value=frontBudget/60;$("#packerBudget").value=packerBudget/60;$("#frontPlanned").textContent=durationText(front);$("#packerPlanned").textContent=durationText(packer);for(const [id,actual,budget] of [["frontVariance",front,frontBudget],["packerVariance",packer,packerBudget]]){const node=$("#"+id);node.textContent=varianceText(actual,budget);node.className=actual===budget?"good":"bad";}}
function assignedName(id){const a=state.assignments.find(a=>a.shiftId===id);return state.employees.find(e=>e.id===a?.employeeId)?.name||"";}
function shiftCard(shift){const detail=shift.role==="support"&&shift.sourceDepartment?` · ${escapeHtml(shift.sourceDepartment)}`:"";const name=assignedName(shift.id);return `<button class="shift-card ${shift.role}" data-id="${shift.id}"><b>${roleNames[shift.role]}${detail}</b><span>${timeText(shift.startMinute)} à ${timeText(shift.endMinute)}</span><small>${durationText(shift.paidMinutes)} payées${shift.breakMinutes?` · pause ${shift.breakMinutes} min`:""}${shift.notes?` · ${escapeHtml(shift.notes)}`:""}</small>${name?`<strong>${escapeHtml(name)}</strong>`:""}</button>`;}
function renderBoard(area,target){$(target).innerHTML=dayNames.map((day,index)=>{const date=addDays(state.weekStart,index);const shifts=state.shifts.filter(s=>s.area===area&&s.dayIndex===index).sort((a,b)=>a.startMinute-b.startMinute);return `<article class="day-column"><div class="day-head"><strong>${day}</strong><small>${fmtDate.format(new Date(`${date}T12:00:00Z`))}</small></div><div class="shift-list">${shifts.length?shifts.map(shiftCard).join(""):'<div class="empty">Aucun quart</div>'}</div><div class="day-total">${durationText(dayTotal(area,index))}</div></article>`;}).join("");document.querySelectorAll(`${target} .shift-card`).forEach(button=>button.onclick=()=>editShift(Number(button.dataset.id)));}
function renderWarnings(){const warnings=[];for(let day=0;day<7;day++){const front=state.shifts.filter(s=>s.area==="front"&&s.dayIndex===day);if(front.length&&!front.some(s=>s.role==="supervisor"))warnings.push(`${shortDays[day]} sans superviseur`);}$("#frontWarnings").innerHTML=warnings.map(w=>`<span class="warning">${w}</span>`).join("");}
function renderPrint(){
  const shiftText=s=>`<div class="print-shift"><span class="print-start">${timeText(s.startMinute)}</span><span class="print-end">${timeText(s.endMinute)}</span>${s.breakMinutes&&s.breakMinutes!==60?`<small>Pause ${s.breakMinutes} min</small>`:""}${s.role==="support"&&s.sourceDepartment?`<small>${escapeHtml(s.sourceDepartment)}</small>`:""}</div>`;
  const buildSection=group=>{
    const groupShifts=state.shifts.filter(s=>group.roles.includes(s.role));
    const employees=state.employees.filter(e=>group.roles.includes(e.role)&&(e.active||state.assignments.some(a=>a.employeeId===e.id))).sort((a,b)=>(a.displayRank??9999)-(b.displayRank??9999)||a.seniority.localeCompare(b.seniority)||a.id-b.id);
    const employeeRows=employees.map(e=>{
      const jobs=groupShifts.filter(s=>state.assignments.some(a=>a.shiftId===s.id&&a.employeeId===e.id));
      const paid=jobs.reduce((sum,s)=>sum+s.paidMinutes,0);
      return `<tr><th scope="row" class="print-name">${e.displayRank??"—"}. ${escapeHtml(e.name)}<small class="print-seniority">Ancienneté : ${seniorityText(e.seniority)}</small></th>${dayNames.map((_,day)=>{const leave=state.timeOff.some(x=>x.employeeId===e.id&&x.dayIndex===day);const shifts=jobs.filter(s=>s.dayIndex===day).sort((a,b)=>a.startMinute-b.startMinute);const unavailable=!e.availability?.[day]?.length;return `<td class="${!leave&&unavailable&&!shifts.length?"print-unavailable":""}">${leave?'<strong class="print-leave">CONGÉ DEMANDÉ</strong>':shifts.length?shifts.map(shiftText).join(""):unavailable?'<span class="print-unavailable-label">Indisponible</span>':""}</td>`;}).join("")}<td class="print-hours">${paid?durationText(paid):"—"}</td></tr>`;
    }).join("");
    const unfilled=groupShifts.filter(s=>!state.assignments.some(a=>a.shiftId===s.id));
    const pendingRow=unfilled.length?`<tr class="print-unfilled"><th scope="row" class="print-name">À couvrir</th>${dayNames.map((_,day)=>`<td>${unfilled.filter(s=>s.dayIndex===day).sort((a,b)=>a.startMinute-b.startMinute).map(shiftText).join("")}</td>`).join("")}<td class="print-hours">${durationText(unfilled.reduce((sum,s)=>sum+s.paidMinutes,0))}</td></tr>`:"";
    const total=groupShifts.reduce((sum,s)=>sum+s.paidMinutes,0);
    return `<section class="print-section"><h2>${group.title}</h2><table class="print-table"><thead><tr><th>Employé</th>${dayNames.map(n=>`<th>${n}</th>`).join("")}<th>Total</th></tr></thead><tbody>${employeeRows||`<tr><td colspan="9">Aucun employé</td></tr>`}${pendingRow}</tbody></table><div class="print-section-summary">Heures planifiées : ${durationText(total)} · ${unfilled.length} quart${unfilled.length>1?"s":""} à couvrir</div></section>`;
  };
  const buildPage=(title,groups)=>`<article class="print-page"><div class="print-title"><div><p>IGA EXTRA FAMILLE BENOIT</p><h1>${title}</h1></div><div class="print-period"><span>SEMAINE DU</span><b>${formatWeek(state.weekStart)}</b><small>Horaire par employé</small></div></div>${groups.map(buildSection).join("")}<div class="print-footer">Imprimé le ${new Date().toLocaleDateString("fr-CA")}</div></article>`;
  $("#printSheet").innerHTML=[buildPage("Superviseurs et commandes",[scheduleGroups[0],scheduleGroups[3]]),buildPage("Caissières",[scheduleGroups[1]]),buildPage("Emballeurs",[scheduleGroups[2]])].join("");
}
function render(){$("#weekLabel").textContent=formatWeek(state.weekStart);$("#weekPicker").value=state.weekStart;$("#weekNotes").value=state.week.notes||"";renderSummary();renderBoard("front","#frontBoard");renderBoard("packer","#packerBoard");renderWarnings();renderPrint();renderSchedule();}
async function loadWeek(start){state.weekStart=mondayOf(new Date(`${start}T12:00:00Z`));$("#saveStatus").textContent="Chargement…";const data=await api(`/api/weeks/${state.weekStart}`);state.week=data.week;state.shifts=data.shifts;state.assignments=(await api(`/api/weeks/${state.weekStart}/assignments`)).assignments;state.timeOff=(await api(`/api/weeks/${state.weekStart}/time-off`)).timeOff;state.dayExceptions=(await api(`/api/weeks/${state.weekStart}/day-exceptions`)).employeeIds;resetForm();resetEmployeeForm();render();$("#saveStatus").textContent="Tout est enregistré";}

function windowText(windows){return (windows||[]).map(([a,b])=>`${String(Math.floor(a/60)).padStart(2,"0")}:${String(a%60).padStart(2,"0")}-${String(Math.floor(b/60)).padStart(2,"0")}:${String(b%60).padStart(2,"0")}`).join(", ");}
function parseWindow(value){if(!value.trim())return [];return value.split(",").map(part=>{const match=part.trim().match(/^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-4]):([0-5]\d)$/);if(!match)throw new Error("Utilise le format 08:00-17:00.");const a=Number(match[1])*60+Number(match[2]),b=Number(match[3])*60+Number(match[4]);if(a>=b||b>1440)throw new Error("Plage de disponibilité invalide.");return [a,b];});}
function resetEmployeeForm(){$("#employeeForm").reset();$("#employeeId").value="";$("#employeeTarget").value="17";$("#employeeMax").value="40";$("#saveEmployee").textContent="Ajouter l’employé";}
function editEmployee(id){const e=state.employees.find(p=>p.id===id);if(!e)return;$("#employeeId").value=e.id;$("#employeeName").value=e.name;$("#employeeRole").value=e.role;$("#employeeSeniority").value=e.seniority==="9999-12-31"?"":e.seniority;$("#employeeTarget").value=e.targetMinutes/60;$("#employeeMax").value=e.maxMinutes/60;$("#employeeMinor").checked=!!e.isMinor;$("#employeeExtraHours").checked=!!e.allowExtraHours;$("#employeeSixOrSevenDays").checked=state.dayExceptions.includes(e.id);$("#employeeNotes").value=e.notes;$("#employeeDisplayRank").value=e.displayRank??"";$("#employeeAssignmentRank").value=e.assignmentRank??"";$("#employeeActive").checked=e.active;for(let d=0;d<7;d++){ $("#availability"+d).value=windowText(e.availability?.[d]); $("#timeOff"+d).checked=state.timeOff.some(x=>x.employeeId===e.id&&x.dayIndex===d); }$("#saveEmployee").textContent="Enregistrer l’employé";$("#employeeForm").scrollIntoView({behavior:"smooth"});}
function renderEmployees(){
  $("#employeeList").innerHTML=scheduleGroups.map(group=>`<section class="employee-group"><h3>${group.title}</h3>${state.employees.filter(e=>group.roles.includes(e.role)).sort((a,b)=>(a.displayRank??9999)-(b.displayRank??9999)||a.seniority.localeCompare(b.seniority)||a.id-b.id).map(e=>`<button type="button" class="employee-row" data-id="${e.id}"><b>${e.displayRank??"—"}. ${escapeHtml(e.name)}</b><span>Ancienneté : ${seniorityText(e.seniority)}</span><span>Priorité quarts : ${e.assignmentRank??"—"} · ${durationText(e.targetMinutes)} souhaitées${e.isMinor?" · 17 ans ou moins":""}${e.allowExtraHours?" · Heures supplémentaires autorisées":""}${state.dayExceptions.includes(e.id)?" · 6 ou 7 jours autorisés cette semaine":""}${e.active?"":" · Inactif"}</span><span>Modifier la disponibilité permanente →</span></button>`).join("")||"<p>Aucun employé</p>"}</section>`).join("");
  document.querySelectorAll(".employee-row").forEach(b=>b.onclick=()=>editEmployee(Number(b.dataset.id)));
}
async function loadEmployees(){state.employees=(await api("/api/employees")).employees;renderEmployees();renderSchedule();}
function availableForShift(employee,shift){
  if(!employee.active||employee.role!==shift.role||state.timeOff.some(x=>x.employeeId===employee.id&&x.dayIndex===shift.dayIndex))return false;
  return (employee.availability?.[shift.dayIndex]||[]).some(([start,end])=>start<=shift.startMinute&&end>=shift.endMinute);
}
function shiftAvailabilityPanel(shift){
  const people=state.employees.filter(e=>e.role===shift.role&&e.active).sort((a,b)=>(a.displayRank??9999)-(b.displayRank??9999));
  const rows=people.map(e=>{
    const leave=state.timeOff.some(x=>x.employeeId===e.id&&x.dayIndex===shift.dayIndex);
    const assigned=state.assignments.filter(a=>a.employeeId===e.id).map(a=>state.shifts.find(s=>s.id===a.shiftId)).filter(Boolean);
    const dayJob=assigned.find(s=>s.dayIndex===shift.dayIndex);
    const windows=e.availability?.[shift.dayIndex]||[];
    const constraints=[];
    if(leave)constraints.push("Congé demandé");
    if(dayJob)constraints.push(`Déjà assigné ${timeText(dayJob.startMinute)}–${timeText(dayJob.endMinute)}`);
    if(!state.dayExceptions.includes(e.id)&&assigned.length>=5&&!dayJob)constraints.push("5 jours atteints");
    const remaining=e.maxMinutes-assigned.reduce((sum,s)=>sum+s.paidMinutes,0);
    if(remaining<shift.paidMinutes)constraints.push(`Maximum hebdomadaire : ${durationText(Math.max(0,remaining))} restantes`);
    if(e.isMinor&&(assigned.reduce((sum,s)=>sum+s.paidMinutes,0)+shift.paidMinutes>1020||shift.dayIndex<5&&assigned.filter(s=>s.dayIndex<5).length>=2))constraints.push("Limite de 17 ans et moins");
    const covers=windows.some(([start,end])=>start<=shift.startMinute&&end>=shift.endMinute);
    return `<li><b>${escapeHtml(e.name)}</b><span>${leave?"Congé demandé":windows.length?escapeHtml(windowText(windows)):"Indisponible ce jour"}</span>${constraints.length?`<small>${escapeHtml(constraints.join(" · "))}</small>`:!covers&&windows.length?"<small>La plage ne couvre pas le quart actuel</small>":""}</li>`;
  }).join("");
  return `<details class="shift-availability"><summary>Voir les disponibilités ${shortDays[shift.dayIndex]}</summary><ul>${rows||"<li>Aucun employé actif dans cette fonction</li>"}</ul><button type="button" class="secondary edit-unfilled-shift" data-id="${shift.id}">Modifier ce quart</button></details>`;
}
function renderSchedule(){
  if(!state.week)return;
  const missing=state.shifts.filter(s=>!assignedName(s.id));
  $("#scheduleStatus").textContent=`${state.shifts.length-missing.length} quarts attribués sur ${state.shifts.length}. ${missing.length} à couvrir.`;
  $("#scheduleBoard").innerHTML=scheduleGroups.map(group=>`<section class="schedule-group"><h3>${group.title}</h3><div class="schedule-grid">${dayNames.map((name,day)=>`<div class="schedule-day"><h4>${name}</h4>${state.shifts.filter(s=>group.roles.includes(s.role)&&s.dayIndex===day).sort((a,b)=>a.startMinute-b.startMinute).map(s=>`<label class="schedule-item${s.role!=="support"&&!state.assignments.some(a=>a.shiftId===s.id)?" schedule-item-unfilled":""}"><span>${timeText(s.startMinute)}–${timeText(s.endMinute)}${s.role==="support"?` · ${roleNames.support}`:""}</span><select data-shift="${s.id}" ${s.role==="support"?"disabled":""}><option value="">${s.role==="support"?"Autre département":"À couvrir"}</option>${state.employees.filter(e=>e.role===s.role&&(availableForShift(e,s)||state.assignments.some(a=>a.shiftId===s.id&&a.employeeId===e.id))).map(e=>`<option value="${e.id}" ${state.assignments.some(a=>a.shiftId===s.id&&a.employeeId===e.id)?"selected":""}>${escapeHtml(e.name)}${availableForShift(e,s)?"":" (déjà attribué, hors disponibilité)"}</option>`).join("")}</select></label>${s.role!=="support"&&!state.assignments.some(a=>a.shiftId===s.id)?shiftAvailabilityPanel(s):""}`).join("")||"<small>Aucun quart</small>"}</div>`).join("")}</div></section>`).join("");
  $("#employeeTotals").innerHTML="<h3>Heures par employé</h3>"+scheduleGroups.map(group=>`<div class="total-group"><strong>${group.title}</strong>${state.employees.filter(e=>group.roles.includes(e.role)&&state.assignments.some(a=>a.employeeId===e.id)).map(e=>{const paid=state.assignments.filter(a=>a.employeeId===e.id).reduce((sum,a)=>sum+(state.shifts.find(s=>s.id===a.shiftId)?.paidMinutes||0),0);return `<span>${escapeHtml(e.name)} : ${durationText(paid)} / ${durationText(e.targetMinutes)} souhaitées</span>`;}).join("")||"<span>Aucun quart attribué</span>"}</div>`).join("");
  document.querySelectorAll(".schedule-item select").forEach(select=>select.onchange=async()=>{try{await api(`/api/shifts/${select.dataset.shift}/assignment`,{method:"PUT",body:JSON.stringify({employeeId:select.value?Number(select.value):null})});state.assignments=(await api(`/api/weeks/${state.weekStart}/assignments`)).assignments;render();toast("Horaire enregistré");}catch(error){showError(error);renderSchedule();}});
  document.querySelectorAll(".edit-unfilled-shift").forEach(button=>button.onclick=()=>editShift(Number(button.dataset.id)));
}
async function saveWeek(){clearTimeout(state.saving);$("#saveStatus").textContent="Enregistrement…";const result=await api(`/api/weeks/${state.weekStart}`,{method:"PUT",body:JSON.stringify({cashierBudgetMinutes:Math.round(Number($("#frontBudget").value||0)*60),packerBudgetMinutes:Math.round(Number($("#packerBudget").value||0)*60),notes:$("#weekNotes").value})});state.week=result.week;renderSummary();renderPrint();$("#saveStatus").textContent="Tout est enregistré";}
function queueSave(){clearTimeout(state.saving);state.saving=setTimeout(()=>saveWeek().catch(showError),600);}
function resetForm(day=0){$("#shiftForm").reset();$("#shiftId").value="";$("#role").value="cashier";$("#startTime").value="08:00";$("#endTime").value="16:00";$("#breakMinutes").value="0";renderDayChoices([day]);$("#submitShift").textContent="Ajouter le quart";$("#cancelEdit").hidden=true;$("#deleteShift").hidden=true;$("#departmentWrap").hidden=true;}
function editShift(id){const s=state.shifts.find(x=>x.id===id);if(!s)return;$("#shiftId").value=s.id;$("#role").value=s.role;$("#startTime").value=`${String(Math.floor(s.startMinute/60)).padStart(2,"0")}:${String(s.startMinute%60).padStart(2,"0")}`;$("#endTime").value=`${String(Math.floor(s.endMinute/60)).padStart(2,"0")}:${String(s.endMinute%60).padStart(2,"0")}`;$("#breakMinutes").value=String(s.breakMinutes);$("#sourceDepartment").value=s.sourceDepartment;$("#shiftNotes").value=s.notes;renderDayChoices([s.dayIndex]);document.querySelectorAll("#dayChoices input").forEach(input=>input.onchange=()=>{if(input.checked)document.querySelectorAll("#dayChoices input").forEach(other=>{if(other!==input)other.checked=false;});});$("#departmentWrap").hidden=s.role!=="support";$("#submitShift").textContent="Enregistrer le quart";$("#cancelEdit").hidden=false;$("#deleteShift").hidden=false;$("#shiftForm").scrollIntoView({behavior:"smooth",block:"center"});}

$("#loginForm").onsubmit=async event=>{event.preventDefault();try{await api("/api/login",{method:"POST",body:JSON.stringify({code:$("#loginCode").value})});$("#loginView").hidden=true;$("#appView").hidden=false;await loadEmployees();await loadWeek(mondayOf());}catch(error){$("#loginError").textContent=error.message;}};
$("#logoutBtn").onclick=async()=>{await api("/api/logout",{method:"POST"});location.reload();};
$("#prevWeek").onclick=()=>loadWeek(addDays(state.weekStart,-7)).catch(showError);$("#nextWeek").onclick=()=>loadWeek(addDays(state.weekStart,7)).catch(showError);$("#weekPicker").onchange=e=>loadWeek(e.target.value).catch(showError);
$("#copyPrevious").onclick=async()=>{if(!confirm("Copier tous les quarts et budgets de la semaine précédente?"))return;try{await api(`/api/weeks/${state.weekStart}/copy-previous`,{method:"POST"});await loadWeek(state.weekStart);toast("Semaine précédente copiée");}catch(error){showError(error);}};
$("#role").onchange=e=>{$("#departmentWrap").hidden=e.target.value!=="support";};
$("#shiftForm").onsubmit=async event=>{event.preventDefault();try{const id=Number($("#shiftId").value)||null;const days=[...document.querySelectorAll("#dayChoices input:checked")].map(x=>Number(x.value));const body={role:$("#role").value,startMinute:minutes($("#startTime").value),endMinute:minutes($("#endTime").value),breakMinutes:Number($("#breakMinutes").value),sourceDepartment:$("#sourceDepartment").value,notes:$("#shiftNotes").value};if(id){body.dayIndex=days[0];const result=await api(`/api/shifts/${id}`,{method:"PUT",body:JSON.stringify(body)});state.shifts=state.shifts.map(s=>s.id===id?result.shift:s);}else{const result=await api(`/api/weeks/${state.weekStart}/shifts`,{method:"POST",body:JSON.stringify({...body,days})});state.shifts.push(...result.shifts);}resetForm(days[0]||0);render();toast(id?"Quart modifié":"Quart ajouté");}catch(error){showError(error);}};
$("#cancelEdit").onclick=()=>resetForm();$("#deleteShift").onclick=async()=>{const id=Number($("#shiftId").value);if(!id||!confirm("Supprimer ce quart?"))return;try{await api(`/api/shifts/${id}`,{method:"DELETE"});state.shifts=state.shifts.filter(s=>s.id!==id);resetForm();render();toast("Quart supprimé");}catch(error){showError(error);}};
for(const id of ["frontBudget","packerBudget","weekNotes"])$("#"+id).oninput=queueSave;
$("#printBtn").onclick=()=>{document.body.classList.remove("printing-planogram");renderPrint();$("#printPreview").close();window.print();};
$("#previewBtn").onclick=()=>{renderPrint();$("#previewPages").innerHTML=$("#printSheet").innerHTML;$("#printPreview").showModal();};
$("#previewClose").onclick=()=>$("#printPreview").close();
$("#previewPrint").onclick=()=>{document.body.classList.remove("printing-planogram");$("#printPreview").close();window.print();};
$("#planoBtn").onclick=()=>{$("#planoPrintSheet").innerHTML=window.createPlanogram(state);$("#planoPreviewPages").innerHTML=$("#planoPrintSheet").innerHTML;$("#planoPreview").showModal();};
$("#planoClose").onclick=()=>$("#planoPreview").close();
$("#planoPrint").onclick=()=>{$("#planoPreview").close();document.body.classList.add("printing-planogram");window.print();};
window.addEventListener("afterprint",()=>document.body.classList.remove("printing-planogram"));

renderDayChoices();
$("#availabilityFields").innerHTML=shortDays.map((name,d)=>`<label>${name}<input id="availability${d}" placeholder="08:00-17:00"></label>`).join("");
$("#timeOffFields").innerHTML=shortDays.map((name,d)=>`<label><input id="timeOff${d}" type="checkbox"> ${name}</label>`).join("");
$("#employeeForm").onsubmit=async event=>{event.preventDefault();try{const id=$("#employeeId").value;const availability={};for(let d=0;d<7;d++)availability[d]=parseWindow($("#availability"+d).value);const body={name:$("#employeeName").value,role:$("#employeeRole").value,seniority:$("#employeeSeniority").value,displayRank:$("#employeeDisplayRank").value||null,assignmentRank:$("#employeeAssignmentRank").value||null,targetMinutes:Math.round(Number($("#employeeTarget").value)*60),maxMinutes:Math.round(Number($("#employeeMax").value)*60),isMinor:$("#employeeMinor").checked,allowExtraHours:$("#employeeExtraHours").checked,availability,notes:$("#employeeNotes").value,active:$("#employeeActive").checked};const saved=await api(id?`/api/employees/${id}`:"/api/employees",{method:id?"PUT":"POST",body:JSON.stringify(body)});const employeeId=saved.employee.id;await api(`/api/weeks/${state.weekStart}/employees/${employeeId}/day-exception`,{method:"PUT",body:JSON.stringify({allowed:$("#employeeSixOrSevenDays").checked})});state.dayExceptions=(await api(`/api/weeks/${state.weekStart}/day-exceptions`)).employeeIds;const days=Array.from({length:7},(_,d)=>d).filter(d=>$("#timeOff"+d).checked);await api(`/api/weeks/${state.weekStart}/employees/${employeeId}/time-off`,{method:"PUT",body:JSON.stringify({days})});state.timeOff=(await api(`/api/weeks/${state.weekStart}/time-off`)).timeOff;state.assignments=(await api(`/api/weeks/${state.weekStart}/assignments`)).assignments;resetEmployeeForm();await loadEmployees();render();toast("Employé et congés enregistrés");}catch(error){showError(error);}};
$("#clearEmployee").onclick=resetEmployeeForm;
$("#employeeImport").onchange=async event=>{try{const file=event.target.files[0];if(!file)return;const data=JSON.parse(await file.text());const result=await api("/api/employees/import",{method:"POST",body:JSON.stringify(data)});await loadEmployees();toast(`${result.count} employés importés`);}catch(error){showError(error);}finally{event.target.value="";}};
$("#generateSchedule").onclick=async()=>{try{const result=await api(`/api/weeks/${state.weekStart}/generate`,{method:"POST"});state.assignments=(await api(`/api/weeks/${state.weekStart}/assignments`)).assignments;render();toast(`${result.assignments.length} quarts attribués; ${result.unfilled.length} à couvrir`);}catch(error){showError(error);}};
$("#regenerateSchedule").onclick=async()=>{
  if(!confirm("Recréer toutes les affectations de cette semaine selon les priorités actuelles? Les choix faits à la main seront remplacés."))return;
  try{
    const result=await api(`/api/weeks/${state.weekStart}/generate`,{method:"POST",body:JSON.stringify({replaceAll:true})});
    state.assignments=(await api(`/api/weeks/${state.weekStart}/assignments`)).assignments;
    render();
    toast(`${result.assignments.length} quarts attribués; ${result.unfilled.length} à couvrir`);
  }catch(error){showError(error);}
};
api("/api/session").then(async session=>{if(session.role==="manager"){$("#loginView").hidden=true;$("#appView").hidden=false;await loadEmployees();await loadWeek(mondayOf());}}).catch(()=>{});


$("#employeeMinor").onchange=event=>{if(event.target.checked&&Number($("#employeeTarget").value)>17)$("#employeeTarget").value="17";};

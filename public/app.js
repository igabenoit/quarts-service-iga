import {serviceShiftTiming} from './service-rules.js';
const dayNames=["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const shortDays=["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
const roleNames={manager:"Gérante",cashier:"Caissière",supervisor:"Superviseur",support:"Aide autre département",packer:"Emballeur",orders:"Commandes téléphoniques"};
const employeeRoles=["manager","supervisor","cashier","packer","orders"];
function canWorkRole(employee,role){return (employee.roles||[employee.role]).includes(role);}
function compareDisplayOrder(a,b){return Number(b.role==='manager')-Number(a.role==='manager')||(a.displayRank??9999)-(b.displayRank??9999)||(a.seniority||'9999').localeCompare(b.seniority||'9999')||a.id-b.id;}
const scheduleGroups=[{title:"Gérante et superviseurs",roles:["manager","supervisor"]},{title:"Caissières",roles:["cashier","support"]},{title:"Emballeurs",roles:["packer"]},{title:"Commandes téléphoniques",roles:["orders"]}];
const state={weekStart:null,week:null,shifts:[],employees:[],assignments:[],timeOff:[],approvedLeaves:[],dayExceptions:[],saving:null,sharePath:null};
const $=selector=>document.querySelector(selector);
const fmtDate=new Intl.DateTimeFormat("fr-CA",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"});

function mondayOf(value=new Date()){
  const date=new Date(value);date.setUTCHours(12,0,0,0);const day=date.getUTCDay();date.setUTCDate(date.getUTCDate()-(day===0?6:day-1));return date.toISOString().slice(0,10);
}
function addDays(iso,days){const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function upcomingWeekStart(value=new Date()){
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Toronto",year:"numeric",month:"2-digit",day:"2-digit"}).format(value);
  return addDays(mondayOf(`${today}T12:00:00Z`),7);
}
function minutes(time){const [h,m]=time.split(":").map(Number);return h*60+m;}
function timeText(total){const h=Math.floor(total/60),m=total%60;return `${h} h${m?String(m).padStart(2,"0"):""}`;}
function durationText(value){const h=value/60;return `${h.toLocaleString("fr-CA",{maximumFractionDigits:2})} h`;}
function seniorityText(value){if(!value||value==="9999-12-31")return "À préciser";const [year,month,day]=value.slice(0,10).split("-");return `${day}/${month}/${year}`;}
function formatWeek(start){return `${fmtDate.format(new Date(`${start}T12:00:00Z`))} au ${fmtDate.format(new Date(`${addDays(start,6)}T12:00:00Z`))}`;}
function escapeHtml(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");}
async function api(url,options={}){const response=await undoControl.request(url,{...options,headers:{"Content-Type":"application/json",...(options.undoGroup?{"X-Undo-Group":options.undoGroup}:{}),...(options.headers||{})}});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||"Une erreur est survenue.");return body;}
function toast(text){const node=$("#toast");node.textContent=text;node.classList.add("show");setTimeout(()=>node.classList.remove("show"),2200);}
function showError(error){console.error(error);toast(error.message||"Une erreur est survenue.");}

function renderDayChoices(selected=[0]){$("#dayChoices").innerHTML=shortDays.map((day,index)=>`<label class="day-choice"><input type="checkbox" value="${index}" ${selected.includes(index)?"checked":""}><span>${day}</span></label>`).join("");}
function totals(area){return state.shifts.filter(s=>s.area===area).reduce((sum,s)=>sum+s.paidMinutes,0);}
function dayTotal(area,day){return state.shifts.filter(s=>s.area===area&&s.dayIndex===day).reduce((sum,s)=>sum+s.paidMinutes,0);}
function varianceText(actual,budget){const diff=actual-budget;return `${diff>0?"+":""}${durationText(diff)} ${diff===0?"exactement":diff>0?"au-dessus":"sous le budget"}`;}
function renderSummary(){const front=totals("front"),packer=totals("packer"),frontBudget=state.week.cashierBudgetMinutes,packerBudget=state.week.packerBudgetMinutes;const byRole=role=>state.shifts.filter(s=>s.role===role).reduce((sum,s)=>sum+s.paidMinutes,0);const cashier=byRole("cashier"),supervisor=byRole("supervisor"),manager=byRole("manager");$("#combinedPlanned").textContent=durationText(cashier+supervisor+manager+packer);$("#combinedBreakdown").textContent=`Gérante ${durationText(manager)} + caissières ${durationText(cashier)} + superviseurs ${durationText(supervisor)} + emballeurs ${durationText(packer)}`;$("#frontBudget").value=frontBudget/60;$("#packerBudget").value=packerBudget/60;$("#frontPlanned").textContent=durationText(front);$("#packerPlanned").textContent=durationText(packer);for(const [id,actual,budget] of [["frontVariance",front,frontBudget],["packerVariance",packer,packerBudget]]){const node=$("#"+id);node.textContent=varianceText(actual,budget);node.className=actual===budget?"good":"bad";}}
function assignedName(id){const a=state.assignments.find(a=>a.shiftId===id);return state.employees.find(e=>e.id===a?.employeeId)?.name||"";}
function shiftCard(shift){const detail=shift.role==="support"&&shift.sourceDepartment?` · ${escapeHtml(shift.sourceDepartment)}`:"";const name=assignedName(shift.id);return `<button class="shift-card ${shift.role}" data-id="${shift.id}"><b>${roleNames[shift.role]}${detail}</b><span>${timeText(shift.startMinute)} à ${timeText(shift.endMinute)}</span><small>${durationText(shift.paidMinutes)} payées${shift.breakMinutes?` · repas ${shift.breakMinutes} min non payé`:""}${shift.notes?` · ${escapeHtml(shift.notes)}`:""}</small>${name?`<strong>${escapeHtml(name)}</strong>`:""}</button>`;}
function renderBoard(area,target){$(target).innerHTML=dayNames.map((day,index)=>{const date=addDays(state.weekStart,index);const shifts=state.shifts.filter(s=>s.area===area&&s.dayIndex===index).sort((a,b)=>a.startMinute-b.startMinute);return `<article class="day-column"><div class="day-head"><strong>${day}</strong><small>${fmtDate.format(new Date(`${date}T12:00:00Z`))}</small></div><div class="shift-list">${shifts.length?shifts.map(shiftCard).join(""):'<div class="empty">Aucun quart</div>'}</div><div class="day-total">${durationText(dayTotal(area,index))}</div></article>`;}).join("");document.querySelectorAll(`${target} .shift-card`).forEach(button=>button.onclick=()=>editShift(Number(button.dataset.id)));}
function renderWarnings(){const warnings=[];for(let day=0;day<7;day++){const front=state.shifts.filter(s=>s.area==="front"&&s.dayIndex===day);if(front.length&&!front.some(s=>s.role==="supervisor"||s.role==="manager"))warnings.push(`${shortDays[day]} sans gérante ni superviseur`);}$("#frontWarnings").innerHTML=warnings.map(w=>`<span class="warning">${w}</span>`).join("");}
function servicePrintHTML(data){
  const e=escapeHtml,hours=n=>(n/60).toLocaleString('fr-CA',{maximumFractionDigits:2}),time=n=>n>1440?time(n%1440)+' +1':`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
  const shortTime=n=>`${Math.floor(n/60)}${n%60?'h'+String(n%60).padStart(2,'0'):''}`;
  const paid=s=>serviceShiftTiming(s.startMinute,s.endMinute).paidMinutes;
  const assigned=new Map(data.assignments.map(a=>[a.shiftId,a.employeeId]));
  const shiftHTML=(s,role)=>`<div class="service-shift${role&&s.role!==role?' cross-role':''}">${role&&s.role!==role?`<small class="service-role">${e(roleNames[s.role]||s.role)}</small>`:''}<span class="print-start">${time(s.startMinute)}</span><span class="print-end">${time(s.endMinute)}</span>${s.role==='support'&&s.sourceDepartment?`<small>${e(s.sourceDepartment)}</small>`:''}</div>`;
  const availability=(person,day)=>{const windows=person.availability?.[day]||[];return !windows.length?'0':windows.some(([a,b])=>a===0&&b===1440)?'J':windows.map(([a,b])=>shortTime(a)+'–'+shortTime(b)).join(' / ');};
  const approved=(id,day)=>data.approvedLeaves.filter(r=>Number(r.employee_id)===id).flatMap(r=>r.periods).filter(p=>p.date===addDays(data.weekStart,day));
  const cell=(person,jobs,day,pending=false)=>{
    const shifts=jobs.filter(s=>s.dayIndex===day).sort((a,b)=>a.startMinute-b.startMinute),periods=pending?[]:approved(person.id,day);
    const manual=!pending&&data.timeOff.some(t=>t.employeeId===person.id&&t.dayIndex===day);
    const birthday=!pending&&person.birthday&&person.birthday.slice(5)===addDays(data.weekStart,day).slice(5);
    const labels=periods.map(p=>`<strong class="print-leave">CONGÉ APPROUVÉ${p.allDay?'':`<br>${time(p.startMinute)}–${time(p.endMinute)}`}</strong>`).join('')+(manual?'<strong class="print-leave">CONGÉ DEMANDÉ</strong>':'');
    const unavailable=!pending&&!person.availability?.[day]?.length&&!shifts.length&&!labels;
    const content=(birthday?'<small class="birthday-greeting">Bonne fête !</small>':'')+labels+shifts.map(s=>shiftHTML(s,person.role)).join('')+(unavailable?'<small class="service-unavailable">Indisponible</small>':'');
    const workHeight=shifts.reduce((n,s)=>n+21+(person.role&&s.role!==person.role?Math.ceil((roleNames[s.role]||s.role).length/10)*6:0)+(s.sourceDepartment?Math.ceil(s.sourceDepartment.length/10)*7:0),0)+periods.reduce((n,p)=>n+(p.allDay?16:25),0)+(manual?16:0)+(birthday?9:0);
    return {content,unavailable,hours:shifts.length?hours(shifts.reduce((n,s)=>n+paid(s),0)):'',availability:pending?'':availability(person,day),height:workHeight+13};
  };
  const row=(person,jobs,group,pending=false)=>{
    const cells=dayNames.map((_,d)=>cell(person,jobs,d,pending));
    const units=Math.max(1,Math.ceil(Math.max(...cells.map(c=>c.height),Math.ceil(person.name.length/21)*11+8)/42));
    return {person,cells,group,pending,units,minutes:jobs.reduce((n,s)=>n+paid(s),0)};
  };
  const rowsFor=group=>{
    const people=data.employees.filter(p=>group.roles.includes(p.role)&&(p.active||data.assignments.some(a=>a.employeeId===p.id))).sort(compareDisplayOrder);
    const rows=people.map(p=>row(p,data.shifts.filter(s=>assigned.get(s.id)===p.id),group.title));
    const unfilled=data.shifts.filter(s=>group.roles.includes(s.role)&&!assigned.has(s.id)).sort((a,b)=>a.startMinute-b.startMinute);
    const byDay=dayNames.map((_,d)=>unfilled.filter(s=>s.dayIndex===d));
    for(let i=0;i<Math.max(0,...byDay.map(day=>day.length));i++)rows.push(row({name:'À couvrir',role:null},byDay.map(day=>day[i]).filter(Boolean),group.title,true));
    return rows;
  };
  const plans=[{title:'Gérante, superviseurs et commandes',groups:[scheduleGroups[0],scheduleGroups[3]]},{title:'Caissières',groups:[scheduleGroups[1]]},{title:'Emballeurs',groups:[scheduleGroups[2]]}];
  const pages=plans.map(plan=>{
    const rows=plan.groups.flatMap(rowsFor),units=rows.reduce((sum,row)=>sum+row.units,0);
    return {...plan,rows,units,rowUnit:Math.max(32,Math.min(42,Math.floor(588/Math.max(14,units))))};
  });
  const total=data.shifts.reduce((n,s)=>n+paid(s),0),unfilledMinutes=data.shifts.filter(s=>!assigned.has(s.id)).reduce((n,s)=>n+paid(s),0);
  const rowHTML=r=>`<tr class="sheet-person${r.pending?' service-unfilled':''}" data-row-units="${Math.min(15,r.units)}"${r.person.id?` data-person="${r.person.id}"`:''}><th scope="row" class="sheet-name"><div class="sheet-person-label">${e(r.person.name)}</div>${r.person.role==='manager'?'<small>Gérante</small>':''}</th><td class="sheet-seniority">${r.pending?'':e(seniorityText(r.person.seniority))}</td>${r.cells.map(c=>`<td class="sheet-day${c.unavailable?' service-off':''}"><div class="sheet-work">${c.content}</div><div class="sheet-day-detail"><span>${c.hours}</span><span>${e(c.availability)}</span></div></td>`).join('')}<td class="sheet-total print-hours">${r.minutes?hours(r.minutes):'—'}</td></tr>`;
  const blankRow=()=>`<tr class="sheet-person blank-row"><th class="sheet-name"><div class="sheet-person-label"></div></th><td></td>${dayNames.map(()=>'<td><div class="sheet-work"></div><div class="sheet-day-detail"><span></span><span></span></div></td>').join('')}<td></td></tr>`;
  return pages.map((page,index)=>{
    const groupNames=[...new Set(page.rows.map(r=>r.group))];if(!groupNames.length)groupNames.push(page.title);
    const subtotal=page.rows.reduce((n,r)=>n+r.minutes,0),vacant=page.rows.filter(r=>r.pending).reduce((n,r)=>n+r.minutes,0);
    const table=groupNames.map((name,i)=>{const rows=page.rows.filter(r=>r.group===name),sum=rows.reduce((n,r)=>n+r.minutes,0);return `<tbody><tr class="sheet-group"><th colspan="10">${e(name)}</th></tr>${rows.map(rowHTML).join('')}${i===groupNames.length-1?Array.from({length:Math.max(0,14-page.units)},blankRow).join(''):''}<tr class="sheet-subtotal"><td colspan="9">Sous-total sur cette feuille · ${e(name)}</td><td>${hours(sum)}</td></tr></tbody>`;}).join('');
    return `<article class="service-sheet${page.units>14?' compact-service':''}" data-page="${index+1}" data-row-unit="${page.rowUnit}"><header class="sheet-header"><img src="/logo-famille-benoit.svg" alt="IGA extra Famille Benoit"><div><h1>Service</h1><p>HORAIRE HEBDOMADAIRE · ${e(page.title)}</p><strong>Du ${formatWeek(data.weekStart)}</strong><small>Feuille ${index+1} / ${pages.length}</small></div></header><table class="sheet-table"><colgroup><col class="col-name"><col class="col-seniority">${'<col class="col-day">'.repeat(7)}<col class="col-total"></colgroup><thead><tr><th>Employé</th><th>Ancienneté</th>${dayNames.map((d,i)=>`<th>${d.slice(0,3)}.<br><small>${addDays(data.weekStart,i).slice(8)}</small></th>`).join('')}<th>Total<br><small>heures</small></th></tr></thead>${table}</table><div class="sheet-bottom"><div class="sheet-totals"><strong>Cette feuille : ${hours(subtotal)} h</strong><span>dont ${hours(vacant)} h à couvrir</span></div></div><div class="service-week-total"><strong>Service · semaine complète : ${hours(total)} h</strong><span>dont ${hours(unfilledMinutes)} h à couvrir · Total identique sur chaque feuille</span></div><div class="sheet-notes"><strong>Notes / précisions</strong><p></p></div></article>`;
  }).join('');
}
function renderPrint(){$('#printSheet').innerHTML=servicePrintHTML(state);}

function render(){$("#weekLabel").textContent=formatWeek(state.weekStart);$("#weekPicker").value=state.weekStart;$("#weekNotes").value=state.week.notes||"";renderSummary();renderBoard("front","#frontBoard");renderBoard("packer","#packerBoard");renderWarnings();renderPrint();renderSchedule();}
async function loadWeek(start){document.querySelectorAll("#planoBtn,#presenceBtn").forEach(b=>b.disabled=true);$("#assignmentMessage").hidden=true;$("#assignmentMessage").textContent="";state.weekStart=mondayOf(new Date(`${start}T12:00:00Z`));state.employees=(await api(`/api/employees?weekStart=${state.weekStart}`)).employees;renderEmployees();state.approvedLeaves=(await api(`/api/leave/week/${state.weekStart}`)).leaves;$("#saveStatus").textContent="Chargement…";const data=await api(`/api/weeks/${state.weekStart}`);state.week=data.week;state.shifts=data.shifts;state.assignments=(await api(`/api/weeks/${state.weekStart}/assignments`)).assignments;state.timeOff=(await api(`/api/weeks/${state.weekStart}/time-off`)).timeOff;state.dayExceptions=(await api(`/api/weeks/${state.weekStart}/day-exceptions`)).employeeIds;state.sharePath=(await api(`/api/weeks/${state.weekStart}/share-link`)).path;renderShareLink();loadScheduleViews().catch(showError);resetForm();resetEmployeeForm();render();$("#saveStatus").textContent="Tout est enregistré";undoControl.refresh();document.querySelectorAll("#planoBtn,#presenceBtn").forEach(b=>b.disabled=false);}
async function loadScheduleViews(){const week=state.weekStart;$("#scheduleViews").textContent="Chargement…";const {employees}=await api(`/api/weeks/${week}/schedule-views`);if(week!==state.weekStart)return;const viewed=employees.filter(person=>person.last_viewed_at).length;const formatted=value=>new Intl.DateTimeFormat("fr-CA",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));$("#scheduleViews").innerHTML=`<p><strong>${viewed} sur ${employees.length}</strong> horaires ouverts</p>${employees.length?`<div class="view-list">${employees.map(person=>`<div class="view-row"><span>${escapeHtml(person.name)}</span><span>${person.last_viewed_at?`Ouvert le ${escapeHtml(formatted(person.last_viewed_at))} · ${person.view_count} consultation${person.view_count>1?"s":""}`:"Pas encore ouvert"}</span></div>`).join("")}</div>`:"<p>Aucun employé n’a de quart cette semaine.</p>"}`;}
$("#refreshScheduleViews").onclick=()=>loadScheduleViews().catch(showError);
function renderShareLink(){const active=!!state.sharePath;$("#createShareLink").hidden=active;$("#revokeShareLink").hidden=!active;$("#shareLinkDisplay").textContent=(active?'Semaine publiée : ':'Semaine non publiée : ')+formatWeek(state.weekStart)+' · Portail permanent : '+location.origin+'/horaires-departements';}

function windowText(windows){return (windows||[]).map(([a,b])=>`${String(Math.floor(a/60)).padStart(2,"0")}:${String(a%60).padStart(2,"0")}-${String(Math.floor(b/60)).padStart(2,"0")}:${String(b%60).padStart(2,"0")}`).join(", ");}
function parseWindow(value){if(!value.trim())return [];return value.split(",").map(part=>{const match=part.trim().match(/^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-4]):([0-5]\d)$/);if(!match)throw new Error("Utilise le format 08:00-17:00.");const a=Number(match[1])*60+Number(match[2]),b=Number(match[3])*60+Number(match[4]);if(a>=b||b>1440)throw new Error("Plage de disponibilité invalide.");return [a,b];});}
function renderOtherRoles(selected=[]){$("#employeeOtherRoles").innerHTML=employeeRoles.filter(role=>role!==$("#employeeRole").value).map(role=>`<label><input type="checkbox" value="${role}" ${selected.includes(role)?"checked":""}> ${roleNames[role]}</label>`).join("");}
function resetEmployeeForm(){$("#departEmployee").hidden=true;$("#departureStatus").textContent="";$("#employeeForm").reset();$("#employeeAvailabilityStatus").textContent="";delete $("#employeeForm").dataset.availabilityRevision;$("#employeeId").value="";$("#employeeTarget").value="17";$("#employeeMax").value="40";renderOtherRoles();$("#saveEmployee").textContent="Ajouter l’employé";}
function editEmployee(id){const e=state.employees.find(p=>p.id===id);if(!e||e.departedAt)return;$("#departureStatus").textContent="";$("#departEmployee").hidden=false;$("#employeeId").value=e.id;$("#employeeName").value=e.name;$("#employeeCode").value=e.employeeCode||"";$("#employeeBirthday").value=e.birthday||"";$("#employeeRole").value=e.role;renderOtherRoles(e.roles||[e.role]);$("#employeeSeniority").value=e.seniority==="9999-12-31"?"":e.seniority;$("#employeeTarget").value=(e.profileTargetMinutes??e.targetMinutes)/60;$("#employeeForm").dataset.availabilityRevision=e.availabilityRevision||"";$("#employeeAvailabilityStatus").textContent=(e.availabilityEffectiveDate&&e.availabilityEffectiveDate!=="1900-01-01"?"Grille en vigueur depuis le "+e.availabilityEffectiveDate+". ":"")+(e.nextAvailability?.length?"Changements approuvés à venir : "+e.nextAvailability.map(v=>v.effectiveDate+" ("+v.targetMinutes/60+" h souhaitées)").join(", ")+". La grille ci-dessous est celle en vigueur aujourd’hui.":"La grille ci-dessous est celle en vigueur aujourd’hui.");$("#employeeMax").value=e.maxMinutes/60;$("#employeeMinor").checked=!!e.isMinor;$("#employeeExtraHours").checked=!!e.allowExtraHours;$("#employeeSixOrSevenDays").checked=state.dayExceptions.includes(e.id);$("#employeeNotes").value=e.notes;$("#employeeDisplayRank").value=e.displayRank??"";$("#employeeAssignmentRank").value=e.assignmentRank??"";$("#employeeActive").checked=e.active;for(let d=0;d<7;d++){ $("#availability"+d).value=windowText((e.profileAvailability||e.availability)?.[d]); $("#timeOff"+d).checked=state.timeOff.some(x=>x.employeeId===e.id&&x.dayIndex===d); }$("#saveEmployee").textContent="Enregistrer l’employé";$("#employeeForm").scrollIntoView({behavior:"smooth"});}
function renderEmployees(){
  const groups=[{title:'Gérante',roles:['manager']},{title:'Superviseurs',roles:['supervisor']},...scheduleGroups.slice(1)];
  $("#employeeList").innerHTML=groups.map(group=>`<section class="employee-group"><h3>${group.title}</h3>${state.employees.filter(e=>!e.departedAt&&group.roles.includes(e.role)).sort(compareDisplayOrder).map(e=>`<button type="button" class="employee-row" data-id="${e.id}"><b>${e.displayRank??"—"}. ${escapeHtml(e.name)}</b>${e.role==='manager'?'<span>Gérante</span>':''}<span>Ancienneté : ${seniorityText(e.seniority)}</span><span>Priorité quarts : ${e.assignmentRank??"—"} · ${durationText(e.targetMinutes)} souhaitées${e.isMinor?" · 17 ans ou moins":""}${e.allowExtraHours?" · Heures supplémentaires autorisées":""}${(e.roles||[e.role]).filter(role=>role!==e.role).length?" · Autres postes : "+(e.roles||[]).filter(role=>role!==e.role).map(role=>roleNames[role]).join(", "):""}${state.dayExceptions.includes(e.id)?" · 6 ou 7 jours autorisés cette semaine":""}${e.active?"":" · Inactif — absence temporaire"}</span><span>Modifier la disponibilité permanente →</span></button>`).join("")||"<p>Aucun employé</p>"}</section>`).join("");
  document.querySelectorAll(".employee-row").forEach(b=>b.onclick=()=>editEmployee(Number(b.dataset.id)));
}
async function loadEmployees(){state.employees=(await api("/api/employees"+(state.weekStart?"?weekStart="+state.weekStart:""))).employees;renderEmployees();renderSchedule();}
function approvedForDay(id,day){return state.approvedLeaves.filter(r=>Number(r.employee_id)===id).flatMap(r=>r.periods).filter(p=>p.date===addDays(state.weekStart,day));}
function availableForShift(employee,shift){
  if(approvedForDay(employee.id,shift.dayIndex).some(p=>p.startMinute<shift.endMinute&&p.endMinute>shift.startMinute))return false;
  if(!employee.active||!canWorkRole(employee,shift.role)||state.timeOff.some(x=>x.employeeId===employee.id&&x.dayIndex===shift.dayIndex))return false;
  return (employee.availability?.[shift.dayIndex]||[]).some(([start,end])=>start<=shift.startMinute&&end>=shift.endMinute);
}
function shiftAvailabilityPanel(shift){
  const people=state.employees.filter(e=>canWorkRole(e,shift.role)&&e.active).sort(compareDisplayOrder);
  const rows=people.map(e=>{
    const leave=state.timeOff.some(x=>x.employeeId===e.id&&x.dayIndex===shift.dayIndex);
    const assigned=state.assignments.filter(a=>a.employeeId===e.id).map(a=>state.shifts.find(s=>s.id===a.shiftId)).filter(Boolean);
    const dayJob=assigned.find(s=>s.dayIndex===shift.dayIndex);
    const windows=e.availability?.[shift.dayIndex]||[];
    const constraints=[];
    if(leave)constraints.push("Congé demandé");
    for(const p of approvedForDay(e.id,shift.dayIndex))constraints.push(p.allDay?"Congé approuvé — journée complète":`Congé approuvé ${timeText(p.startMinute)}–${timeText(p.endMinute)}`);
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
  const leaveRows=state.employees.flatMap(e=>Array.from({length:7},(_,day)=>approvedForDay(e.id,day).map(p=>`<li>${escapeHtml(e.name)} · ${fmtDate.format(new Date(p.date+'T12:00:00Z'))} · ${p.allDay?'Journée complète':timeText(p.startMinute)+' à '+timeText(p.endMinute)}</li>`)).flat());
  $("#approvedLeaveSummary").innerHTML=leaveRows.length?'<h3>Congés approuvés cette semaine</h3><ul>'+leaveRows.join('')+'</ul>':'';

  if(!state.week)return;
  const availabilityConflicts=state.assignments.map(a=>({employee:state.employees.find(e=>e.id===a.employeeId),shift:state.shifts.find(s=>s.id===a.shiftId)})).filter(({employee:e,shift:s})=>e?.availabilityHistory?.length&&s&&!(e.availability[s.dayIndex]||[]).some(([a,b])=>a<=s.startMinute&&b>=s.endMinute));
  $("#permanentAvailabilityWarnings").innerHTML=availabilityConflicts.length?"<h3>Disponibilités modifiées — quarts à vérifier</h3><p>Ces affectations sont conservées. Choisissez un autre quart ou un remplaçant.</p><ul>"+availabilityConflicts.map(({employee:e,shift:s})=>`<li>${escapeHtml(e.name)} · ${shortDays[s.dayIndex]} ${timeText(s.startMinute)}–${timeText(s.endMinute)}</li>`).join("")+"</ul>":"";
  const missing=state.shifts.filter(s=>!assignedName(s.id));
  $("#scheduleStatus").textContent=`${state.shifts.length-missing.length} quarts attribués sur ${state.shifts.length}. ${missing.length} à couvrir.`;
  $("#scheduleBoard").innerHTML=scheduleGroups.map(group=>`<section class="schedule-group"><h3>${group.title}</h3><div class="schedule-grid">${dayNames.map((name,day)=>`<div class="schedule-day"><h4>${name}</h4>${state.employees.filter(e=>e.active&&e.birthday&&e.birthday.slice(5)===addDays(state.weekStart,day).slice(5)).map(e=>`<p class="birthday-greeting">Bonne fête ${escapeHtml(e.name)} !</p>`).join('')}${state.shifts.filter(s=>group.roles.includes(s.role)&&s.dayIndex===day).sort((a,b)=>a.startMinute-b.startMinute).map(s=>`<label class="schedule-item${s.role!=="support"&&!state.assignments.some(a=>a.shiftId===s.id)?" schedule-item-unfilled":""}"><span>${timeText(s.startMinute)}–${timeText(s.endMinute)}${s.role==="support"?` · ${roleNames.support}`:""}</span><select data-shift="${s.id}" ${s.role==="support"?"disabled":""}><option value="">${s.role==="support"?"Autre département":"À couvrir"}</option>${state.employees.filter(e=>canWorkRole(e,s.role)&&(availableForShift(e,s)||state.assignments.some(a=>a.shiftId===s.id&&a.employeeId===e.id))).map(e=>`<option value="${e.id}" ${state.assignments.some(a=>a.shiftId===s.id&&a.employeeId===e.id)?"selected":""}>${escapeHtml(e.name)}${availableForShift(e,s)?"":" (déjà attribué, hors disponibilité)"}</option>`).join("")}</select></label>${s.role!=="support"&&!state.assignments.some(a=>a.shiftId===s.id)?shiftAvailabilityPanel(s):""}`).join("")||"<small>Aucun quart</small>"}</div>`).join("")}</div></section>`).join("");
  $("#employeeTotals").innerHTML="<h3>Heures par employé</h3>"+scheduleGroups.map(group=>`<div class="total-group"><strong>${group.title}</strong>${state.employees.filter(e=>group.roles.includes(e.role)&&state.assignments.some(a=>a.employeeId===e.id)).map(e=>{const paid=state.assignments.filter(a=>a.employeeId===e.id).reduce((sum,a)=>sum+(state.shifts.find(s=>s.id===a.shiftId)?.paidMinutes||0),0);return `<span>${escapeHtml(e.name)} : ${durationText(paid)} / ${durationText(e.targetMinutes)} souhaitées</span>`;}).join("")||"<span>Aucun quart attribué</span>"}</div>`).join("");
  document.querySelectorAll(".schedule-item select").forEach(select=>select.onchange=async()=>{
    const message=$("#assignmentMessage");message.hidden=true;message.textContent="";
    const employee=state.employees.find(e=>e.id===Number(select.value));
    const shift=state.shifts.find(s=>s.id===Number(select.dataset.shift));
    try{
      await api(`/api/shifts/${select.dataset.shift}/assignment`,{method:"PUT",body:JSON.stringify({employeeId:select.value?Number(select.value):null})});
      state.assignments=(await api(`/api/weeks/${state.weekStart}/assignments`)).assignments;
      render();toast("Horaire enregistré");
    }catch(error){
      const context=[employee?.name,shift?`${dayNames[shift.dayIndex]} ${timeText(shift.startMinute)}–${timeText(shift.endMinute)}`:null].filter(Boolean).join(" · ");
      message.textContent=`${context?context+" : ":""}${error.message||"Une erreur est survenue."}`;
      message.hidden=false;renderSchedule();message.scrollIntoView({behavior:"smooth",block:"center"});
    }
  });
  document.querySelectorAll(".edit-unfilled-shift").forEach(button=>button.onclick=()=>editShift(Number(button.dataset.id)));
}
async function saveWeek(){clearTimeout(state.saving);state.saving=null;$("#saveStatus").textContent="Enregistrement…";const result=await api(`/api/weeks/${state.weekStart}`,{method:"PUT",body:JSON.stringify({cashierBudgetMinutes:Math.round(Number($("#frontBudget").value||0)*60),packerBudgetMinutes:Math.round(Number($("#packerBudget").value||0)*60),notes:$("#weekNotes").value})});state.week=result.week;renderSummary();renderPrint();$("#saveStatus").textContent="Tout est enregistré";}
function queueSave(){clearTimeout(state.saving);state.saving=setTimeout(()=>saveWeek().catch(showError),600);}
function refreshServiceBreaks(){
  try{
    const timing=serviceShiftTiming(minutes($('#startTime').value),minutes($('#endTime').value));
    $('#breakMinutes').value=String(timing.breakMinutes);
    const rests=timing.paidBreakCount===0?'Aucune pause prévue':timing.paidBreakCount===1?'1 pause de 15 min payée':'2 pauses de 15 min payées';
    $('#serviceBreakSummary').textContent=rests+' · '+durationText(timing.paidMinutes)+' payées';
  }catch{ $('#serviceBreakSummary').textContent='Vérifiez les heures de début et de fin.'; }
}
function resetForm(day=0){$("#shiftForm").reset();$("#shiftId").value="";$("#role").value="cashier";$("#startTime").value="08:00";$("#endTime").value="16:00";refreshServiceBreaks();renderDayChoices([day]);$("#submitShift").textContent="Ajouter le quart";$("#cancelEdit").hidden=true;$("#deleteShift").hidden=true;$("#departmentWrap").hidden=true;}
function editShift(id){const s=state.shifts.find(x=>x.id===id);if(!s)return;$("#shiftId").value=s.id;$("#role").value=s.role;$("#startTime").value=`${String(Math.floor(s.startMinute/60)).padStart(2,"0")}:${String(s.startMinute%60).padStart(2,"0")}`;$("#endTime").value=`${String(Math.floor(s.endMinute/60)).padStart(2,"0")}:${String(s.endMinute%60).padStart(2,"0")}`;refreshServiceBreaks();$("#sourceDepartment").value=s.sourceDepartment;$("#shiftNotes").value=s.notes;renderDayChoices([s.dayIndex]);document.querySelectorAll("#dayChoices input").forEach(input=>input.onchange=()=>{if(input.checked)document.querySelectorAll("#dayChoices input").forEach(other=>{if(other!==input)other.checked=false;});});$("#departmentWrap").hidden=s.role!=="support";$("#submitShift").textContent="Enregistrer le quart";$("#cancelEdit").hidden=false;$("#deleteShift").hidden=false;$("#shiftForm").scrollIntoView({behavior:"smooth",block:"center"});}

$("#loginForm").onsubmit=async event=>{event.preventDefault();try{await api("/api/login",{method:"POST",body:JSON.stringify({code:$("#loginCode").value})});location.reload();}catch(error){$("#loginError").textContent=error.message;}};
$("#logoutBtn").onclick=async()=>{await api("/api/logout",{method:"POST"});location.reload();};
$("#prevWeek").onclick=()=>loadWeek(addDays(state.weekStart,-7)).catch(showError);$("#nextWeek").onclick=()=>loadWeek(addDays(state.weekStart,7)).catch(showError);$("#weekPicker").onchange=e=>loadWeek(e.target.value).catch(showError);
$("#copyPrevious").onclick=async()=>{if(!confirm("Copier tous les quarts et budgets de la semaine précédente?"))return;try{await api(`/api/weeks/${state.weekStart}/copy-previous`,{method:"POST"});await loadWeek(state.weekStart);toast("Semaine précédente copiée");}catch(error){showError(error);}};
async function publishPortalWeek(){state.sharePath=(await api(`/api/weeks/${state.weekStart}/share-link`,{method:"PUT",body:'{}'})).path;renderShareLink();toast("Semaine publiée. Le code personnel et le QR restent les mêmes.");}
$("#createShareLink").onclick=()=>publishPortalWeek().catch(showError);
$("#copyShareLink").onclick=async()=>{try{await navigator.clipboard.writeText(`${location.origin}/horaires-departements`);toast("Lien permanent copié");}catch(error){showError(error);}};
$("#revokeShareLink").onclick=async()=>{if(!confirm("Retirer cette semaine du portail? Les employés ne verront plus ses quarts. Le QR et leurs codes personnels resteront valides."))return;try{await api(`/api/weeks/${state.weekStart}/share-link`,{method:"DELETE"});state.sharePath=null;renderShareLink();toast("Semaine retirée du portail");}catch(error){showError(error);}};
$('#startTime').addEventListener('input',refreshServiceBreaks);
$('#endTime').addEventListener('input',refreshServiceBreaks);
$("#role").onchange=e=>{$("#departmentWrap").hidden=e.target.value!=="support";};
$("#shiftForm").onsubmit=async event=>{event.preventDefault();try{const id=Number($("#shiftId").value)||null;const days=[...document.querySelectorAll("#dayChoices input:checked")].map(x=>Number(x.value));const body={role:$("#role").value,startMinute:minutes($("#startTime").value),endMinute:minutes($("#endTime").value),breakMinutes:Number($("#breakMinutes").value),sourceDepartment:$("#sourceDepartment").value,notes:$("#shiftNotes").value};if(id){body.dayIndex=days[0];const result=await api(`/api/shifts/${id}`,{method:"PUT",body:JSON.stringify(body)});state.shifts=state.shifts.map(s=>s.id===id?result.shift:s);}else{const result=await api(`/api/weeks/${state.weekStart}/shifts`,{method:"POST",body:JSON.stringify({...body,days})});state.shifts.push(...result.shifts);}resetForm(days[0]||0);render();toast(id?"Quart modifié":"Quart ajouté");}catch(error){showError(error);}};
$("#cancelEdit").onclick=()=>resetForm();$("#deleteShift").onclick=async()=>{const id=Number($("#shiftId").value);if(!id||!confirm("Supprimer ce quart?"))return;try{await api(`/api/shifts/${id}`,{method:"DELETE"});state.shifts=state.shifts.filter(s=>s.id!==id);resetForm();render();toast("Quart supprimé");}catch(error){showError(error);}};
for(const id of ["frontBudget","packerBudget","weekNotes"])$("#"+id).oninput=queueSave;
let servicePdfUrl=null,servicePdfBusy=false;
function showServicePreview(){
  renderPrint();$('#previewPages').innerHTML=$('#printSheet').innerHTML;$('#servicePdfStatus').textContent='Format légal · 8½ × 14 po · Portrait';$('#servicePdfResult').hidden=true;
  if(!$('#printPreview').open)$('#printPreview').showModal();
}
async function checkedServiceSheets(){
  await document.fonts.ready;const sheets=[...document.querySelectorAll('#previewPages .service-sheet')];
  await Promise.all(sheets.flatMap(sheet=>[...sheet.querySelectorAll('img')]).map(img=>img.decode()));
  const {sheetOverflowMessage}=await import('./department-pdf.js');
  for(const sheet of sheets){const error=sheetOverflowMessage(sheet);if(error)throw Error(error);}
  return sheets;
}
async function printService(){
  document.body.classList.remove('printing-planogram');showServicePreview();
  try{await checkedServiceSheets();$('#printPreview').close();window.print();}catch(error){$('#servicePdfStatus').textContent=error.message;}
}
$('#printBtn').onclick=printService;
$('#previewBtn').onclick=showServicePreview;
$('#previewClose').onclick=()=>$('#printPreview').close();
$('#previewPrint').onclick=printService;
$('#printPreview').addEventListener('cancel',event=>{if(servicePdfBusy)event.preventDefault();});
$('#previewPdf').onclick=async()=>{
  if(servicePdfBusy)return;
  const weekStart=state.weekStart,buttons=[$('#previewPdf'),$('#previewPrint'),$('#previewClose')];servicePdfBusy=true;buttons.forEach(button=>button.disabled=true);$('#servicePdfResult').hidden=true;$('#servicePdfStatus').textContent='Préparation du PDF…';
  try{
    const sheets=await checkedServiceSheets(),{schedulePagesPDF}=await import('./department-pdf.js');
    const blob=await schedulePagesPDF(sheets,{previewSelector:'#previewPages .service-sheet'});
    if(servicePdfUrl)URL.revokeObjectURL(servicePdfUrl);servicePdfUrl=URL.createObjectURL(blob);
    $('#servicePdfDownload').href=servicePdfUrl;$('#servicePdfDownload').download='Horaire-Service-'+weekStart+'.pdf';$('#servicePdfOpen').href=servicePdfUrl;
    $('#servicePdfResult').hidden=false;$('#servicePdfStatus').textContent='PDF prêt : '+sheets.length+' feuilles légales, sans adresse Web ni date d’impression.';
  }catch(error){$('#servicePdfStatus').textContent='Le PDF n’a pas été créé. '+error.message;}finally{servicePdfBusy=false;buttons.forEach(button=>button.disabled=false);}
};
const presenceButton=document.createElement('button');presenceButton.id='presenceBtn';presenceButton.className='secondary';presenceButton.textContent='Présences gérants et assistants';$('#planoBtn').after(presenceButton);
const {installDailyPrinting}=await import('./daily-printing.js');installDailyPrinting({state,api});

renderDayChoices();
renderOtherRoles();
$("#employeeRole").onchange=()=>{const selected=[...document.querySelectorAll("#employeeOtherRoles input:checked")].map(input=>input.value);renderOtherRoles(selected);};
$("#availabilityFields").innerHTML=shortDays.map((name,d)=>`<label>${name}<input id="availability${d}" placeholder="08:00-17:00"></label>`).join("");
$("#timeOffFields").innerHTML=shortDays.map((name,d)=>`<label><input id="timeOff${d}" type="checkbox"> ${name}</label>`).join("");
$("#employeeForm").onsubmit=async event=>{event.preventDefault();const undoGroup=crypto.randomUUID();try{const id=$("#employeeId").value;const availability={};for(let d=0;d<7;d++)availability[d]=parseWindow($("#availability"+d).value);const body={availabilityRevision:$("#employeeForm").dataset.availabilityRevision,name:$("#employeeName").value,employeeCode:$("#employeeCode").value,birthday:$("#employeeBirthday").value,role:$("#employeeRole").value,roles:[$("#employeeRole").value,...[...document.querySelectorAll("#employeeOtherRoles input:checked")].map(input=>input.value)],seniority:$("#employeeSeniority").value,displayRank:$("#employeeDisplayRank").value||null,assignmentRank:$("#employeeAssignmentRank").value||null,targetMinutes:Math.round(Number($("#employeeTarget").value)*60),maxMinutes:Math.round(Number($("#employeeMax").value)*60),isMinor:$("#employeeMinor").checked,allowExtraHours:$("#employeeExtraHours").checked,availability,notes:$("#employeeNotes").value,active:$("#employeeActive").checked};const saved=await api(id?`/api/employees/${id}`:"/api/employees",{undoGroup,method:id?"PUT":"POST",body:JSON.stringify(body)});const employeeId=saved.employee.id;await api(`/api/weeks/${state.weekStart}/employees/${employeeId}/day-exception`,{undoGroup,method:"PUT",body:JSON.stringify({allowed:$("#employeeSixOrSevenDays").checked})});state.dayExceptions=(await api(`/api/weeks/${state.weekStart}/day-exceptions`)).employeeIds;const days=Array.from({length:7},(_,d)=>d).filter(d=>$("#timeOff"+d).checked);await api(`/api/weeks/${state.weekStart}/employees/${employeeId}/time-off`,{undoGroup,method:"PUT",body:JSON.stringify({days})});state.timeOff=(await api(`/api/weeks/${state.weekStart}/time-off`)).timeOff;state.assignments=(await api(`/api/weeks/${state.weekStart}/assignments`)).assignments;resetEmployeeForm();await loadEmployees();render();toast("Employé et congés enregistrés");}catch(error){showError(error);}};
$("#clearEmployee").onclick=resetEmployeeForm;
$("#departEmployee").onclick=async()=>{
  const employee=state.employees.find(e=>e.id===Number($("#employeeId").value));
  if(!employee||!confirm(`Retirer ${employee.name} de la liste pour un départ définitif? Cette personne ne sera plus proposée pour de nouvelles affectations. Les horaires et quarts déjà attribués seront conservés. La touche Annuler permettra de revenir sur ce retrait.`))return;
  const button=$("#departEmployee");button.disabled=true;
  try{
    await api(`/api/employees/${employee.id}/departure`,{method:'POST'});
    resetEmployeeForm();await loadEmployees();render();
    $("#departureStatus").textContent=employee.name+' a été retiré de la liste. Ses quarts déjà attribués sont conservés; vérifiez ceux à venir.';
    toast('Employé retiré de la liste');
  }catch(error){$("#departureStatus").textContent=error.message;}
  finally{button.disabled=false;}
};
$("#employeeImport").onchange=async event=>{try{const file=event.target.files[0];if(!file)return;const data=JSON.parse(await file.text());const result=await api("/api/employees/import",{method:"POST",body:JSON.stringify(data)});await loadEmployees();toast(`${result.count} employés importés`);}catch(error){showError(error);}finally{event.target.value="";}};
$("#generateSchedule").onclick=async()=>{try{const result=await api(`/api/weeks/${state.weekStart}/generate`,{method:"POST"});state.assignments=(await api(`/api/weeks/${state.weekStart}/assignments`)).assignments;render();toast(`${result.assignments.length} quarts attribués; ${result.unfilled.length} à couvrir`);}catch(error){showError(error);}};
$("#applyApprovedLeaves").onclick=async()=>{
  const button=$("#applyApprovedLeaves"),week=state.weekStart;
  button.disabled=true;$("#leaveApplyStatus").textContent="Application des congés…";
  try{
    const result=await api(`/api/leave/week/${week}/apply`,{method:"POST"});
    if(state.weekStart===week){
      const leaves=(await api(`/api/leave/week/${week}`)).leaves;
      const assignments=await api(`/api/weeks/${week}/assignments`);
      if(state.weekStart===week){state.approvedLeaves=leaves;state.assignments=assignments.assignments;render();
        $("#leaveApplyStatus").textContent=result.releasedShifts?`${result.releasedShifts} quart(s) remis à couvrir. Choisissez leur remplaçant dans la grille. Toutes les autres affectations sont conservées.`:"Les congés approuvés sont appliqués. Aucune affectation à retirer.";
      }
    }
  }catch(error){$("#leaveApplyStatus").textContent=error.message;showError(error);}
  finally{button.disabled=false;}
};
$("#regenerateSchedule").onclick=async()=>{
  if(!confirm("Recréer toutes les affectations de cette semaine selon les priorités actuelles? Les choix faits à la main seront remplacés. La touche Annuler permettra de revenir en arrière."))return;
  const button=$("#regenerateSchedule"),week=state.weekStart;button.disabled=true;
  try{
    const result=await api(`/api/weeks/${week}/generate`,{method:"POST",body:JSON.stringify({replaceAll:true})});
    if(state.weekStart===week){await loadWeek(week);}
    toast(`${result.assignments.length} quarts attribués; ${result.unfilled.length} à couvrir`);
  }catch(error){showError(error);}finally{button.disabled=false;}
};
const undoControl=window.createUndoControl({
  beforeUndo:async()=>{if(!state.saving)return false;await saveWeek();return true;},
  onUndo:async action=>{clearTimeout(state.saving);state.saving=null;await loadEmployees();await loadWeek(action.week_start?String(action.week_start).slice(0,10):state.weekStart);toast('Dernière action annulée');}
});
api("/api/session").then(async session=>{if(session.role==="manager"){if(session.user?.kind==="account"&&!session.user.serviceAccess){location.replace("/departements");return;}$("#loginView").hidden=true;$("#appView").hidden=false;await loadEmployees();await loadWeek(upcomingWeekStart());}}).catch(()=>{});


$("#employeeMinor").onchange=event=>{if(event.target.checked&&Number($("#employeeTarget").value)>17)$("#employeeTarget").value="17";};

const names=["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const groups=[{title:"Superviseurs",role:"supervisor"},{title:"Commandes téléphoniques",role:"orders"},{title:"Caissières",role:"cashier"},{title:"Emballeurs",role:"packer"}];
const roleNames={supervisor:"Supervision",orders:"Commandes téléphoniques",cashier:"Caisse",packer:"Emballage"};
const escapeHtml=value=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const hour=minutes=>`${String(Math.floor(minutes/60)).padStart(2,"0")}:${String(minutes%60).padStart(2,"0")}`;
const searchText=value=>String(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr-CA");
const token=location.pathname.split("/").pop();
let schedule=null;
function dateFor(week,day){const date=new Date(`${week}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+day);return new Intl.DateTimeFormat("fr-CA",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(date);}
function render(){
  if(!schedule)return;
  const query=searchText(document.querySelector("#employeeSearch").value.trim());
  const sections=groups.map(group=>{
    const people=schedule.employees.filter(person=>person.role===group.role&&searchText(person.name).includes(query)).sort((a,b)=>(a.rank??9999)-(b.rank??9999)||a.name.localeCompare(b.name,"fr-CA"));
    if(!people.length)return "";
    return `<section class="group"><h2>${group.title}</h2><div class="employees">${people.map(person=>`<article class="employee"><h3>${escapeHtml(person.name)}</h3>${person.shifts.sort((a,b)=>a.dayIndex-b.dayIndex||a.startMinute-b.startMinute).map(shift=>`<div class="shift"><span>${names[shift.dayIndex]}<small>${dateFor(schedule.weekStart,shift.dayIndex)}</small>${shift.role!==person.role?`<small class="alternate">${roleNames[shift.role]||escapeHtml(shift.role)}</small>`:""}</span><strong>${hour(shift.startMinute)} – ${hour(shift.endMinute)}</strong></div>`).join("")}</article>`).join("")}</div></section>`;
  }).join("");
  document.querySelector("#schedule").innerHTML=sections||'<p class="empty">Aucun quart trouvé pour ce nom.</p>';
}
async function load(){
  document.querySelector("#status").textContent="Chargement de l’horaire…";
  try{
    const response=await fetch(`/api/public-schedules/${encodeURIComponent(token)}`,{cache:"no-store"});
    if(response.status===401){schedule=null;document.querySelector("#schedule").innerHTML="";document.querySelector("#accessForm").hidden=false;document.querySelector(".toolbar").hidden=true;document.querySelector("#status").textContent="Entre le code commun transmis par le magasin.";return;}
    if(!response.ok)throw new Error(response.status===404?"Ce lien est invalide ou a été désactivé.":"L’horaire est temporairement inaccessible.");
    schedule=await response.json();
    document.querySelector("#accessForm").hidden=true;
    document.querySelector(".toolbar").hidden=false;
    document.querySelector("#period").textContent=`Semaine du ${dateFor(schedule.weekStart,0)} au ${dateFor(schedule.weekStart,6)}`;
    document.querySelector("#status").textContent="Horaire à jour lors de la dernière actualisation de cette page.";
    render();
  }catch(error){document.querySelector("#status").textContent=error.message;document.querySelector("#schedule").innerHTML="";}
}
document.querySelector("#employeeSearch").addEventListener("input",render);
document.querySelector("#refresh").addEventListener("click",load);
document.querySelector("#accessForm").addEventListener("submit",async event=>{event.preventDefault();try{const response=await fetch(`/api/public-schedules/${encodeURIComponent(token)}/access`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:document.querySelector("#staffCode").value})});const body=await response.json();if(!response.ok)throw new Error(body.error||"Code refusé.");document.querySelector("#staffCode").value="";await load();}catch(error){document.querySelector("#status").textContent=error.message;}});
load();

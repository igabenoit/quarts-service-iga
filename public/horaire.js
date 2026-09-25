const dayNames=["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const roleNames={supervisor:"Supervision",orders:"Commandes téléphoniques",cashier:"Caisse",packer:"Emballage"};
const escapeHtml=value=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const searchText=value=>String(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr-CA");
const hour=minutes=>`${String(Math.floor(minutes/60)).padStart(2,"0")}:${String(minutes%60).padStart(2,"0")}`;
const token=location.pathname.split("/").pop();
const search=document.querySelector("#employeeSearch");
const suggestions=document.querySelector("#suggestions");
const card=document.querySelector("#schedule");
let schedule=null;
let selectedId=null;

function dateFor(week,day){
  const date=new Date(`${week}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate()+day);
  return new Intl.DateTimeFormat("fr-CA",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(date);
}
function hideSuggestions(){
  suggestions.hidden=true;
  suggestions.replaceChildren();
  search.setAttribute("aria-expanded","false");
}
function showSuggestions(){
  hideSuggestions();
  if(!schedule||selectedId!==null)return;
  const query=searchText(search.value.trim());
  if(!query)return;
  const matches=schedule.employees.filter(person=>searchText(person.name).includes(query))
    .sort((a,b)=>searchText(a.name).localeCompare(searchText(b.name),"fr-CA")).slice(0,8);
  if(!matches.length){
    const message=document.createElement("p");
    message.textContent="Aucun nom trouvé.";
    suggestions.append(message);
  }else{
    for(const person of matches){
      const option=document.createElement("button");
      option.type="button";
      option.setAttribute("role","option");
      option.textContent=person.name;
      option.addEventListener("click",()=>selectPerson(person.id));
      suggestions.append(option);
    }
  }
  suggestions.hidden=false;
  search.setAttribute("aria-expanded","true");
}
function renderSelected(){
  card.replaceChildren();
  if(selectedId===null)return;
  const person=schedule?.employees.find(item=>item.id===selectedId);
  if(!person){selectedId=null;return;}
  const shifts=[...person.shifts].sort((a,b)=>a.dayIndex-b.dayIndex||a.startMinute-b.startMinute);
  const rows=shifts.map(shift=>`<div class="day-row"><div class="day-date"><strong>${dayNames[shift.dayIndex]}</strong><span>${dateFor(schedule.weekStart,shift.dayIndex)}</span></div><div class="day-hours">${hour(shift.startMinute)} – ${hour(shift.endMinute)}</div>${shift.role!==person.role?`<div class="day-role">${escapeHtml(roleNames[shift.role]||shift.role)}</div>`:""}</div>`).join("");
  card.innerHTML=`<article class="personal-card"><p class="eyebrow">MON HORAIRE</p><h2>${escapeHtml(person.name)}</h2>${rows||'<p class="empty">Aucun quart prévu cette semaine.</p>'}</article>`;
}
function selectPerson(id){
  const person=schedule?.employees.find(item=>item.id===id);
  if(!person)return;
  selectedId=id;
  search.value=person.name;
  hideSuggestions();
  renderSelected();
  document.querySelector("#status").textContent="Actualise la page pour voir les dernières modifications.";
  fetch(`/api/public-schedules/${encodeURIComponent(token)}/views`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({employeeId:id})}).catch(()=>{});
}
async function load(){
  document.querySelector("#status").textContent="Chargement de l’horaire…";
  try{
    const response=await fetch(`/api/public-schedules/${encodeURIComponent(token)}`,{cache:"no-store"});
    if(response.status===401){
      schedule=null;selectedId=null;card.replaceChildren();hideSuggestions();
      document.querySelector("#accessForm").hidden=false;
      document.querySelector(".toolbar").hidden=true;
      document.querySelector("#status").textContent="Entre le code commun transmis par le magasin.";
      return;
    }
    if(!response.ok)throw new Error(response.status===404?"Ce lien est invalide ou a été désactivé.":"L’horaire est temporairement inaccessible.");
    schedule=await response.json();
    document.querySelector("#accessForm").hidden=true;
    document.querySelector(".toolbar").hidden=false;
    document.querySelector("#period").textContent=`Semaine du ${dateFor(schedule.weekStart,0)} au ${dateFor(schedule.weekStart,6)}`;
    if(selectedId!==null&&!schedule.employees.some(person=>person.id===selectedId)){
      selectedId=null;search.value="";
    }
    renderSelected();
    document.querySelector("#status").textContent=selectedId===null?"Commence à écrire ton nom, puis sélectionne-le dans la liste.":"Horaire actualisé.";
  }catch(error){
    schedule=null;selectedId=null;card.replaceChildren();hideSuggestions();
    document.querySelector("#status").textContent=error.message;
  }
}
search.addEventListener("input",()=>{
  selectedId=null;
  card.replaceChildren();
  document.querySelector("#status").textContent="Sélectionne ton nom dans la liste.";
  showSuggestions();
});
search.addEventListener("focus",showSuggestions);
search.addEventListener("keydown",event=>{
  if(event.key==="Escape")hideSuggestions();
  if(event.key==="Enter"&&!suggestions.hidden){
    const first=suggestions.querySelector("button");
    if(first){event.preventDefault();first.click();}
  }
});
document.querySelector("#refresh").addEventListener("click",load);
document.querySelector("#accessForm").addEventListener("submit",async event=>{
  event.preventDefault();
  try{
    const response=await fetch(`/api/public-schedules/${encodeURIComponent(token)}/access`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:document.querySelector("#staffCode").value})});
    const body=await response.json();
    if(!response.ok)throw new Error(body.error||"Code refusé.");
    document.querySelector("#staffCode").value="";
    await load();
  }catch(error){document.querySelector("#status").textContent=error.message;}
});
load();

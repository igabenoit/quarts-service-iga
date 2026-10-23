import {normalizeDepartmentBudget,departmentBudgetHTML} from './department-budget.js';
const money=new Intl.NumberFormat('fr-CA',{style:'currency',currency:'CAD'});
const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function forecastWeekDates(weekStart){
  if(typeof weekStart!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(weekStart))return null;
  const start=new Date(`${weekStart}T12:00:00Z`);
  if(!Number.isFinite(start.getTime())||start.toISOString().slice(0,10)!==weekStart||start.getUTCDay()!==1)return null;
  return Array.from({length:7},(_,day)=>new Date(start.getTime()+day*86400000).toISOString().slice(0,10));
}

export function normalizeInitialForecasts(data,weekStart){
  const dates=forecastWeekDates(weekStart);
  if(!dates||data?.schemaVersion!==1||data.weekStart!==weekStart||data.basis!=='initial'||data.scope!=='store'||data.currency!=='CAD'||!Array.isArray(data.days)||data.days.length!==7)throw Error('Prévisions invalides.');
  const byDate=new Map();
  for(const day of data.days){
    if(!day||!dates.includes(day.date)||byDate.has(day.date)||!(day.initialSales===null||typeof day.initialSales==='number'&&Number.isFinite(day.initialSales)&&day.initialSales>=0&&day.initialSales<1e12))throw Error('Prévisions invalides.');
    byDate.set(day.date,day.initialSales);
  }
  return {schemaVersion:1,weekStart,currency:'CAD',basis:'initial',scope:'store',days:dates.map(date=>({date,initialSales:byDate.get(date)}))};
}

export function forecastDayHTML(date,{status='loading',data=null}={}){
  const day=data?.days.find(day=>day.date===date);
  const label=status==='ready'&&day?(day.initialSales===null?'Non renseignée':money.format(day.initialSales)):status==='unavailable'?'Indisponible':'Chargement…';
  return `<span class="sales-forecast${status==='ready'&&day&&day.initialSales!==null?'':' is-pending'}" data-forecast-date="${escapeHTML(date)}"><small>Prévision initiale · magasin</small><strong>${escapeHTML(label)}</strong></span>`;
}

export function createSalesForecastDisplay({root=document,fetchImpl=fetch}={}){
  let department=null,weekStart=null,snapshot={status:'loading',data:null},sequence=0,controller;
  function update(){
    const budget=root.querySelector('[data-department-budget]');
    if(department&&budget)budget.innerHTML=departmentBudgetHTML(department.key,snapshot);
    root.querySelectorAll('[data-forecast-date]').forEach(node=>{node.outerHTML=forecastDayHTML(node.dataset.forecastDate,snapshot);});
    const status=root.querySelector('[data-sales-forecast-status]');
    if(status)status.textContent=snapshot.status==='ready'?'Prévisions initiales du magasin':snapshot.status==='loading'?'Chargement des prévisions…':'Prévisions indisponibles. Actualisez pour réessayer.';
  }
  async function load(start,selectedDepartment=null){
    department=selectedDepartment;
    const request=++sequence;weekStart=start;controller?.abort();controller=new AbortController();
    const activeController=controller,activeDepartment=department;
    snapshot={status:'loading',data:null};update();
    const timer=setTimeout(()=>activeController.abort(),20000);
    try{
      const response=await fetchImpl(`/api/sales-forecasts/${encodeURIComponent(start)}${activeDepartment?`?department=${encodeURIComponent(activeDepartment.id)}`:''}`,{cache:'no-store',signal:activeController.signal});
      if(!response.ok)throw Error('Prévisions indisponibles.');
      const source=await response.json(),data=normalizeInitialForecasts(source,start);
      if(activeDepartment)data.departmentBudget=normalizeDepartmentBudget(source.departmentBudget,activeDepartment.key);
      if(request===sequence){snapshot={status:'ready',data};update();}
    }catch{
      if(request===sequence){snapshot={status:'unavailable',data:null};update();}
    }finally{clearTimeout(timer);}
  }
  root.querySelectorAll('[data-refresh-sales]').forEach(button=>{button.onclick=()=>{if(weekStart)void load(weekStart,department);};});
  return {load,dayHTML:date=>forecastDayHTML(date,snapshot)};
}

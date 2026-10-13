export const DAY_NAMES=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
export const DEPARTMENT_STYLES=[
  {key:'fruits',name:'Fruits & Légumes',color:'#34824d',pale:'#e9f4e7'},
  {key:'boulangerie',name:'Boulangerie',color:'#b88a00',pale:'#fff4c6'},
  {key:'viande',name:'Viande',color:'#b62b32',pale:'#fae8e7'},
  {key:'charcuterie',name:'Charcuterie',color:'#b65380',pale:'#fbe9f1'},
  {key:'pam',name:'Prêt-à-manger',color:'#c46620',pale:'#fff0df'},
  {key:'poissonnerie',name:'Poissonnerie',color:'#287c9c',pale:'#e4f4fc'},
  {key:'epicerie',name:'Épicerie',color:'#344351',pale:'#e9edf1'}
];
export const escapeHTML=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export const nameKey=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export const isDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
export const addDays=(v,n)=>{const d=new Date(v+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
export const monday=v=>{const d=new Date(v+'T12:00:00Z');return addDays(v,-((d.getUTCDay()+6)%7));};
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const dateLabel=v=>isDate(v)?new Intl.DateTimeFormat('fr-CA',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(v+'T12:00:00Z')):'À compléter';
export const timeLabel=v=>`${String(Math.floor(v/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}`;
export const availabilityCode=v=>{const raw=String(v??'').trim().toUpperCase();return ['J','LIBRE','00:00-24:00'].includes(raw)?'J':['0','NON'].includes(raw)?'0':raw;};
export const availabilityLabel=v=>availabilityCode(v).replace(/\b(\d{2}):(\d{2})/g,(_m,h,m)=>Number(h)+(m==='00'?'':'h'+m)).replaceAll('-','–');
export const hoursLabel=v=>new Intl.NumberFormat('fr-CA',{maximumFractionDigits:2}).format(v/60);
export function tenure(date,asOf=today()){
  if(!isDate(date)||!isDate(asOf)||date>asOf)return 'À compléter';
  const [y,m,d]=date.split('-').map(Number),[ay,am,ad]=asOf.split('-').map(Number);
  const months=(ay-y)*12+am-m-(ad<d?1:0),years=Math.floor(months/12),rest=months%12;
  return [years?`${years} an${years>1?'s':''}`:'',rest?`${rest} mois`:''].filter(Boolean).join(' ')||'Moins d’un mois';
}
export function parseTime(value,{end=false}={}){
  const m=/^(\d{1,2})[:h](\d{2})$/.exec(String(value||'').trim());
  if(!m)return null;const n=Number(m[1])*60+Number(m[2]);
  return Number(m[2])<60&&n>=0&&n<=(end?1440:1439)?n:null;
}
export function normalizeAvailability(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Disponibilités invalides.');
  const out={};
  for(let d=0;d<7;d++){
    const raw=availabilityCode(value[d]);
    if(!raw){out[d]='';continue;}
    if(['J','0'].includes(raw)){out[d]=raw;continue;}
    const parts=raw.split(',').map(v=>v.trim().split('-'));
    if(parts.length>2||parts.some(p=>p.length!==2||parseTime(p[0])===null||parseTime(p[1],{end:true})===null||parseTime(p[0])>=parseTime(p[1],{end:true})))throw Error(`${DAY_NAMES[d]} : utiliser J, 0 ou une plage comme 08:00-17:00.`);
    out[d]=parts.map(p=>timeLabel(parseTime(p[0]))+'-'+timeLabel(parseTime(p[1],{end:true}))).join(', ');
  }
  return out;
}
export const blankCell=()=>({kind:'blank',start:null,end:null,breakMinutes:0,note:''});
export function normalizeCell(value){
  const c=value||{},kind=String(c.kind||'blank');
  if(!['blank','shift','off','vacation','note','review'].includes(kind))throw Error('Type de case invalide.');
  const note=String(c.note||'').trim();if(note.length>100)throw Error('Le texte d’une case est limité à 100 caractères.');
  if(kind==='shift'){
    if(!Number.isInteger(c.start)||!Number.isInteger(c.end)||c.start<0||c.end>1440||c.end<=c.start||!Number.isInteger(c.breakMinutes??0)||(c.breakMinutes??0)<0||(c.breakMinutes??0)>=c.end-c.start)throw Error('Vérifiez le début, la fin et la pause du quart.');
    return {kind,start:c.start,end:c.end,breakMinutes:c.breakMinutes??0,note};
  }
  if(['note','review'].includes(kind)&&!note)throw Error('Ajoutez le texte de la case.');
  return {kind,start:null,end:null,breakMinutes:0,note};
}
export function normalizeDraft(value,people){
  if(!value||!Array.isArray(value.rows)||value.rows.length>32)throw Error('Une feuille légale peut contenir au maximum 32 employés.');
  const ids=new Set();const rows=value.rows.map(row=>{
    const person=people.find(p=>p.id===Number(row.personId));if(!person)throw Error('Un employé de la feuille est introuvable dans ce département.');
    if(ids.has(person.id))throw Error('Un employé apparaît deux fois dans la feuille.');ids.add(person.id);
    if(!Array.isArray(row.cells)||row.cells.length!==7)throw Error('Chaque employé doit avoir sept journées.');
    return {personId:person.id,cells:row.cells.map(normalizeCell)};
  });
  const notes=String(value.notes||'').trim(),manager=String(value.manager||'').trim();
  if(notes.length>400||manager.length>100)throw Error('Note ou nom du responsable trop long.');
  return {rows,notes,manager};
}
export const totalMinutes=row=>row.cells.reduce((n,c)=>n+(c.kind==='shift'?c.end-c.start-c.breakMinutes:0),0);
export function draftWarnings(draft,people){
  const warnings=[];
  for(const row of draft.rows){const p=people.find(p=>p.id===row.personId);if(!p){warnings.push('Un employé a été retiré du département : retirez sa ligne du brouillon.');continue;}for(let d=0;d<7;d++){
    const c=row.cells[d];if(c.kind==='review')warnings.push(`${p.name}, ${DAY_NAMES[d]} : lecture à corriger.`);
    if(c.kind!=='shift')continue;
    if(!p.active)warnings.push(`${p.name} : fiche inactive.`);
    const a=availabilityCode(p.availability?.[d]);if(!a)warnings.push(`${p.name}, ${DAY_NAMES[d]} : disponibilité non renseignée.`);
    else if(a==='0'||a!=='J'&&!a.split(',').some(range=>{const [s,e]=range.trim().split('-');return c.start>=parseTime(s)&&c.end<=parseTime(e,{end:true});}))warnings.push(`${p.name}, ${DAY_NAMES[d]} : quart en dehors de la disponibilité.`);
  }}return warnings;
}
export function publicSnapshot(draft,people){
  return {rows:draft.rows.map(row=>({personId:row.personId,name:people.find(p=>p.id===row.personId).name,jobTitle:people.find(p=>p.id===row.personId).jobTitle||'',group:people.find(p=>p.id===row.personId).group,cells:row.cells.map(c=>({kind:c.kind,start:c.start,end:c.end,breakMinutes:c.breakMinutes,note:c.note}))})),notes:draft.notes};
}
export function sheetHTML({department,weekStart,people,draft,blank=false}){
  const e=escapeHTML,style=DEPARTMENT_STYLES.find(d=>d.key===department.key)||DEPARTMENT_STYLES[1];
  let rows=blank?people.filter(p=>p.active!==false).map(person=>({person,cells:Array.from({length:7},blankCell)})):draft.rows.map(r=>({...r,person:people.find(p=>p.id===r.personId)})).filter(r=>r.person);
  if(!rows.length)rows=Array.from({length:14},(_,i)=>({person:{name:'',seniorityDate:'',group:i<7?'regular':'part_time',availability:{}},cells:Array.from({length:7},blankCell)}));
  const groups=[['regular','Réguliers'],['part_time','Temps partiel']];let sum=0;
  const table=groups.map(([key,label])=>{const selected=rows.filter(r=>r.person.group===key);if(!selected.length)return '';const subtotal=selected.reduce((n,r)=>n+totalMinutes(r),0);sum+=subtotal;
    return `<tbody><tr class="sheet-group"><th colspan="10">${label}</th></tr>${selected.map(r=>`<tr class="sheet-person"><th class="sheet-name">${e(r.person.name)}${r.person.jobTitle?`<small class="sheet-job-title">${e(r.person.jobTitle)}</small>`:''}</th><td class="sheet-seniority">${r.person.name?e(r.person.seniorityDate?dateLabel(r.person.seniorityDate):'À compléter'):''}</td>${r.cells.map((c,d)=>`<td class="sheet-day"><div class="sheet-work">${blank?'':c.kind==='shift'?`<b>${timeLabel(c.start)}</b><b>${timeLabel(c.end)}</b>${c.breakMinutes?`<small>Pause ${c.breakMinutes} min</small>`:''}${c.note?`<small>${e(c.note)}</small>`:''}`:c.kind==='off'?'CH':c.kind==='vacation'?'Vacances':e(c.note)}</div><div class="sheet-day-detail"><span class="sheet-daily-hours">${blank||c.kind!=='shift'?'':hoursLabel(c.end-c.start-c.breakMinutes)}</span><span class="sheet-availability">${e(availabilityLabel(r.person.availability?.[d]))}</span></div></td>`).join('')}<td class="sheet-total">${blank||!r.person.name?'':hoursLabel(totalMinutes(r))}</td></tr>`).join('')}<tr class="sheet-subtotal"><td colspan="9">Sous-total ${label.toLowerCase()}</td><td>${blank?'':hoursLabel(subtotal)}</td></tr></tbody>`;
  }).join('');
  return `<article class="department-sheet theme-${e(style.key)} density-${rows.length>24?'small':rows.length>18?'medium':'large'}"><header class="sheet-header"><img src="/logo-famille-benoit.svg" alt="IGA extra Famille Benoit"><div><h1>${e(department.name)}</h1><p>HORAIRE HEBDOMADAIRE</p><strong>Du ${dateLabel(weekStart)} au ${dateLabel(addDays(weekStart,6))}</strong></div></header><table class="sheet-table"><colgroup><col class="col-name"><col class="col-seniority">${'<col class="col-day">'.repeat(7)}<col class="col-total"></colgroup><thead><tr><th>Employé</th><th>Ancienneté</th>${DAY_NAMES.map((d,i)=>`<th>${d.slice(0,3)}.<br><small>${addDays(weekStart,i).slice(8)}</small></th>`).join('')}<th>Total<br><small>heures</small></th></tr></thead>${table}</table><div class="sheet-bottom"><span>Petites cases : heures à gauche · disponibilité à droite (J : journée · 0 : indisponible) · CH : congé</span><strong>TOTAL : ${blank?'________':hoursLabel(sum)} h</strong></div><div class="sheet-notes"><strong>Notes / précisions</strong><p>${blank?'':e(draft.notes)}</p></div></article>`;
}

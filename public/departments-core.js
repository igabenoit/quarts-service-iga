export const PRINT_ROW_CAPACITY=14;
export const DAY_NAMES=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
export const DEPARTMENT_STYLES=[
  {key:'fruits',name:'Fruits & Légumes',color:'#34824d',pale:'#e9f4e7'},
  {key:'boulangerie',name:'Boulangerie',color:'#b88a00',pale:'#fff4c6'},
  {key:'viande',name:'Viande',color:'#b62b32',pale:'#fae8e7'},
  {key:'charcuterie',name:'Charcuterie',color:'#b65380',pale:'#fbe9f1'},
  {key:'pam',name:'Prêt-à-manger',color:'#c46620',pale:'#fff0df'},
  {key:'poissonnerie',name:'Poissonnerie',color:'#287c9c',pale:'#e4f4fc'},
  {key:'epicerie',name:'Épicerie',color:'#344351',pale:'#e9edf1'},
  {key:'administration',name:'Administration',color:'#665489',pale:'#eee9f6'}
];
export const escapeHTML=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export const nameKey=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export const isDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
export const addDays=(v,n)=>{const d=new Date(v+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
export const monday=v=>{const d=new Date(v+'T12:00:00Z');return addDays(v,-((d.getUTCDay()+6)%7));};
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const dateLabel=v=>isDate(v)?new Intl.DateTimeFormat('fr-CA',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(v+'T12:00:00Z')):'À compléter';
export const timeLabel=v=>v>1440?`${timeLabel(v%1440)} +1`:`${String(Math.floor(v/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}`;
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
export const quickTimeLabel=v=>v>1440||v<6*60?timeLabel(v):`${Math.floor(v/60)}${v%60?'h'+String(v%60).padStart(2,'0'):''}`;
function quickHour(value,{end=false}={}){
  const raw=String(value??'').trim().toLowerCase().replace(/\s+/g,'');
  let match=/^(\d{1,2})(?:h|[:h](\d{2}))?$/.exec(raw);
  if(!match&&/^\d{3,4}$/.test(raw))match=[raw,raw.slice(0,-2),raw.slice(-2)];
  if(!match)return null;
  const hour=Number(match[1]),minute=Number(match[2]||0),minutes=hour*60+minute;
  if(minute>59||minutes>(end?1440:1439))return null;
  return {minutes,afternoon:hour>=1&&hour<=12&&!match[1].startsWith('0')};
}
export function parseShiftTimes(startValue,endValue,{shortShiftsInAfternoon=true,allowOvernight=true,nightShift=false}={}){
  const nextDay=/\s*\+1\s*$/.test(String(endValue));
  const start=quickHour(startValue),end=quickHour(String(endValue??'').replace(/\s*\+1\s*$/,''),{end:true});
  if(!start||!end)throw Error('Indiquez les heures, par exemple 7 et 4, ou 7h30 et 16h30.');
  let begin=start.minutes,finish=end.minutes;
  // On night schedules, handwritten 10/11 mean 22/23; the end stays in the morning.
  if(nightShift&&start.afternoon&&begin>=10*60&&begin<12*60)begin+=12*60;
  // Store convention: abbreviated short shifts starting before 6 are afternoon shifts.
  // Explicit 24-hour input (04:00–08:00) remains available for an early morning shift.
  if(nextDay)finish+=1440;
  else if(!nightShift&&shortShiftsInAfternoon&&start.afternoon&&end.afternoon&&begin<6*60&&finish>begin){begin+=12*60;finish+=12*60;}
  else if(!nightShift&&finish<begin&&end.afternoon&&finish+12*60>begin)finish+=12*60;
  else if(finish<begin&&allowOvernight)finish+=1440;
  if(finish<=begin||finish-begin>1440||!allowOvernight&&finish>1440)throw Error(allowOvernight?'Vérifiez les heures : la durée doit être supérieure à zéro et ne pas dépasser 24 h.':'La disponibilité doit rester dans la même journée. Séparez la nuit sur les deux journées.');
  return {start:begin,end:finish};
}
export function parseAvailability(value){
  const raw=availabilityCode(value).replace(/[–—−]/g,'-');
  if(!raw||['J','0'].includes(raw))return raw;
  const parts=raw.split(',').map(v=>v.trim().split('-'));
  if(parts.length>2||parts.some(p=>p.length!==2))throw Error('Utilisez 7 - 4, J, 0 ou deux plages séparées par une virgule.');
  const ranges=parts.map(([start,end])=>parseShiftTimes(start,end,{shortShiftsInAfternoon:false,allowOvernight:false})).sort((a,b)=>a.start-b.start);
  return ranges.map(r=>timeLabel(r.start)+'-'+timeLabel(r.end)).join(', ');
}
export function normalizeAvailability(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Disponibilités invalides.');
  const out={};
  for(let d=0;d<7;d++){
    try{out[d]=parseAvailability(value[d]);}catch(error){throw Error(`${DAY_NAMES[d]} : ${error.message}`);}
  }
  return out;
}
export const blankCell=()=>({kind:'blank',start:null,end:null,breakMinutes:0,note:''});
export const PAM_POSTS=Object.freeze({sandwiches:'Sandwichs',bbq:'BBQ',rs_ss:'Commandes Sandwich',cooked_meals:'Mets Cuisinés',pizza_sandwiches:'Pizza + Sandwichs'});
export const KITCHEN_POSTS=Object.freeze({kitchen_salads:'Cuisine Salades'});
export const COMMON_POSTS=Object.freeze({night:'Nuit'});
export const assignmentPost=c=>c.post||(c.kind==='kitchen'&&/\bsalades?\b/i.test(c.note||'')?'kitchen_salads':'');
export const isTimedCell=c=>['shift','training','buffet','kitchen'].includes(c?.kind);
export const isNightShift=(start,end,post)=>post==='night'||Number.isFinite(start)&&Number.isFinite(end)&&(end>1440||end<start);
export function automaticBreakMinutes(start,end,post){
  if(!Number.isFinite(start)||!Number.isFinite(end))return 0;
  const duration=(end<start?end+1440:end)-start;
  return isNightShift(start,end,post)?(duration>30?30:0):duration>=8*60?60:0;
}
// Nights saved with the former automatic hour now use the corrected half-hour.
// Explicit overrides are retained, including an intentionally entered 60 minutes.
export const cellBreakMinutes=c=>!c.breakOverride&&c.breakMinutes===60&&isNightShift(c.start,c.end,c.post)?automaticBreakMinutes(c.start,c.end,c.post):c.breakMinutes??0;
export const cellMinutes=c=>isTimedCell(c)?c.paidMinutesOverride??(c.end-c.start-cellBreakMinutes(c)):0;
export const departmentLabel=key=>DEPARTMENT_STYLES.find(d=>d.key===key)?.name||key;
export const isOutgoing=c=>Boolean(c.workDepartment&&!c.sourceDepartment);
export const transferLabel=c=>isOutgoing(c)?'À '+({poissonnerie:'Poisson',pam:'PAM',fruits:'Fruits'}[c.workDepartment]||departmentLabel(c.workDepartment)):'';
export const cellDetail=c=>[c.kind==='training'?'Formation':c.kind==='buffet'?'Buffet':c.kind==='kitchen'&&!KITCHEN_POSTS[assignmentPost(c)]?'Cuisine':'',COMMON_POSTS[assignmentPost(c)]||PAM_POSTS[assignmentPost(c)]||KITCHEN_POSTS[assignmentPost(c)]||'',transferLabel(c)].filter(Boolean).join(' · ');
export const shiftAssignment=(c,key)=>c.buffetAllocation?[c.buffetAllocation.pam&&`PAM${c.buffetAllocation.charcuterie?' '+hoursLabel(c.buffetAllocation.pam)+' h':''}`,c.buffetAllocation.charcuterie&&`Charcuterie${c.buffetAllocation.pam?' '+hoursLabel(c.buffetAllocation.charcuterie)+' h':''}`].filter(Boolean).join(' / ')+' · Buffet':[c.workDepartment==='pam'||!c.workDepartment&&key==='pam'?'PAM':departmentLabel(c.workDepartment||key),c.post==='cut_fruit'?'Fruits coupés':cellDetail({...c,workDepartment:undefined})].filter(Boolean).join(' · ');
export const cellLabel=c=>({off:'CH',vacation:'Vacances',mobile:'Congé mobile',requested:'Congé demandé',sick:'Maladie',training:'Formation',review:'À vérifier'}[c.kind]||c.note||'');
export function cellTone(c){
  if(c.post==='cut_fruit'&&isTimedCell(c))return 'status-cut-fruit';
  const kind=c.kind==='note'?({ch:'off',conge:'off',congehebdomadaire:'off',vacances:'vacation',congemobile:'mobile',congedemande:'requested',maladie:'sick'}[nameKey(c.note)]||'note'):c.kind;
  return ['off','vacation','mobile','requested','sick','training'].includes(kind)?'status-'+kind:'';
}
export function normalizeCell(value){
  const c=value||{},kind=String(c.kind||'blank');
  if(!['blank','shift','training','buffet','kitchen','off','vacation','mobile','requested','sick','note','review'].includes(kind))throw Error('Type de case invalide.');
  const note=String(c.note||'').trim();if(note.length>100)throw Error('Le texte d’une case est limité à 100 caractères.');
  if(isTimedCell({kind})){
    const end=Number.isInteger(c.end)&&c.end>=0&&c.end<c.start?c.end+1440:c.end;
    if(!Number.isInteger(c.start)||!Number.isInteger(end)||c.start<0||c.start>=1440||end<=c.start||end-c.start>1440||!Number.isInteger(c.breakMinutes??0)||(c.breakMinutes??0)<0||(c.breakMinutes??0)>=end-c.start)throw Error('Vérifiez le début, la fin et la pause du quart.');
    if(c.paidMinutesOverride!==undefined&&(!Number.isInteger(c.paidMinutesOverride)||c.paidMinutesOverride<0||c.paidMinutesOverride>1440))throw Error('Les heures payées doivent être comprises entre 0 et 24 h, à la minute près.');
    const post=assignmentPost(c);
    if(post&&post!=='cut_fruit'&&!Object.hasOwn(COMMON_POSTS,post)&&!Object.hasOwn(PAM_POSTS,post)&&!Object.hasOwn(KITCHEN_POSTS,post))throw Error('Poste invalide.');
    if(c.workDepartment&&!DEPARTMENT_STYLES.some(d=>d.key===c.workDepartment))throw Error('Département d’accueil invalide.');
    return {kind,start:c.start,end,...(c.paidMinutesOverride!==undefined?{paidMinutesOverride:c.paidMinutesOverride}:{}),breakMinutes:cellBreakMinutes({...c,end}),...(c.breakOverride===true?{breakOverride:true}:{}),note,...(post?{post}:{}),...(c.workDepartment?{workDepartment:c.workDepartment}:{})};
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
const minutesOfKind=(row,kind)=>[...row.cells,...row.accountingCells||[]].reduce((n,c)=>n+(c.kind===kind?(c.departmentMinutes??(!isOutgoing(c)?cellMinutes(c):0)):0),0);
export const totalMinutes=row=>minutesOfKind(row,'shift');
export const trainingMinutes=row=>minutesOfKind(row,'training');
export const buffetMinutes=row=>minutesOfKind(row,'buffet');
export const kitchenMinutes=row=>minutesOfKind(row,'kitchen');
export const grandMinutes=row=>totalMinutes(row)+trainingMinutes(row)+buffetMinutes(row)+kitchenMinutes(row);
export function validateAssignment(c,departmentKey){
  const target=c.workDepartment||departmentKey;
  if(c.workDepartment===departmentKey)throw Error('Choisissez un autre département pour une affectation interdépartements.');
  if(c.post==='cut_fruit'&&target!=='fruits')throw Error('Le poste Fruits coupés appartient aux Fruits & Légumes.');
  if(c.kind==='buffet'&&!['charcuterie','pam'].includes(target))throw Error('Le poste Buffet appartient à la Charcuterie ou au PAM.');
  if((c.kind==='kitchen'||Object.hasOwn(PAM_POSTS,c.post)||Object.hasOwn(KITCHEN_POSTS,c.post))&&target!=='pam')throw Error('Ce poste appartient au PAM.');
  if(Object.hasOwn(KITCHEN_POSTS,c.post)&&!['kitchen','training'].includes(c.kind))throw Error('Cuisine Salades doit être compté en Cuisine ou en Formation.');
  if(c.post&&(c.kind==='buffet'||c.kind==='kitchen'&&!Object.hasOwn(KITCHEN_POSTS,c.post)))throw Error('Choisissez un seul poste.');
  return c;
}
export function mergeIncoming(draft,incoming=[]){
  const rows=draft.rows.map(r=>({...r,cells:r.cells.map(c=>({...c}))}));
  for(const item of incoming){
    let row=rows.find(r=>r.personId===item.personId);
    if(!row){row={personId:item.personId,...(item.person||{}),cells:Array.from({length:7},blankCell)};rows.push(row);}
    if(row.cells[item.day].kind!=='blank')throw Error('Un quart reçu entre en conflit avec une case de cet horaire.');
    row.cells[item.day]={...item.cell,sourceDepartment:item.sourceDepartment,sourceDepartmentId:item.sourceDepartmentId};
  }
  return {...draft,rows};
}
export function draftWarnings(draft,people){
  const warnings=[];
  for(const row of draft.rows){const p=people.find(p=>p.id===row.personId);if(!p){warnings.push('Un employé a été retiré du département : retirez sa ligne du brouillon.');continue;}for(let d=0;d<7;d++){
    const c=row.cells[d];if(c.kind==='review')warnings.push(`${p.name}, ${DAY_NAMES[d]} : lecture à corriger.`);
    if(!isTimedCell(c))continue;
    if(!p.active)warnings.push(`${p.name} : fiche inactive.`);
    const parts=[{day:d,start:c.start,end:Math.min(c.end,1440)},...(c.end>1440?[{day:(d+1)%7,start:0,end:c.end-1440}]:[])];
    for(const part of parts){
      const a=availabilityCode(p.availability?.[part.day]);if(!a)warnings.push(`${p.name}, ${DAY_NAMES[part.day]} : disponibilité non renseignée.`);
      else if(a==='0'||a!=='J'&&!a.split(',').some(range=>{const [s,e]=range.trim().split('-');return part.start>=parseTime(s)&&part.end<=parseTime(e,{end:true});}))warnings.push(`${p.name}, ${DAY_NAMES[part.day]} : quart en dehors de la disponibilité.`);
    }
    const next=row.cells[d+1];if(c.end>1440&&isTimedCell(next)&&next.start<c.end-1440)warnings.push(`${p.name}, ${DAY_NAMES[d+1]} : chevauchement avec le quart de la veille.`);
  }}return warnings;
}
export const isBirthday=(birth,date)=>Boolean(birth&&date&&String(birth).slice(-5)===String(date).slice(-5));
export const birthdayGreeting=(birth,date)=>isBirthday(birth,date)?'Bonne fête !':'';
export function publicSnapshot(draft,people,departmentId){
  if(departmentId!==undefined)draft=orderDraft(draft,people,departmentId);
  return {rows:draft.rows.map(row=>({personId:row.personId,name:people.find(p=>p.id===row.personId).name,jobTitle:people.find(p=>p.id===row.personId).jobTitle||'',specification:people.find(p=>p.id===row.personId).specification||'',birthdayMonthDay:(people.find(p=>p.id===row.personId).birthday||'').slice(5),group:people.find(p=>p.id===row.personId).group,cells:row.cells.map(normalizeCell)})),notes:draft.notes};
}
export function sheetHTML({department,weekStart,people,draft,blank=false,related=[]}){
  const e=escapeHTML,style=DEPARTMENT_STYLES.find(d=>d.key===department.key)||DEPARTMENT_STYLES[1];
  let rows=blank?people.filter(p=>p.active!==false).map(person=>({person,cells:Array.from({length:7},blankCell)})):draft.rows.map(r=>({...r,person:people.find(p=>p.id===r.personId)})).filter(r=>r.person);
  if(!blank)for(const item of related){
    if(!rows.some(r=>r.personId===item.personId)){const person=people.find(p=>p.id===item.personId);if(person)rows.push({personId:person.id,person,cells:Array.from({length:7},blankCell)});}
  }
  for(const row of rows){
    row.shared=!blank&&(related.some(i=>i.personId===row.personId)||row.cells.some(c=>c.workDepartment||c.sourceDepartment)||(row.person.departments||[]).length>1);
    row.printDays=row.cells.map((c,day)=>{
      const extra=blank?[]:related.filter(i=>i.personId===row.personId&&i.day===day).map(i=>({...i.cell,printDepartment:i.cell.workDepartment||i.sourceDepartment}));
      return [...(isTimedCell(c)?[{...c,printDepartment:c.workDepartment||department.key}]:extra.length?[]:[c]),...extra].sort((a,b)=>(a.start??0)-(b.start??0));
    });
    const longPost=row.shared&&row.printDays.some(day=>day.some(c=>isTimedCell(c)&&shiftAssignment(c,c.printDepartment||department.key).length>20));
    row.printUnits=Math.max(longPost?2:1,...row.printDays.map(day=>day.length));
    row.allMinutes=row.printDays.flat().reduce((n,c)=>n+cellMinutes(c),0);
  }
  const printDay=(r,c,d)=>{
    const entries=r.printDays?.[d]||[c],timed=entries.filter(isTimedCell),multiple=timed.length>1;
    const label=entry=>r.shared?shiftAssignment(entry,entry.printDepartment||department.key):cellDetail(entry);
    return `<td class="sheet-day ${blank?'':cellTone(c)}"><div class="sheet-work ${!blank&&entries.some(v=>label(v))?'has-detail':''} ${multiple?'multiple-shifts':''} ${blank?'':cellTone(c)}">${blank?'':entries.map(entry=>isTimedCell(entry)?`<div class="printed-shift"><b>${timeLabel(entry.start)}</b><b>${timeLabel(entry.end)}</b>${label(entry)?`<small class="assignment-label">${e(label(entry))}</small>`:''}</div>`:e(cellLabel(entry))).join('')}${!blank&&isBirthday(r.person.birthday,addDays(weekStart,d))?'<small class="birthday-greeting">Bonne fête !</small>':''}</div><div class="sheet-day-detail"><span class="sheet-daily-hours">${blank||!timed.length?'':hoursLabel(timed.reduce((n,v)=>n+cellMinutes(v),0))}</span><span class="sheet-availability">${e(availabilityLabel(r.person.availability?.[d]))}</span></div></td>`;
  };
  if(department.id!==undefined)rows.sort((a,b)=>comparePeople(a.person,b.person,department.id));
  const regularCount=rows.filter(r=>r.person.group==='regular').length,partTimeCount=rows.filter(r=>r.person.group==='part_time').length;
  const count=regularCount+partTimeCount,units=rows.reduce((n,r)=>n+r.printUnits,0),capacity=Math.max(count,PRINT_ROW_CAPACITY-(units-count));
  const regularSlots=count?Math.max(regularCount,Math.min(Math.round(capacity*regularCount/count),capacity-partTimeCount)):7;
  const slots={regular:regularSlots,part_time:Math.max(partTimeCount,capacity-regularSlots)};
  const groups=[['regular','Réguliers'],['part_time','Temps partiel']];let sum=0,trainingSum=0,buffetSum=0,kitchenSum=0;
  const totals=(regular,training,empty=false,buffet=0,kitchen=0)=>`<span class="regular-hours">${empty?'':hoursLabel(regular)}</span>${!empty&&training>0?`<small class="training-hours">Form. ${hoursLabel(training)}</small>`:''}${!empty&&buffet>0?`<small class="buffet-hours">Buffet ${hoursLabel(buffet)}</small>`:''}${!empty&&kitchen>0?`<small class="kitchen-hours">Cuisine ${hoursLabel(kitchen)}</small>`:''}`;
  const table=groups.filter(([key])=>slots[key]>0).map(([key,label])=>{const selected=rows.filter(r=>r.person.group===key);while(selected.length<slots[key])selected.push({person:{name:'',seniorityDate:'',group:key,availability:{}},cells:Array.from({length:7},blankCell)});const subtotal=selected.reduce((n,r)=>n+totalMinutes(r),0),trainingSubtotal=selected.reduce((n,r)=>n+trainingMinutes(r),0);sum+=subtotal;trainingSum+=trainingSubtotal;buffetSum+=selected.reduce((n,r)=>n+buffetMinutes(r),0);kitchenSum+=selected.reduce((n,r)=>n+kitchenMinutes(r),0);
    return `<tbody data-group="${key}"><tr class="sheet-group"><th colspan="10">${label}</th></tr>${selected.map(r=>`<tr class="sheet-person${r.printUnits>1?' multi-shift-row':''}"><th class="sheet-name"><div class="sheet-person-label">${e(r.person.name)}${r.person.jobTitle?`<small class="sheet-job-title">${e(r.person.jobTitle)}</small>`:''}${r.person.specification?`<small class="sheet-specification">${e(r.person.specification)}</small>`:''}</div></th><td class="sheet-seniority">${r.person.name?e(r.person.seniorityDate?dateLabel(r.person.seniorityDate):'À compléter'):''}</td>${r.cells.map((c,d)=>printDay(r,c,d)).join('')}<td class="sheet-total">${totals(totalMinutes(r),trainingMinutes(r),blank||!r.person.name,buffetMinutes(r),kitchenMinutes(r))}${!blank&&r.shared?`<small class="all-posts-total">Sem. ${hoursLabel(r.allMinutes)} h</small>`:''}</td></tr>`).join('')}<tr class="sheet-subtotal"><td colspan="9">Sous-total ${label.toLowerCase()}</td><td>${totals(subtotal,0,blank)}</td></tr></tbody>`;
  }).join('');
  return `<article class="department-sheet theme-${e(style.key)} standard-fourteen${units>PRINT_ROW_CAPACITY?' compact-sheet':''}"><header class="sheet-header"><img src="/logo-famille-benoit.svg" alt="IGA extra Famille Benoit"><div><h1>${e(department.name)}</h1><p>HORAIRE HEBDOMADAIRE</p><strong>Du ${dateLabel(weekStart)} au ${dateLabel(addDays(weekStart,6))}</strong></div></header><table class="sheet-table"><colgroup><col class="col-name"><col class="col-seniority">${'<col class="col-day">'.repeat(7)}<col class="col-total"></colgroup><thead><tr><th>Employé</th><th>Ancienneté</th>${DAY_NAMES.map((d,i)=>`<th>${d.slice(0,3)}.<br><small>${addDays(weekStart,i).slice(8)}</small></th>`).join('')}<th>Total<br><small>régulier</small></th></tr></thead>${table}</table><div class="sheet-bottom"><div class="sheet-department-totals"><strong>Régulier : ${blank?'________':hoursLabel(sum)} h</strong>${!blank&&trainingSum>0?`<strong class="department-training-total">Formation : ${hoursLabel(trainingSum)} h</strong>`:''}${!blank&&buffetSum>0?`<strong class="department-buffet-total">Buffet : ${hoursLabel(buffetSum)} h</strong>`:''}${!blank&&kitchenSum>0?`<strong class="department-kitchen-total">Cuisine : ${hoursLabel(kitchenSum)} h</strong>`:''}<strong class="grand-total">Grand total : ${blank?'________':hoursLabel(sum+trainingSum+buffetSum+kitchenSum)} h</strong></div></div></article>`;
}

// Ranks belong to a department and employment group; missing ranks follow members.
export function comparePeople(a={},b={},departmentId){
  return (a.group===b.group?0:a.group==='regular'?-1:1)
    || (a.displayPriorities?.[departmentId]??Infinity)-(b.displayPriorities?.[departmentId]??Infinity)
    || (a.seniorityDate||'9999').localeCompare(b.seniorityDate||'9999')
    || (a.name||'').localeCompare(b.name||'','fr-CA') || (a.id||0)-(b.id||0);
}
export function orderDraft(draft,people,departmentId){
  const byId=new Map(people.map(p=>[p.id,p]));
  return {...draft,rows:[...draft.rows].sort((a,b)=>comparePeople(byId.get(a.personId),byId.get(b.personId),departmentId))};
}


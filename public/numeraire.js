import {items,totals} from './numeraire-calcul.js';
import {bindDirectionInk} from './direction-ink.js';
const $=s=>document.querySelector(s),form=$('form'),result=$('#result');
const session=await fetch('/api/session',{cache:'no-store'}).then(r=>r.json()).catch(()=>({}));
if(session?.user?.kind!=='admin')$('#login').hidden=false;
else {
 $('#cashTabs').hidden=false;
 let records=[];
 function renderHistory(){
  const date=$('#pickupFilter').value,locker=Number($('#lockerFilter').value);
  const list=$('#orders');list.replaceChildren();
  for(const row of records.filter(r=>(!date||r.pickup===date)&&(!locker||r.lockers?.includes(locker)))){
   const article=document.createElement('article'),heading=document.createElement('h3'),info=document.createElement('p'),link=document.createElement('a');
   heading.textContent=(row.pickup||'Date inconnue')+' · Casier '+(row.lockers||[]).join(' et ');
   info.textContent='Envoyée à '+row.recipient+' · '+new Date(row.created_at).toLocaleDateString('fr-CA');
   link.href='/lecture-pdf.html#'+new URLSearchParams({source:'numeraire',id:row.id});
   link.textContent='Ouvrir ou imprimer le PDF signé';article.append(heading,info,link);for(const n of [24,25])if(row['x'+n]){const a=document.createElement('a');a.href='/api/numeraire/excel/'+row.id+'/'+n;a.textContent='Excel envoyé · casier '+n;article.append(document.createElement('br'),a);}list.append(article);
  }
  if(!list.children.length)list.textContent='Aucune commande envoyée pour cette sélection.';
 }
 async function tab(){
  const history=location.hash==='#historique';
  $('#history').hidden=!history;$('#draft').hidden=history;
  if(history){
   $('#orders').textContent='Chargement…';
   try{const r=await fetch('/api/numeraire/historique',{cache:'no-store'});if(!r.ok)throw Error();records=await r.json();renderHistory();}
   catch{$('#orders').textContent='Impossible de charger l’historique.';}
  }
 }
 $('#pickupFilter').oninput=$('#lockerFilter').onchange=renderHistory;
 window.addEventListener('hashchange',tab);tab();
 try{
  const r=await fetch('/api/numeraire/config',{cache:'no-store'});const config=await r.json();
  if(!r.ok||!config.recipient)throw Error();
  $('#testMode').textContent='Mode test · Les commandes seront envoyées à '+config.recipient+'.';
  $('#recipient').textContent=config.recipient;init(config.recipient);
 }catch{result.textContent='Envoi désactivé : destinataire de test indisponible.';}
}
function init(testRecipient){
 form.hidden=false;
 const quantities=[];
 for(const locker of [24,25]){
  const section=document.createElement('fieldset');
  section.innerHTML='<legend>Casier '+locker+'</legend>';
  const inputs=[];
  items.forEach(([label,price],i)=>{
   const row=document.createElement('label');row.className='cash-row';
   row.innerHTML='<span>'+label+'<br><small>'+price+' $ par '+(i<2?'billet':'boîte')+'</small></span><input type="number" inputmode="numeric" min="0" max="'+Math.floor((i<2?1000:3000)/price)+'" step="1" placeholder="0"><output>0 $</output>';
   inputs.push(row.querySelector('input'));section.append(row);
  });
  const summary=document.createElement('strong');summary.setAttribute('aria-live','polite');section.append(summary);
  function update(){
   const q=inputs.map(input=>Number(input.value));
   inputs.forEach((input,i)=>input.nextElementSibling.value=q[i]*items[i][1]+' $');
   try{const {bills,total,error}=totals(q);summary.textContent='Billets '+bills+' / 1 000 $ · Total '+total+' / 3 000 $'+(error?' · '+error:'');}catch(e){summary.textContent=e.message;}
  }
  section.oninput=update;update();quantities.push(inputs);$('#lockers').append(section);
 }
 let strokes=[],line,pending;
 const canvas=$('canvas'),ctx=canvas.getContext('2d');
 function point(e){const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height].map(n=>Math.round(Math.min(1,Math.max(0,n))*10000)/10000);}
 bindDirectionInk(canvas,{start(e){if(pending)return;line=[point(e)];strokes.push(line);},move(e){if(!line||pending)return;const p=point(e),last=line.at(-1);ctx.beginPath();ctx.moveTo(last[0]*800,last[1]*200);ctx.lineTo(p[0]*800,p[1]*200);ctx.strokeStyle='#163768';ctx.lineWidth=2;ctx.stroke();line.push(p);},end(){line=null;}});
 $('#clear').onclick=()=>{strokes=[];ctx.clearRect(0,0,800,200);};
 $('#again').onclick=()=>location.reload();
 form.onsubmit=async e=>{
  e.preventDefault();
  try{
   if(!pending){
    const lockers=quantities.map(inputs=>inputs.map(input=>Number(input.value)));
    const amounts=lockers.map(totals);const invalid=amounts.findIndex(a=>a.error);
    if(invalid>=0)throw Error('Casier '+(24+invalid)+' · '+amounts[invalid].error);
    if(!amounts.some(a=>a.total))throw Error('Ajoute au moins une quantité.');
    if(!strokes.some(l=>l.some(p=>Math.hypot(p[0]-l[0][0],p[1]-l[0][1])>.01)))throw Error('Trace ta signature.');
    pending={testRecipient,id:crypto.randomUUID(),lockers,date:form.elements.date.value,time:form.elements.time.value,name:form.elements.courier.value,notes:form.elements.notes.value,ink:strokes};
    for(const f of form.querySelectorAll('fieldset'))f.disabled=true;
   }
   $('#send').disabled=true;result.textContent='Envoi en cours…';
   const r=await fetch('/api/numeraire',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending)});
   const data=await r.json();
   if(!r.ok){if(r.status===400){pending=null;for(const f of form.querySelectorAll('fieldset'))f.disabled=false;}throw Error(data.error||'Envoi non confirmé.');}
   form.hidden=true;result.textContent='Commande test envoyée à '+testRecipient+' pour le '+pending.date+'.';$('#again').hidden=false;
  }catch(error){result.textContent=error.message;}finally{$('#send').disabled=false;}
 };
}

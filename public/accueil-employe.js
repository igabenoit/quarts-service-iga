import {buildRetirement} from './accueil-retraite.js';
import {buildEmergency} from './accueil-urgence.js';
import {buildSst} from './accueil-sst.js';
const token=location.hash.slice(1);
const onsite=new URLSearchParams(location.search).has('sur-place');
const localParams=new URLSearchParams(location.hash.slice(1));
const list=document.querySelector('#list'),editor=document.querySelector('#editor'),status=document.querySelector('#status');
const node=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
async function call(action,body={}){
 const url=onsite?'/api/employee-files/onboarding/sur-place/'+action+'?'+new URLSearchParams({key:localParams.get('key'),view:'direction'}):'/api/accueil-employe/'+action;
 if(onsite)body.kind=localParams.get('kind');
 const r=await fetch(url,{method:'POST',cache:'no-store',credentials:onsite?'same-origin':'omit',headers:{'Content-Type':'application/json','X-Employee-Files':'1',...(onsite?{}:{Authorization:'Bearer '+token})},body:JSON.stringify(body)});
 if(action==='lecture'&&r.ok)return r.blob();
 const result=await r.json();if(!r.ok)throw Error(result.error);return result;
}
function show(state){
 list.replaceChildren();editor.replaceChildren();
 if(onsite){
  document.querySelector('h1').textContent=state.employee;
  const back=node('a','← Formulaires');back.href='/dossiers-employes?vue=direction#formulaires';list.append(back);
  const d=state.documents[0];
  if(!d.done){openForm(state,d);return;}
  list.append(node('p',d.title+' · PDF signé et classé.'));
  const link=node('a','Ouvrir et imprimer le PDF signé');link.href='/lecture-pdf.html#'+new URLSearchParams({id:d.originalId,view:'direction',key:localParams.get('key')});list.append(link);return;
 }
 const done=state.documents.filter(d=>d.done).length;
 list.append(node('p',done+' document(s) sur '+state.documents.length+' complété(s)'),node('p','Échéance · '+String(state.due).slice(0,10)));
 for(const d of state.documents){const b=node('button',d.title+' · '+(d.done?'Signé':d.version?'Reprendre':'Remplir'));b.disabled=d.done;b.onclick=()=>openForm(state,d);list.append(b);}
 if(done===state.documents.length)list.append(node('p','Votre dossier est complet. Vos documents signés sont classés.'));
}
function openForm(state,d){
 const form=node('form');form.className='panel';editor.replaceChildren(form);form.append(node('h2',d.title));
 const fields=new Map(), labels={Emploi:'Date d’emploi',Signature:'Date de signature',Naissance:'Date de naissance',Indicatif:'Indicatif régional',Rue:'Numéro et rue',Appartement:'Appartement (ou S/O)'};
 if(['sst','ethique'].includes(d.kind)){
  const read=node('button',d.kind==='sst'?'Ouvrir l’annexe SST (PDF remplissable)':'Télécharger le code d’éthique et lire les attestations (PDF, 52 pages)');read.type='button';
  read.onclick=async()=>{try{
   const blob=await call('lecture',{kind:d.kind}),url=URL.createObjectURL(blob),link=node('a');
   link.href=url;link.download=d.kind==='sst'?'Annexe 11.1 - Accueil SST.pdf':'Code d’éthique et politiques - septembre 2025.pdf';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(error){status.textContent=error.message;}};
  form.append(read);
 }
 if(d.kind==='sst')buildSst(form,d.draft,fields,onsite);
 if(d.kind==='ethique'){
  const confirmations={Respect:'Page 40 · Je signe le registre de la politique de respect au travail.',Vente:'Page 51 · Je reconnais avoir été informé des obligations relatives à la vente aux mineurs décrites dans cette attestation.',Réception:'Page 52 · Je certifie avoir reçu le code d’éthique et les politiques et j’accepte les dispositions de l’accusé de réception.'};
  for(const key of d.fields){
   const label=node('label',confirmations[key]||(key==='Signature'?'Date de signature':key==='Poste'?'Titre du poste':key));
   const input=node('input');input.name=key;input.required=true;
   if(confirmations[key]){input.type='checkbox';input.checked=d.draft[key]==='yes';label.prepend(input);}
   else{input.type=key==='Signature'?'date':'text';input.maxLength=100;input.value=d.draft[key]||'';label.append(input);}
   fields.set(key,input);form.append(label);
  }
  form.append(node('p','Ta signature sera apposée aux trois emplacements de l’employé. Le nom et la signature du supérieur immédiat figurent déjà à la page 52.'));
 }
 const validateRetirement=d.kind==='retraite'?buildRetirement(form,d.draft,fields):null;
  const validateEmergency=d.kind==='urgence'?buildEmergency(form,d.draft,fields):null;
 if(!['ethique','sst'].includes(d.kind)&&!validateRetirement&&!validateEmergency)for(const key of d.fields){const label=node('label',labels[key]||key),i=node('input');i.type=['Naissance','Emploi','Signature'].includes(key)?'date':key==='Courriel'?'email':'text';i.maxLength=200;i.required=true;i.value=d.draft[key]||'';label.append(i);form.append(label);fields.set(key,i);}
 const policy=node('details');policy.append(node('summary','Politique de confidentialité'),node('p',state.policy.text));
 const check=node('input');check.type='checkbox';const label=node('label');label.append(check,' J’ai pris connaissance de la politique.');form.append(policy,label,node('h3','Signature'));
 const c=node('canvas');c.width=800;c.height=200;c.setAttribute('aria-label','Tracez votre signature');form.append(c);
 const ctx=c.getContext('2d');let strokes=[],line,active;
 const point=e=>{const r=c.getBoundingClientRect();return [(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height].map(v=>Math.max(0,Math.min(1,v)));};
 c.onpointerdown=e=>{if(active!=null)return;active=e.pointerId;c.setPointerCapture(active);line=[point(e)];strokes.push(line);ctx.beginPath();ctx.moveTo(line[0][0]*800,line[0][1]*200);};
 c.onpointermove=e=>{if(e.pointerId!==active)return;const p=point(e);line.push(p);ctx.lineTo(p[0]*800,p[1]*200);ctx.stroke();};
 c.onpointerup=c.onpointercancel=()=>{active=null;};
 const erase=node('button','Effacer la signature');erase.type='button';erase.onclick=()=>{ctx.clearRect(0,0,800,200);strokes=[];};form.append(erase);
 for(const [action,title] of [['save','Enregistrer et reprendre plus tard'],['sign','Signer et classer le PDF']]){
  const b=node('button',title);b.type='button';form.append(b);
  b.onclick=async()=>{if(!check.checked){status.textContent='Veuillez confirmer la lecture de la politique.';return;}if(action==='sign'){validateRetirement?.();validateEmergency?.();if(!form.reportValidity())return;}
   b.disabled=true;try{const result=await call(action,{kind:d.kind,version:d.version,policy:state.policy.id,answers:Object.fromEntries([...fields].filter(([,i])=>!i.matches(':disabled')).map(([k,i])=>[k,i.type==='checkbox'?(i.checked?'yes':'no'):i.value])),strokes:action==='sign'?strokes:[]});show(result);status.textContent=action==='save'?(onsite?'Brouillon enregistré dans le dossier.':'Brouillon enregistré. Conservez votre lien pour reprendre.'):'PDF signé et classé.';}catch(e){status.textContent=e.message;}finally{b.disabled=false;}};
 }
 form.onsubmit=e=>e.preventDefault();editor.scrollIntoView();
}
call('state').then(show).catch(e=>status.textContent=e.message);

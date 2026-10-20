const host=document.createElement('section');
document.querySelector('#accessContent').append(host);
host.innerHTML='<h2>Accès de test à la discussion du Service</h2><p>Autorise une personne pendant sept jours à lire la discussion, envoyer des messages et recevoir les notifications. Ses accès aux horaires restent inchangés.</p><form><label>Fiche avec code personnel<select required></select></label><button>Autoriser pour sept jours</button></form><p role="status"></p><div></div>';
const form=host.querySelector('form'),select=host.querySelector('select'),status=host.querySelector('[role=status]'),list=host.querySelector('div');
async function api(path='',options={}){
  const response=await fetch('/api/service-chat/guests'+path,{cache:'no-store',...options,headers:{'Content-Type':'application/json'}});
  const body=await response.json();if(!response.ok)throw Error(body.error);return body;
}
async function load(){
  const {people}=await api(),chosen=select.value;
  select.replaceChildren(new Option('Choisir une personne…',''));
  list.replaceChildren();
  for(const person of people){
    select.add(new Option(`${person.name} (fiche ${person.id})`,person.id));
    if(person.expiresAt&&new Date(person.expiresAt)>new Date()){
      const row=document.createElement('p'),button=document.createElement('button');
      row.textContent=person.name+' — jusqu’au '+new Date(person.expiresAt).toLocaleString('fr-CA')+' ';
      button.type='button';button.textContent='Retirer l’accès';
      button.onclick=()=>save(person.id,false,button);row.append(button);list.append(row);
    }
  }
  select.value=chosen;
}
async function save(id,enabled,button){
  button.disabled=true;
  try{await api('/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({enabled})});await load();status.textContent=enabled?'Accès autorisé pour sept jours. Cette personne peut utiliser son code personnel sur la page Discussion.':'Accès de test retiré.';}
  catch(error){status.textContent=error.message;}
  finally{button.disabled=false;}
}
form.onsubmit=event=>{event.preventDefault();if(select.value)save(select.value,true,form.querySelector('button'));};
load().catch(error=>{status.textContent=error.message;});

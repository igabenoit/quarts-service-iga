import {accountValidation} from './manager-account-fields.js';
const $=s=>document.querySelector(s);let data,editing=null;
function feedback(text){const status=$('#accountFormStatus');status.textContent=text;status.focus();status.scrollIntoView({block:'nearest'});}
const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
async function api(path,options={}){const response=await fetch(path,{cache:'no-store',...options,headers:{'Content-Type':'application/json'}});const body=await response.json();if(!response.ok)throw Error(body.error);return body;}
const concealPasswords=new Set();
function passwordControl(account){
  const box=node('div',''),value=node('code',''),toggle=node('button','Afficher le mot de passe');box.className='manager-password';toggle.type='button';toggle.className='quiet';toggle.setAttribute('aria-expanded','false');
  let timer,sequence=0;const hide=()=>{sequence++;clearTimeout(timer);value.textContent='';toggle.textContent='Afficher le mot de passe';toggle.setAttribute('aria-expanded','false');toggle.disabled=false;};concealPasswords.add(hide);
  toggle.onclick=async()=>{if(value.textContent){hide();return;}const request=++sequence;toggle.disabled=true;try{const result=await api('/api/manager-accounts/'+account.id+'/password',{method:'POST'});if(request!==sequence)return;value.textContent=result.password;toggle.textContent='Masquer le mot de passe';toggle.setAttribute('aria-expanded','true');timer=setTimeout(hide,60000);}catch(error){if(request===sequence){value.textContent=error.message;timer=setTimeout(hide,60000);}}finally{if(request===sequence)toggle.disabled=false;}};
  box.append(toggle,value);if(!account.passwordAvailable)box.append(node('small','Ancien mot de passe : affichable après la prochaine connexion du gérant ou après sa redéfinition.'));return box;
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)for(const hide of concealPasswords)hide();});
function edit(account){
  editing=account;$('#accountForm').reset();$('#accountTitle').textContent=account?'Modifier '+account.name:'Ajouter un gérant';$('#managerName').value=account?.name||'';$('#managerLogin').value=account?.login||'';$('#managerActive').checked=account?.active??true;
  $('#managerPerson').replaceChildren(new Option('Choisissez sa fiche employé',''));
  for(const p of data.people||[]){const option=new Option(p.name+(p.active?'':' — inactive'),String(p.id));option.disabled=!p.active;$('#managerPerson').append(option);}
  $('#managerPerson').value=account?.personId?String(account.personId):'';
  $('#managerPassword').required=!account;$('#passwordHelp').textContent=account?'Laissez le mot de passe vide pour le conserver, ou saisissez-en un nouveau (12 caractères minimum).':'Choisissez au moins 12 caractères. Transmettez le mot de passe au gérant par votre moyen habituel.';
  $('#accountDepartments').replaceChildren();
  for(const d of data.departments){const label=node('label',' '+d.name);label.className='check';const input=document.createElement('input');input.type='checkbox';input.value=d.id;input.checked=!!account?.departments.includes(Number(d.id));label.prepend(input);$('#accountDepartments').append(label);}
}
function render(){
  for(const hide of concealPasswords)hide();concealPasswords.clear();
  $('#accountsList').replaceChildren();
  for(const a of data.accounts){const item=node('article','');item.className='person-card';item.append(node('h3',a.name),node('p',a.login+' · '+(a.accessAllowed?'Actif':'Accès bloqué')),node('p',data.departments.filter(d=>a.departments.includes(Number(d.id))).map(d=>d.name).join(', ')),passwordControl(a));const button=node('button','Modifier les accès / mot de passe');button.className='quiet';button.onclick=()=>{edit(a);$('#accountTitle').scrollIntoView({block:'start'});};item.append(button);$('#accountsList').append(item);}
  if(!data.accounts.length)$('#accountsList').append(node('p','Aucun compte créé. Ajoutez votre premier gérant.'));
  for(const [index,a] of data.accounts.entries()){
    const person=data.people?.find(p=>String(p.id)===String(a.personId));
    $('#accountsList').children[index].append(node('p',person?'Fiche employé : '+person.name+(a.accessAllowed?'':' — accès bloqué'):'À rattacher à une fiche employé — accès bloqué'));
  }
}
$('#managerLink').textContent=location.origin+'/connexion';
$('#newAccount').onclick=()=>edit(null);
$('#accountForm').onsubmit=async event=>{
  event.preventDefault();if($('#saveAccount').disabled)return;
  const values={name:$('#managerName').value,login:$('#managerLogin').value,password:$('#managerPassword').value,personId:$('#managerPerson').value?Number($('#managerPerson').value):null,active:$('#managerActive').checked,departments:[...$('#accountDepartments').querySelectorAll('input:checked')].map(i=>Number(i.value)),version:editing?.version};
  const error=accountValidation(values,!!editing);if(error){feedback(error);return;}
  $('#saveAccount').disabled=true;feedback('Enregistrement…');
  try{data=await api('/api/manager-accounts'+(editing?'/'+editing.id:''),{method:editing?'PUT':'POST',body:JSON.stringify(values)});render();edit(null);feedback('Compte enregistré : '+values.login.trim().toLowerCase()+'. Il apparaît dans la liste des gérants. Utilisez cet identifiant et le mot de passe choisi sur la page Connexion des gérants.');$('#accessMessage').textContent='Compte enregistré. Les accès sont à jour.';}
  catch(error){feedback('Compte non enregistré : '+error.message);}
  finally{$('#saveAccount').disabled=false;}
};
try{data=await api('/api/manager-accounts');$('#accessContent').hidden=false;render();edit(null);}catch(error){$('#accessMessage').textContent=error.message+' Utilisez votre accès administrateur depuis la page d’accueil.';}

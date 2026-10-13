const $=s=>document.querySelector(s);let data,editing=null;
const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
async function api(path,options={}){const response=await fetch(path,{cache:'no-store',...options,headers:{'Content-Type':'application/json'}});const body=await response.json();if(!response.ok)throw Error(body.error);return body;}
function edit(account){
  editing=account;$('#accountForm').reset();$('#accountTitle').textContent=account?'Modifier '+account.name:'Ajouter un gérant';$('#managerName').value=account?.name||'';$('#managerLogin').value=account?.login||'';$('#managerActive').checked=account?.active??true;
  $('#managerPassword').required=!account;$('#passwordHelp').textContent=account?'Laissez le mot de passe vide pour le conserver, ou saisissez-en un nouveau (12 caractères minimum).':'Choisissez au moins 12 caractères. Transmettez le mot de passe au gérant par votre moyen habituel.';
  $('#accountDepartments').replaceChildren();
  for(const d of data.departments){const label=node('label',' '+d.name);label.className='check';const input=document.createElement('input');input.type='checkbox';input.value=d.id;input.checked=!!account?.departments.includes(Number(d.id));label.prepend(input);$('#accountDepartments').append(label);}
}
function render(){
  $('#accountsList').replaceChildren();
  for(const a of data.accounts){const item=node('article','');item.className='person-card';item.append(node('h3',a.name),node('p',a.login+' · '+(a.active?'Actif':'Désactivé')),node('p',data.departments.filter(d=>a.departments.includes(Number(d.id))).map(d=>d.name).join(', ')));const button=node('button','Modifier les accès / mot de passe');button.className='quiet';button.onclick=()=>{edit(a);$('#accountTitle').scrollIntoView({block:'start'});};item.append(button);$('#accountsList').append(item);}
  if(!data.accounts.length)$('#accountsList').append(node('p','Aucun compte créé. Ajoutez votre premier gérant.'));
}
$('#managerLink').textContent=location.origin+'/connexion';
$('#newAccount').onclick=()=>edit(null);
$('#accountForm').onsubmit=async event=>{
  event.preventDefault();$('#saveAccount').disabled=true;$('#accessMessage').textContent='Enregistrement…';
  try{data=await api('/api/manager-accounts'+(editing?'/'+editing.id:''),{method:editing?'PUT':'POST',body:JSON.stringify({name:$('#managerName').value,login:$('#managerLogin').value,password:$('#managerPassword').value,active:$('#managerActive').checked,departments:[...$('#accountDepartments').querySelectorAll('input:checked')].map(i=>Number(i.value)),version:editing?.version})});render();edit(null);$('#accessMessage').textContent='Compte enregistré. Les accès sont à jour.';}
  catch(error){$('#accessMessage').textContent=error.message;}
  finally{$('#saveAccount').disabled=false;}
};
try{data=await api('/api/manager-accounts');$('#accessContent').hidden=false;render();edit(null);}catch(error){$('#accessMessage').textContent=error.message+' Utilisez votre accès administrateur depuis la page d’accueil.';}

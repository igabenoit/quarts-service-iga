import {bindEmployeeIdentityCheck,identityCheckMarkup} from './employee-identity.js';
import {escapeHTML as esc,monday,today} from './departments-core.js';
async function request(path,body,headers={}){
 const response=await fetch(path,{method:body===undefined?'GET':'POST',cache:'no-store',headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Création impossible.');return data;
}
export async function createEmployeeFromFiles({modal,onSaved,onExisting}){
 const meta=await request('/api/departments/meta');
 modal('Créer un employé',`<p>Une seule fiche pour son dossier d’embauche et ses horaires. Vérifiez d’abord si la personne existe déjà.</p><form id="createSharedEmployee"><label>Nom complet<input name="name" minlength="2" maxlength="100" required autocomplete="off"></label>${identityCheckMarkup}<div class="form-grid"><label>Département<select name="department" required><option value="">Choisir…</option>${meta.departments.filter(d=>d.active).map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label><label data-service hidden>Fonction au Service<select name="role"><option value="">Choisir…</option><option value="cashier">Caissière / caissier</option><option value="packer">Emballeur</option><option value="orders">Commandes téléphoniques</option><option value="supervisor">Superviseur</option><option value="manager">Gérant</option></select></label><label data-department>Titre / fonction<input name="jobTitle" maxlength="80" placeholder="Ex. commis"></label><label data-department>Groupe<select name="group"><option value="regular">Régulier</option><option value="part_time">Temps partiel</option></select></label><label>Matricule (6 derniers chiffres)<input name="employeeCode" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off"><small>Peut être ajouté plus tard par la direction.</small></label><label>Courriel<input name="email" type="email" maxlength="254"></label><label>Date de naissance<input name="birthday" type="date"></label><label>Date d’entrée en poste<input name="startDate" type="date"></label></div><label class="check"><input name="verified" type="checkbox">J’ai vérifié la date d’entrée indiquée.</label><label class="check"><input name="distinctPerson" type="checkbox">Si une fiche correspond au nom ou au courriel, j’ai vérifié qu’il s’agit d’une autre personne.</label><p>Le gérant pourra préciser les disponibilités et placer l’employé dans sa grille d’horaire. La création n’envoie aucun courriel.</p><button type="submit">Créer la fiche et ouvrir le dossier</button><p data-error role="alert"></p></form>`);
 const form=document.getElementById('createSharedEmployee'),fields=form.elements,error=form.querySelector('[data-error]'),button=form.querySelector('button[type=submit]');
 bindEmployeeIdentityCheck({name:fields.name,code:fields.employeeCode,email:fields.email,container:form.querySelector('[data-identity-check]'),distinct:fields.distinctPerson,onOpen:onExisting});
 fields.department.onchange=()=>{const service=meta.departments.find(d=>d.id===Number(fields.department.value))?.key==='service';form.querySelector('[data-service]').hidden=!service;fields.role.required=service;form.querySelectorAll('[data-department]').forEach(e=>e.hidden=service);};
 let savedKey;
 form.onsubmit=async event=>{
  event.preventDefault();if(button.disabled)return;button.disabled=true;error.textContent='';
  try{
   if(savedKey){await onSaved(savedKey);return;}
   const department=meta.departments.find(d=>d.id===Number(fields.department.value));
   if(!department)throw Error('Choisissez un département.');
   if(fields.startDate.value&&!fields.verified.checked)throw Error('Confirmez la date d’entrée avant de créer la fiche.');
   const common={name:fields.name.value,employeeCode:fields.employeeCode.value,email:fields.email.value,birthday:fields.birthday.value,distinctPerson:fields.distinctPerson.checked,active:true};
   if(department.key==='service'){
    const week=monday(today()),snapshot=await request('/api/weeks/'+week,undefined,{'X-Service-Store':'principal'});
    const result=await request('/api/employees',{...common,role:fields.role.value,seniority:fields.startDate.value,targetMinutes:0,maxMinutes:2400,availability:{}},{'X-Service-Week':week,'X-Service-Revision':snapshot.revision,'X-Service-Store':'principal'});
    savedKey='service:'+result.employee.id;
   }else{
    const result=await request('/api/departments/people',{...common,jobTitle:fields.jobTitle.value,group:fields.group.value,departments:[department.id],seniorityDate:fields.startDate.value,seniorityVerified:fields.verified.checked,sourceNote:fields.startDate.value?'Date vérifiée lors de la création du dossier':'',availability:{}});
    savedKey='store:'+result.id;
   }
   await onSaved(savedKey);
  }catch(err){error.textContent=(savedKey?'La fiche est créée. Réessayez pour ouvrir son dossier sans la recréer. ':'')+err.message;}
  finally{button.disabled=false;if(savedKey)button.textContent='Ouvrir le dossier créé';}
 };
}

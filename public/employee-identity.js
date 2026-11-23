export async function findEmployeeMatches(values){
 const response=await fetch('/api/departments/people/matches',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Vérification des fiches indisponible.');return data.matches;
}
export function bindEmployeeIdentityCheck({name,code,email,container,distinct,isNew=()=>true,onOpen}){
 let timer,sequence=0;
 if(distinct)distinct.closest('label').hidden=true;
 async function check(){
  const current=++sequence;container.replaceChildren();
  if(!isNew())return [];
  const values={name:name.value,employeeCode:code?.value||'',email:email?.value||''};
  if(values.name.trim().length<2&&values.employeeCode.length!==6&&!values.email.includes('@'))return [];
  try{
   const matches=await findEmployeeMatches(values);if(current!==sequence)return [];
   if(distinct)distinct.closest('label').hidden=!matches.some(m=>m.reasons.includes('name')||m.reasons.includes('email'));
   if(!matches.length){container.textContent='Aucune fiche correspondante trouvée dans le répertoire commun.';return matches;}
   const title=document.createElement('strong');title.textContent='Vérifiez les fiches existantes avant de créer un employé.';container.append(title);
   for(const match of matches){
    const row=document.createElement('p');row.textContent=match.name+' · '+match.departments.join(' / ')+(match.active?'':' · Inactif')+(match.reasons.includes('code')?' · Matricule déjà utilisé':'');
    if(match.canOpen){const link=document.createElement('a');link.textContent='Ouvrir ce dossier';link.href='/dossiers-employes#dossiers/'+match.employeeKey;link.style.marginLeft='0.5rem';if(onOpen)link.onclick=event=>{event.preventDefault();onOpen(match);};else{link.target='_blank';link.rel='noopener';}row.append(link);}
    else row.append(document.createTextNode(' · Demandez à la direction de rattacher cette fiche à votre département.'));
    container.append(row);
   }
   return matches;
  }catch(error){if(current===sequence)container.textContent=error.message;return [];}
 }
 const refresh=()=>{clearTimeout(timer);sequence++;container.replaceChildren();if(distinct){distinct.checked=false;distinct.closest('label').hidden=true;}if(isNew())timer=setTimeout(check,250);};
 for(const input of [name,code,email].filter(Boolean))input.addEventListener('input',refresh);
 return {refresh,check};
}
export const identityCheckMarkup='<div data-identity-check class="panel" style="grid-column:1/-1" role="status" aria-live="polite"></div>';

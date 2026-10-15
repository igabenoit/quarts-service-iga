const response=await fetch('/api/session',{cache:'no-store'});
if(response.ok){
  const {user}=await response.json(),nav=document.createElement('nav');nav.className='actions';nav.setAttribute('aria-label','Compte et accès');
  const link=(text,path)=>{const a=document.createElement('a');a.textContent=text;a.href=path;a.className='button quiet';nav.append(a);};
  if(user?.kind==='account'){document.querySelectorAll('a[href="/courriels"],a[href="/conges-test"],a[href="/disponibilites-test"]').forEach(a=>a.hidden=true);if(!user.serviceAccess)document.querySelectorAll('a[href="/"]').forEach(a=>{a.href='/departements';if(a.textContent.trim()==='Retour au Service')a.textContent='Retour aux horaires';});}
  if(user){const name=document.createElement('span');name.textContent=user.name;nav.append(name);if(user.kind==='admin'){link('Gestion des accès','/acces');link('Portail · tout le magasin','/horaires-departements?vue=magasin');link('Commandes de chandails','/chandails-gestion');}link('Horaires des départements','/departements');link('Congés','/conges-gestion');link('Disponibilités','/disponibilites-gestion');if(user.serviceAccess)link('Service','/');
    const logout=document.createElement('button');logout.className='quiet';logout.textContent='Se déconnecter';logout.onclick=async()=>{if(!confirm('Vos modifications sont-elles enregistrées ? Déconnecter ce compte ?'))return;const r=await fetch('/api/logout',{method:'POST'});if(r.ok)location.assign('/connexion');};nav.append(logout);
  }else link('Connexion des gérants','/connexion');
  document.querySelector('main,.workspace')?.prepend(nav);
}

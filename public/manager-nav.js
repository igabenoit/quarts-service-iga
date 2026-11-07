import {watchAccess} from './access-session.js';
import './direction-entry.js';
if(!document.querySelector('link[href="/manager-nav.css"]')){
  const css=document.createElement('link');css.rel='stylesheet';css.href='/manager-nav.css';document.head.append(css);
}
const guard=watchAccess('manager');
const response=await fetch('/api/session',{cache:'no-store'});
if(response.ok){
  const {user}=await response.json(),nav=document.createElement('nav');nav.className='manager-nav';nav.setAttribute('aria-label','Compte et accès');
  const account=document.createElement('div');account.className='manager-nav__account';
  const menu=document.createElement('details');menu.className='manager-nav__menu';
  const summary=document.createElement('summary');summary.textContent='Menu du portail';
  const links=document.createElement('div');links.className='manager-nav__links';menu.append(summary,links);nav.append(account,menu);
  const compact=matchMedia('(max-width: 640px)');menu.open=!compact.matches;
  compact.addEventListener('change',e=>{menu.open=!e.matches;});
  if(user)guard.activate();
  const link=(text,path)=>{const a=document.createElement('a');a.textContent=text;a.href=path;a.className='manager-nav__link';const target=new URL(path,location.origin);if(target.pathname===location.pathname&&(!target.search||target.search===location.search))a.setAttribute('aria-current','page');links.append(a);};
  if(user?.kind==='account'){document.querySelectorAll('a[href="/courriels"],a[href="/conges-test"],a[href="/disponibilites-test"]').forEach(a=>a.hidden=true);if(!user.serviceAccess)document.querySelectorAll('a[href="/"]').forEach(a=>{a.href='/departements';if(a.textContent.trim()==='Retour au Service')a.textContent='Retour aux horaires';});}
  if(user){const name=document.createElement('span');name.className='manager-nav__name';name.textContent=user.name;account.append(name);link('Dossiers d’employés','/dossiers-employes');if(user.kind==='admin'){link('Santé et sécurité','/sst');link('Gestion des accès','/acces');link('Accès familiaux','/acces-famille');link('Portail · tout le magasin','/horaires-departements?vue=magasin');link('Commandes de chandails','/chandails-gestion');}link('Horaires des départements','/departements');link('Congés','/conges-gestion');link('Disponibilités','/disponibilites-gestion');if(user.serviceAccess){link('Service','/');link('Discussion du Service','/discussion?mode=manager');}
    const logout=document.createElement('button');logout.className='manager-nav__logout';logout.type='button';logout.textContent='Se déconnecter';logout.onclick=async()=>{if(!confirm('Vos modifications sont-elles enregistrées ? Déconnecter ce compte ?'))return;const r=await fetch('/api/logout',{method:'POST'});if(r.ok)location.assign('/connexion');};account.append(logout);
  }else{account.hidden=true;link('Connexion des gérants','/connexion');}
  document.querySelector('main,.workspace')?.prepend(nav);
}

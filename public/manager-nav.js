import {watchAccess} from './access-session.js';

const path=location.pathname.replace(/\.html$/,'').replace(/^\/index$/,'/');
const params=new URLSearchParams(location.search);
const staffPages=['/conges','/disponibilites','/chandails','/horaire'];
const employeeContext=staffPages.includes(path)
  ||path==='/discussion'&&params.get('mode')!=='manager'
  ||path==='/horaires-departements'&&params.get('vue')!=='magasin'
  ||path==='/dossiers-employes'&&params.get('vue')==='employe';
const css=document.createElement('link');
css.rel='stylesheet';css.href='/manager-nav.css';document.head.append(css);

function navigation(items,context){
 const current=items.find(([,url])=>{
  const target=new URL(url,location.origin);
  return target.pathname===path;
 });
 const nav=document.createElement('nav');
 nav.className='manager-nav';nav.setAttribute('aria-label','Menu du portail');
 const menu=document.createElement('details');
 const summary=document.createElement('summary');
 summary.textContent='Menu du portail';
 const section=document.createElement('span');
 section.textContent=context+(current?' · '+current[0]:'');
 summary.append(section);
 const links=document.createElement('div');links.className='manager-nav__links';
 for(const item of items){
  const link=document.createElement('a');[link.textContent,link.href]=item;
  if(item===current)link.setAttribute('aria-current','page');
  links.append(link);
 }
 menu.append(summary,links);nav.append(menu);document.body.prepend(nav);
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&menu.open){menu.open=false;summary.focus();}
 });
 return links;
}

const staff=[
 ['Mon horaire','/horaires-departements?vue=employe'],['Mon dossier','/dossiers-employes?vue=employe'],
 ['Demander un congé','/conges'],['Mes disponibilités','/disponibilites'],['Commander un chandail','/chandails']
];
if(path==='/horaire-famille'){
 navigation([['Horaire familial','/horaire-famille'],['Portail employés','/horaires-departements?vue=employe']],'Famille');
}else if(employeeContext){
 navigation(staff,'Employé');
}else if(!path.startsWith('/h/')){
 void import('./direction-entry.js');
 const session=await fetch('/api/session',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
 const user=session?.user;
 if(user){
  const admin=user.kind==='admin';
  const items=[['Dossiers d’employés','/dossiers-employes'],['Horaires des départements','/departements'],
   ['Gestion des congés','/conges-gestion'],['Gestion des disponibilités','/disponibilites-gestion']];
  if(admin)items.push(['Commande de numéraire','/numeraire'],['Santé et sécurité','/sst'],['Horaires du magasin','/horaires-departements?vue=magasin'],
   ['Commandes de chandails','/chandails-gestion'],['Gestion des accès','/acces'],['Clés des employés','/cles-employes'],
   ['Accès familiaux','/acces-famille'],['Courriels des employés','/courriels']);
  if(user.serviceAccess)items.push(['Quarts Service','/'],['Discussion du Service','/discussion?mode=manager']);
  if(!admin){
   document.querySelectorAll('a[href="/courriels"],a[href="/conges-test"],a[href="/disponibilites-test"]').forEach(a=>a.hidden=true);
   if(!user.serviceAccess)document.querySelectorAll('a[href="/"]').forEach(a=>{a.href='/departements';if(a.textContent.trim()==='Retour au Service')a.textContent='Retour aux horaires';});
  }
  const links=navigation(items,admin?'Direction':'Gestion');
  const logout=document.createElement('button');logout.type='button';logout.textContent='Se déconnecter';
  logout.onclick=async()=>{if(confirm('Se déconnecter du portail ?')&&(await fetch('/api/logout',{method:'POST'})).ok)location.assign('/connexion');};
  links.append(logout);watchAccess('manager',{active:true});
 }else if(session){
  if(path==='/dossiers-employes')navigation(staff,'Employé');
  else navigation([['Connexion des gérants','/connexion']],'Gestion');
 }
}

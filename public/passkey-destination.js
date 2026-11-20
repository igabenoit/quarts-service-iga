const allowed=new Set(['/','/index.html','/sst','/departements','/acces','/acces-famille','/courriels','/conges-gestion','/disponibilites-gestion','/chandails-gestion','/horaires-departements','/horaire','/conges','/disponibilites','/chandails','/discussion','/dossiers-employes','/cles-employes']);

export function passkeyDestination(returnTo,session,origin){
  const kind=session?.user?.kind;
  const manager=kind==='admin'||kind==='account';
  const home=kind==='admin'?'/index.html':kind==='account'?(session.path==='/index.html'&&session.user.serviceAccess?'/index.html':'/departements'):'/horaires-departements?vue=employe';
  if(!returnTo)return home;
  let next;
  try{next=new URL(returnTo,origin);}catch{return home;}
  if(next.origin!==origin||!allowed.has(next.pathname))return home;
  if(manager&&['/','/index.html','/horaires-departements'].includes(next.pathname))return home;
  return next.pathname+next.search+next.hash;
}

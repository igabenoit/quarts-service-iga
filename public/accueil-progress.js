export function renderEmployeeProgress(parent,state,openForm){
 const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
 const docs=state.documents,signed=docs.filter(d=>d.employeeSigned||d.done).length,complete=docs.filter(d=>d.done).length;
 parent.append(node('h2','Où en est votre dossier?'),node('p','Vos démarches complétées : '+signed+' / '+docs.length+' · Documents finalisés ou reçus : '+complete+' / '+docs.length));
 parent.append(node('p','Vous pouvez remplir et signer votre partie même si la direction n’a pas encore terminé la sienne. Après votre signature, vos renseignements sont verrouillés.'));
 for(const d of docs){
  const card=node('article','');card.className='onboarding-document';card.append(node('h3',d.title));
  if(d.kind==='cheque'){
   card.append(node('p',d.done?'Reçu · '+(d.attachment?.type==='link'?'Lien transmis':d.attachment?.name||'Document transmis'):'À fournir · Photo, PDF ou lien vers votre spécimen de chèque.'));
   if(d.done)card.append(node('p','Votre pièce a été conservée au dossier. Aucune signature n’est requise.'));
   else{const button=node('button','Transmettre mon spécimen de chèque');button.type='button';button.onclick=()=>openForm(state,d);card.append(button);}
   parent.append(card);continue;
  }
  const steps=node('dl','');
  for(const [label,value] of [
   ['Votre partie',d.employeeSigned||d.done?'Signée et complétée':'À remplir et signer'],
   ['Direction / responsable',d.done?'Terminé':d.awaitingDirection?'À finaliser par la direction':d.directionRequired?(d.directionReady?'Renseignements préparés':'Section réservée à la direction'):'Aucune partie à remplir'],
   ['Document',d.done?'Finalisé et classé':d.awaitingDirection?'Votre partie est conservée; finalisation en attente':'En préparation']
  ])steps.append(node('dt',label),node('dd',value));
  card.append(steps);
  if(d.awaitingDirection)card.append(node('p','Vous n’avez plus rien à faire pour ce document. Un avis de finalisation est prévu pour la direction. Vous n’aurez pas à signer de nouveau.'));
  else if(!d.done){
   if(['sst','sst_general'].includes(d.kind))card.append(node('p','À remplir avec votre gérant, dans votre département.'));
   const button=node('button','Remplir ou reprendre ma partie');button.type='button';button.onclick=()=>openForm(state,d);card.append(button);
  }
  parent.append(card);
 }
 if(signed===docs.length)parent.append(node('p',complete===docs.length?'Votre dossier est entièrement finalisé.':'Vous avez terminé vos démarches. La direction doit encore finaliser les documents indiqués ci-dessus.'));
}

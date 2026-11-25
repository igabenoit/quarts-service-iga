import {sendBlocks} from './file-blocks.js';
import {chequeLink,chequeMaxBytes} from './cheque-schema.js';

export function buildCheque(form,state,doc,{token,reload,status}){
 const node=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
 form.append(node('p','Transmettez votre spécimen de chèque ou votre document de dépôt direct fourni par votre banque. Le nom du titulaire et les coordonnées bancaires doivent être lisibles. Aucune signature n’est requise ici.'),node('p','Cette pièce sera accessible à la direction et aux personnes autorisées à la paie.'));
 const label=node('label','Comment souhaitez-vous transmettre le document?'),mode=node('select');mode.name='mode';
 for(const [value,text] of [['file','Joindre une photo ou un PDF'],['link','Fournir un lien']]){const option=node('option',text);option.value=value;mode.append(option);}
 label.append(mode);form.append(label);
 const fileBox=node('div'),fileLabel=node('label','Photo ou PDF du spécimen de chèque'),file=node('input');
 file.type='file';file.accept='.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';file.required=true;fileLabel.append(file);fileBox.append(fileLabel,node('p','PDF ou photo JPG, PNG ou WebP, jusqu’à 12 Mo. Vous pouvez choisir une photo depuis votre téléphone.'));
 const linkBox=node('div'),linkLabel=node('label','Lien vers le spécimen de chèque'),link=node('input');link.type='url';link.placeholder='https://…';link.maxLength=4000;linkLabel.append(link);linkBox.append(linkLabel,node('p','Le lien doit permettre à la direction d’ouvrir le document. Vérifiez les autorisations de partage et la durée de validité du lien.'));
 form.append(fileBox,linkBox);
 const toggle=()=>{const upload=mode.value==='file';fileBox.hidden=!upload;linkBox.hidden=upload;file.required=upload;link.required=!upload;};mode.onchange=toggle;toggle();
 const policy=node('details');policy.append(node('summary','Politique de confidentialité'),node('p',state.policy.text));
 const consent=node('label'),check=node('input');check.type='checkbox';check.required=true;consent.append(check,' J’ai pris connaissance de la politique de confidentialité.');
 const submit=node('button','Transmettre mon spécimen de chèque');submit.type='submit';form.append(policy,consent,submit);
 form.onsubmit=async event=>{
  event.preventDefault();if(!form.reportValidity())return;
  const metadata={version:doc.version,policy:state.policy.id,confirmed:true},headers={'X-Employee-Files':'1',Authorization:'Bearer '+token};
  try{
   let url;
   if(mode.value==='file'){if(!file.files[0]?.size||file.files[0].size>chequeMaxBytes)throw Error('Choisissez un fichier de 12 Mo ou moins.');}
   else url=chequeLink(link.value);
   submit.disabled=true;mode.disabled=true;status.textContent='Transmission du spécimen en cours…';
   if(mode.value==='file')await sendBlocks(file.files[0],'/api/accueil-employe/specimen-cheque/uploads/'+crypto.randomUUID(),headers,{...metadata,name:file.files[0].name});
   else{
    const response=await fetch('/api/accueil-employe/specimen-cheque/link',{method:'POST',credentials:'omit',cache:'no-store',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({...metadata,url})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Le lien n’a pas pu être transmis.');
   }
   await reload();status.textContent='Votre spécimen de chèque a été reçu et conservé dans votre dossier.';
  }catch(error){status.textContent=error.message;}finally{submit.disabled=false;mode.disabled=false;}
 };
}

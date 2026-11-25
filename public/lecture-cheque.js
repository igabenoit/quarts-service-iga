import {chequeLink,chequeMimeTypes} from './cheque-schema.js';
export async function showChequeAttachment(response,{status}){
 const mime=response.headers.get('content-type')?.split(';')[0];
 if(mime==='application/pdf')return false;
 const section=document.createElement('section');section.className='cheque-attachment';
 if(mime==='text/uri-list'){
  const url=chequeLink((await response.text()).trim()),description=document.createElement('p'),link=document.createElement('a');
  description.textContent='L’employé a transmis ce lien vers son spécimen de chèque. Ouvrez-le pour consulter le document et vérifier qu’il est accessible.';
  link.href=url;link.textContent=url;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';section.append(description,link);
 }else if(chequeMimeTypes.includes(mime)){
  const blob=await response.blob(),url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('La photo ne peut pas être affichée.'));reader.readAsDataURL(blob);});
  const image=document.createElement('img');image.alt='Spécimen de chèque transmis par l’employé';image.src=url;section.append(image);
 }else throw Error('Format de spécimen non reconnu. Téléchargez l’original pour le consulter.');
 document.querySelector('header').after(section);status.textContent='';return true;
}

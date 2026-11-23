import {ethicsPageCount,ethicsSignaturePages} from './ethics-pages.js';
const params=new URLSearchParams(location.hash.slice(1));
const id=params.get('id'), view=params.get('view')||'direction';
const get=id=>document.getElementById(id);
const cash=params.get('source')==='numeraire';
const employeeKey=params.get('key');
const folder= /^(store|service):[1-9]\d*$/.test(employeeKey||'')?'dossiers/'+employeeKey:'dossiers';
get('backToFiles').href='/dossiers-employes?'+new URLSearchParams({vue:view})+'#'+folder;
if(folder!=='dossiers')get('backToFiles').textContent='← Dossier de l’employé';
if(cash){
 get('backToFiles').href='/numeraire#historique';get('backToFiles').textContent='← Historique des commandes';
 document.querySelector('h1').textContent='Commande de numéraire signée';
}
const status=get('status'), download=get('download'), canvas=document.querySelector('canvas');
let pdf, pageNumber=1, pageNumbers=[],signatureSelect,modeButton;
async function draw(number){
 get('prev').disabled=get('next').disabled=true;
 if(signatureSelect)signatureSelect.disabled=true;
 if(modeButton)modeButton.disabled=true;
 try{
  const page=await pdf.getPage(number);
  const viewport=page.getViewport({scale:1.8});
  canvas.width=Math.ceil(viewport.width);
  canvas.height=Math.ceil(viewport.height);
  await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
  pageNumber=number;
  get('page').textContent=pageNumbers.length===pdf.numPages?'Page '+number+' sur '+pdf.numPages:'Signature '+(pageNumbers.indexOf(number)+1)+' sur '+pageNumbers.length+' · Page '+number+' du cahier';
  if(signatureSelect)signatureSelect.value=String(number);
  canvas.setAttribute('aria-label','Page '+number+' du document');
  canvas.hidden=false;
  status.textContent='';
 }catch{
  canvas.hidden=true;
  status.textContent='Cette page ne peut pas être affichée. Tu peux télécharger le PDF original.';
 }finally{
  get('prev').disabled=pageNumbers.indexOf(pageNumber)<=0;
  get('next').disabled=pageNumbers.indexOf(pageNumber)>=pageNumbers.length-1;
  if(signatureSelect)signatureSelect.disabled=false;
  if(modeButton)modeButton.disabled=false;
 }
}
async function printDocument(){
 const button=get('print'), pages=get('printPages');
 button.disabled=true;
 pages.replaceChildren();
 try{
  for(const n of pageNumbers){
   const page=await pdf.getPage(n), viewport=page.getViewport({scale:2});
   const sheet=document.createElement('canvas');
   sheet.width=Math.ceil(viewport.width);sheet.height=Math.ceil(viewport.height);
   await page.render({canvasContext:sheet.getContext('2d'),viewport,intent:'print'}).promise;
   pages.append(sheet);
  }
  window.print();
 }catch{status.textContent='Impression indisponible. Tu peux télécharger le PDF original.';}
 finally{button.disabled=false;}
}
window.addEventListener('afterprint',()=>get('printPages').replaceChildren());
async function open(){
 if(!/^[a-f0-9-]{36}$/i.test(id||''))throw Error('Lien de document invalide. Rouvre le document depuis le dossier employé.');
 const url=cash?'/api/numeraire/pdf/'+id+'?source=historique':'/api/employee-files/originals/'+id+'?'+new URLSearchParams({view});
 const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
 if(response.status===401||response.status===403)throw Error('Accès au document refusé. Reconnecte-toi au portail avec ton compte autorisé puis rouvre le dossier.');
 if(!response.ok||!response.headers.get('content-type')?.startsWith('application/pdf'))throw Error('Document indisponible. Rouvre-le depuis le dossier employé.');
 const filename=response.headers.get('content-disposition')||'';
 const retirementPdf=filename.includes(encodeURIComponent('Inscription au régime de retraite'));
 const emergencyPdf=filename.includes(encodeURIComponent('Informations en cas d’urgence'));
 const tuacPdf=filename.includes(encodeURIComponent('Adhésion TUAC 500'));
 download.href=url+'&download=1';download.hidden=false;
 let displayResponse=response,printUrl=url;
 if(tuacPdf){
  printUrl=url+'&print=tuac-original';
  const printResponse=await fetch(printUrl,{credentials:'same-origin',cache:'no-store'});
  if(!printResponse.ok)throw Error('Copie pour la feuille TUAC indisponible. Le PDF original signé peut être téléchargé.');
  displayResponse=printResponse;
 }
 const lib=await import('/vendor/pdfjs/pdf.min.mjs');
 lib.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.min.mjs';
 pdf=await lib.getDocument({data:new Uint8Array(await displayResponse.arrayBuffer()),isEvalSupported:false}).promise;
 pageNumbers=Array.from({length:pdf.numPages},(_,i)=>i+1);
 document.querySelector('nav').hidden=false;
 get('prev').onclick=()=>draw(pageNumbers[pageNumbers.indexOf(pageNumber)-1]);
 get('next').onclick=()=>draw(pageNumbers[pageNumbers.indexOf(pageNumber)+1]);
 if(response.headers.get('x-onboarding-kind')==='ethique'&&pdf.numPages===ethicsPageCount){
  document.querySelector('h1').textContent='Code d’éthique · Pages de signature';
  pageNumbers=ethicsSignaturePages.map(p=>p.number);
  const print=document.createElement('a');print.id='print';print.href=url+'&pages=signatures';print.target='_blank';print.rel='noopener';print.textContent='Imprimer les 3 pages de signature';get('print').replaceWith(print);
  const selection=document.createElement('div');selection.className='signature-controls';
  const label=document.createElement('label');label.textContent='Accès direct : ';
  signatureSelect=document.createElement('select');signatureSelect.setAttribute('aria-label','Page de signature');
  for(const {number,label} of ethicsSignaturePages){const option=document.createElement('option');option.value=String(number);option.textContent=label+' · Page '+number;signatureSelect.append(option);}
  signatureSelect.onchange=()=>draw(Number(signatureSelect.value));label.append(signatureSelect);
  modeButton=document.createElement('button');modeButton.type='button';modeButton.textContent='Voir le cahier complet';
  modeButton.onclick=async()=>{
   const signatures=pageNumbers.length===pdf.numPages;
   pageNumbers=signatures?ethicsSignaturePages.map(p=>p.number):Array.from({length:pdf.numPages},(_,i)=>i+1);
   modeButton.textContent=signatures?'Voir le cahier complet':'Revenir aux signatures';
   document.querySelector('h1').textContent=signatures?'Code d’éthique · Pages de signature':'Code d’éthique · Cahier complet';
   await draw(signatures?ethicsSignaturePages[0].number:1);
  };
  selection.append(label,modeButton);document.querySelector('header').after(selection);
  const instruction=document.createElement('p');instruction.textContent='Le bouton d’impression ouvre un PDF de 3 pages seulement, avec les signatures. Le cahier complet reste conservé et téléchargeable.';selection.after(instruction);
 }else if(retirementPdf||emergencyPdf||tuacPdf){
  const original=document.createElement('a');original.id='print';original.href=printUrl;original.target='_blank';original.rel='noopener';original.textContent='Ouvrir le PDF pour imprimer';get('print').replaceWith(original);
  const instruction=document.createElement('p');instruction.textContent=tuacPdf?'Imprimez sur la feuille originale TUAC à trois fiches : format lettre (8,5 × 11 po), recto seulement, taille réelle (100 %), sans ajustement. Cette copie reprend les renseignements et la signature existants. Le PDF original signé reste disponible au téléchargement.':'Imprimez le PDF original : format lettre (8,5 × 11 po), recto verso sur une seule feuille, retournement sur le bord long. Aucun en-tête ni pied de page du site n’est ajouté.';document.querySelector('header').after(instruction);
 }else{get('print').hidden=false;get('print').onclick=printDocument;}
 await draw(pageNumbers[0]);
}
open().catch(error=>{status.textContent=download.hidden?(error.message||'Document indisponible.'):'L’aperçu est indisponible. Tu peux télécharger le PDF original.';});

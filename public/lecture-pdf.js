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
let pdf, pageNumber=1;
async function draw(number){
 get('prev').disabled=get('next').disabled=true;
 try{
  const page=await pdf.getPage(number);
  const viewport=page.getViewport({scale:1.8});
  canvas.width=Math.ceil(viewport.width);
  canvas.height=Math.ceil(viewport.height);
  await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
  pageNumber=number;
  get('page').textContent='Page '+number+' sur '+pdf.numPages;
  canvas.setAttribute('aria-label','Page '+number+' du document');
  canvas.hidden=false;
  status.textContent='';
 }catch{
  canvas.hidden=true;
  status.textContent='Cette page ne peut pas être affichée. Tu peux télécharger le PDF original.';
 }finally{
  get('prev').disabled=pageNumber<=1;
  get('next').disabled=pageNumber>=pdf.numPages;
 }
}
async function printDocument(){
 const button=get('print'), pages=get('printPages');
 button.disabled=true;
 pages.replaceChildren();
 try{
  for(let n=1;n<=pdf.numPages;n++){
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
 download.href=url+'&download=1';download.hidden=false;
 const lib=await import('/vendor/pdfjs/pdf.min.mjs');
 lib.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.min.mjs';
 pdf=await lib.getDocument({data:new Uint8Array(await response.arrayBuffer()),isEvalSupported:false}).promise;
 document.querySelector('nav').hidden=false;
 get('prev').onclick=()=>draw(pageNumber-1);
 get('next').onclick=()=>draw(pageNumber+1);
 await draw(1);get('print').hidden=false;get('print').onclick=printDocument;
}
open().catch(error=>{status.textContent=download.hidden?(error.message||'Document indisponible.'):'L’aperçu est indisponible. Tu peux télécharger le PDF original.';});
